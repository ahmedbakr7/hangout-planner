/**
 * T-001-36 — the organizer plan page loads the plan on the server (ADR-0007). Plans are set up
 * through the real route handlers and database with the route server. The page's default export
 * is called directly (no HTTP rendering until Playwright) with `next/headers` returning that
 * actor's cookies and `redirect` mocked.
 */
import { randomBytes } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import en from "../messages/en.json";
import { OrganizerPlan } from "@/components/organizer-plan";
import OrganizerPlanPage from "@/app/plans/[planId]/page";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { closeDatabase as closeJoin } from "@/server/join/db";
import { closeDatabase as closeAttempt } from "@/server/proposal/attempt";
import { closeDatabase as closeInbox } from "@/server/invites/inbox";
import { setGoogleClientOptions as setResponseGoogle } from "@/server/response/google";
import { cleanupThenClose } from "./db-cleanup";
import { createRouteServer, type RouteServer } from "./route-server";

const { router, cookieJar, redirectMock } = vi.hoisted(() => ({
  router: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
  cookieJar: { value: "" },
  redirectMock: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  redirect: redirectMock,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get(name: string) {
      for (const pair of cookieJar.value.split(";")) {
        const at = pair.indexOf("=");
        if (at > 0 && pair.slice(0, at).trim() === name) {
          return { name, value: pair.slice(at + 1).trim() };
        }
      }
      return undefined;
    },
  }),
}));

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}
const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

const emails: string[] = [];
const planIds: string[] = [];

let server: RouteServer;

type PlanElement = React.ReactElement<{ planId: string; initialPlan: unknown }>;

async function call(path: string, method: string, body: unknown): Promise<Response> {
  return server.serve(path, {
    method,
    headers: { "content-type": "application/json", "x-hp-request": "1" },
    body: JSON.stringify(body),
  });
}

type Seeded = { planId: string; organizer: string; participant: string };

/** A collecting plan owned by a new account, joined by an anonymous participant. */
async function seedPlan(title: string): Promise<Seeded> {
  server.useCookies("");
  const email = `server-load-${randomBytes(6).toString("hex")}@example.com`;
  emails.push(email);
  const account = await call("/api/v1/accounts", "POST", {
    email,
    password: "password1",
    display_name: "Omar",
  });
  expect(account.status).toBe(201);
  const organizer = server.cookies();

  const created = await call("/api/v1/plans", "POST", {
    title,
    timezone: "Africa/Cairo",
    windows: [{ local_date: "2026-10-02", start_local: "18:00", end_local: "19:00" }],
    budget: { amount_minor: 50_000, currency: "EGP" },
    steps: [{ name: "Dinner", options: ["Koshary", "Grills"] }],
    threshold: 3,
  });
  expect(created.status).toBe(201);
  const plan = (await created.json()) as { id: string; join_path: string };
  planIds.push(plan.id);

  server.useCookies("");
  const joined = await call(`/api/v1/join/${plan.join_path.slice("/join/".length)}`, "POST", {
    kind: "anonymous",
    display_name: "Hana",
  });
  expect(joined.status).toBe(201);
  return { planId: plan.id, organizer, participant: server.cookies() };
}

async function lockPlan(planId: string): Promise<void> {
  await sql`UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${planId}`;
}

function show(element: React.ReactElement) {
  return render(React.createElement(NextIntlClientProvider, { locale: "en", messages: en }, element));
}

/** Call the page as the actor with these cookies; return the OrganizerPlan element it renders. */
async function openPage(planId: string, cookies: string): Promise<PlanElement> {
  cookieJar.value = cookies;
  const tree = await OrganizerPlanPage({ params: Promise.resolve({ planId }) });
  const stack: React.ReactNode[] = [tree];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!React.isValidElement(current)) {
      continue;
    }
    if (current.type === OrganizerPlan) {
      return current as PlanElement;
    }
    React.Children.forEach((current.props as { children?: React.ReactNode }).children, (child) =>
      stack.push(child),
    );
  }
  throw new Error("the page did not render OrganizerPlan");
}

beforeEach(() => {
  server = createRouteServer();
  vi.stubGlobal("fetch", server.serve);
  process.env.HP_HASH_TEST = "1";
  redirectMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete process.env.HP_HASH_TEST;
  cookieJar.value = "";
});

async function deleteSeededRows(): Promise<void> {
  for (const planId of planIds) {
    const participants = sql`SELECT id FROM participants WHERE plan_id = ${planId}`;
    const guests = await sql<{ id: string }[]>`
      SELECT DISTINCT guest_session_id AS id FROM participants
      WHERE plan_id = ${planId} AND guest_session_id IS NOT NULL
    `;
    const linkSessions = await sql<{ id: string }[]>`
      SELECT DISTINCT link_session_id AS id FROM link_session_plans WHERE plan_id = ${planId}
    `;
    await sql`DELETE FROM proposal_runs WHERE plan_id = ${planId}`;
    await sql`DELETE FROM response_picks WHERE participant_id IN (${participants})`;
    await sql`DELETE FROM response_windows WHERE participant_id IN (${participants})`;
    await sql`DELETE FROM responses WHERE participant_id IN (${participants})`;
    await sql`DELETE FROM participants WHERE plan_id = ${planId}`;
    await sql`DELETE FROM link_session_plans WHERE plan_id = ${planId}`;
    await sql`DELETE FROM plan_options WHERE step_id IN (SELECT id FROM plan_steps WHERE plan_id = ${planId})`;
    await sql`DELETE FROM plan_steps WHERE plan_id = ${planId}`;
    await sql`DELETE FROM plan_windows WHERE plan_id = ${planId}`;
    await sql`DELETE FROM plans WHERE id = ${planId}`;
    for (const link of linkSessions) {
      await sql`
        DELETE FROM link_sessions WHERE id = ${link.id}
        AND NOT EXISTS (SELECT 1 FROM link_session_plans WHERE link_session_id = ${link.id})
      `;
    }
    for (const guest of guests) {
      await sql`DELETE FROM guest_sessions WHERE id = ${guest.id}`;
    }
  }
  for (const email of emails) {
    await sql`DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE email = ${email})`;
    await sql`DELETE FROM accounts WHERE email = ${email}`;
  }
}

afterAll(() =>
  cleanupThenClose(
    deleteSeededRows,
    () => sql.end(),
    () => closeAccounts(),
    () => closePlans(),
    () => closeJoin(),
    () => closeAttempt(),
    () => closeInbox(),
  ),
);

describe("organizer plan page loads on the server", () => {
  it("T-001-36/AC-1 GET /api/v1/plans/{planId} answers 200, 403, 404 and 409 plan_locked as before", async () => {
    const open = await seedPlan("Thursday in Maadi");
    const locked = await seedPlan("Locked in Zamalek");
    await lockPlan(locked.planId);

    server.useCookies(open.organizer);
    const ok = await server.serve(`/api/v1/plans/${open.planId}`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({
      id: open.planId,
      title: "Thursday in Maadi",
      threshold: 3,
      state: "collecting",
    });

    server.useCookies(open.participant);
    const participant = await server.serve(`/api/v1/plans/${open.planId}`);
    expect(participant.status).toBe(403);
    expect(await participant.json()).toMatchObject({
      error: { code: "forbidden", reason: "organizer_only", fields: [] },
    });

    server.useCookies(locked.organizer);
    const stranger = await server.serve(`/api/v1/plans/${open.planId}`);
    expect(stranger.status).toBe(404);
    const strangerBody = await stranger.json();
    expect(strangerBody).toMatchObject({ error: { code: "not_found", fields: [] } });
    expect(JSON.stringify(strangerBody)).not.toContain("Thursday in Maadi");

    const unknown = await server.serve("/api/v1/plans/pln_does_not_exist");
    expect(unknown.status).toBe(404);

    const lockedRead = await server.serve(`/api/v1/plans/${locked.planId}`);
    expect(lockedRead.status).toBe(409);
    expect(await lockedRead.json()).toMatchObject({
      error: { code: "conflict", reason: "plan_locked", fields: [] },
    });
    expect(server.unserved).toEqual([]);
  });

  it("T-001-36/AC-2 the page renders OrganizerPlan with the plan as initial data, and the component fetches nothing on first render", async () => {
    const { planId, organizer } = await seedPlan("Thursday in Maadi");

    const rendered = await openPage(planId, organizer);
    expect(rendered.props.planId).toBe(planId);
    expect(rendered.props.initialPlan).toMatchObject({
      id: planId,
      title: "Thursday in Maadi",
      threshold: 3,
    });
    expect(redirectMock).not.toHaveBeenCalled();

    server.useCookies(organizer);
    server.requested.length = 0;
    show(rendered);
    expect(await screen.findByDisplayValue("Thursday in Maadi")).toBeTruthy();
    expect((screen.getByLabelText("Answered threshold") as HTMLInputElement).value).toBe("3");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(server.requested).toEqual([]);
  });

  it("T-001-36/AC-3 the page redirects a locked plan to its confirmed page", async () => {
    const { planId, organizer } = await seedPlan("Locked in Zamalek");
    await lockPlan(planId);

    await expect(openPage(planId, organizer)).rejects.toThrow(`NEXT_REDIRECT /plans/${planId}/confirmed`);
    expect(redirectMock).toHaveBeenCalledWith(`/plans/${planId}/confirmed`);
  });

  it("T-001-36/AC-3 the page renders OrganizerPlan with no initial data for a participant, no cookie and an unknown plan", async () => {
    const { planId, organizer, participant } = await seedPlan("Private Thursday");

    const cases: [string, string, string][] = [
      ["participant", planId, participant],
      ["no cookie", planId, ""],
      ["unknown plan", "pln_does_not_exist", organizer],
    ];
    for (const [label, id, cookies] of cases) {
      const rendered = await openPage(id, cookies);
      expect(rendered.props.initialPlan, label).toBeNull();
      cleanup();
      server.useCookies(cookies);
      server.requested.length = 0;
      show(rendered);
      expect(await screen.findByText("This plan could not be loaded."), label).toBeTruthy();
      expect(document.body.textContent, label).not.toContain("Private Thursday");
      expect(server.requested, label).toEqual([]);
    }
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("T-001-36/AC-4 a PATCH that loses the attempt lock makes the component load the plan with GET and show it", async () => {
    const { planId, organizer, participant } = await seedPlan("Thursday in Maadi");

    // The guest answers through the real PUT, so lowering the threshold onto the count runs an attempt.
    const place = { id: "ChIJ-start", displayName: { text: "Maadi, Cairo" }, location: { latitude: 29.96, longitude: 31.25 } };
    setResponseGoogle({
      apiKey: "test-places-key",
      fetch: async () =>
        new Response(JSON.stringify(place), { status: 200, headers: { "Content-Type": "application/json" } }),
    });
    server.useCookies(participant);
    const answers = (await (await server.serve(`/api/v1/plans/${planId}/response`)).json()) as {
      windows: { id: string }[];
      steps: { id: string; options: { id: string }[] }[];
    };
    const saved = await call(`/api/v1/plans/${planId}/response`, "PUT", {
      windows: [{ window_id: answers.windows[0]?.id, kind: "free", earliest_local: "18:00", latest_local: "19:00" }],
      start_place_id: "ChIJ-start",
      picks: [{ step_id: answers.steps[0]?.id, option_id: answers.steps[0]?.options[0]?.id }],
    });
    expect(saved.status).toBe(200);
    setResponseGoogle(undefined);
    await sql`UPDATE plans SET attempt_lock = true, attempt_lock_at = now() WHERE id = ${planId}`;

    const rendered = await openPage(planId, organizer);
    server.useCookies(organizer);
    server.requested.length = 0;
    show(rendered);
    const threshold = (await screen.findByLabelText("Answered threshold")) as HTMLInputElement;
    fireEvent.change(threshold, { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(server.requested.filter((line) => line === `GET /api/v1/plans/${planId}`)).toHaveLength(1);
    });
    await waitFor(() => {
      expect((screen.getByLabelText("Answered threshold") as HTMLInputElement).value).toBe("1");
    });
    expect(server.requested.filter((line) => line.startsWith("PATCH "))).toEqual([
      `PATCH /api/v1/plans/${planId}`,
    ]);
    expect(screen.queryByText("The plan could not be saved.")).toBeNull();
    expect(server.unserved).toEqual([]);
    const stored = await sql<{ threshold: number }[]>`SELECT threshold FROM plans WHERE id = ${planId}`;
    expect(stored).toEqual([{ threshold: 1 }]);
  });
});
