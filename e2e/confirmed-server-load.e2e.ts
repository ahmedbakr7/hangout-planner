/**
 * T-001-38 — the confirmed page loads the outing on the server (ADR-0007). Plans are set up
 * through the real route handlers and database with the route server. The page's default export
 * is called directly (no HTTP rendering until Playwright) with `next/headers` returning that
 * actor's cookies and `redirect` mocked.
 */
import { randomBytes } from "node:crypto";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import en from "../messages/en.json";
import { ConfirmedView } from "@/components/confirmed-view";
import ConfirmedPage from "@/app/plans/[planId]/confirmed/page";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { closeDatabase as closeJoin } from "@/server/join/db";
import { closeDatabase as closeAttempt } from "@/server/proposal/attempt";
import { closeDatabase as closeInbox } from "@/server/invites/inbox";
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

type ViewElement = React.ReactElement<{ planId: string; initialDoc: unknown }>;

async function call(path: string, method: string, body: unknown): Promise<Response> {
  return server.serve(path, {
    method,
    headers: { "content-type": "application/json", "x-hp-request": "1" },
    body: JSON.stringify(body),
  });
}

type Seeded = {
  planId: string;
  organizer: string;
  participant: string;
  linkReader: string;
};

/** A collecting plan owned by a new account, joined by an anonymous participant and opened by a link reader. */
async function seedPlan(title: string): Promise<Seeded> {
  server.useCookies("");
  const email = `confirmed-load-${randomBytes(6).toString("hex")}@example.com`;
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
  const token = plan.join_path.slice("/join/".length);

  server.useCookies("");
  const joined = await call(`/api/v1/join/${token}`, "POST", {
    kind: "anonymous",
    display_name: "Hana",
  });
  expect(joined.status).toBe(201);
  const participant = server.cookies();

  server.useCookies("");
  const opened = await server.serve(`/api/v1/join/${token}`);
  expect(opened.status).toBe(200);
  const linkReader = server.cookies();
  return { planId: plan.id, organizer, participant, linkReader };
}

async function setState(planId: string, state: string): Promise<void> {
  if (state === "locked") {
    await sql`UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${planId}`;
    return;
  }
  await sql`UPDATE plans SET state = ${state} WHERE id = ${planId}`;
}

function show(element: React.ReactElement) {
  return render(React.createElement(NextIntlClientProvider, { locale: "en", messages: en }, element));
}

/** Call the page as the actor with these cookies; return the ConfirmedView element it renders. */
async function openPage(planId: string, cookies: string): Promise<ViewElement> {
  cookieJar.value = cookies;
  const tree = await ConfirmedPage({ params: Promise.resolve({ planId }) });
  const stack: React.ReactNode[] = [tree];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!React.isValidElement(current)) {
      continue;
    }
    if (current.type === ConfirmedView) {
      return current as ViewElement;
    }
    React.Children.forEach((current.props as { children?: React.ReactNode }).children, (child) =>
      stack.push(child),
    );
  }
  throw new Error("the page did not render ConfirmedView");
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

afterAll(async () => {
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
  await sql.end();
  await Promise.all([closeAccounts(), closePlans(), closeJoin(), closeAttempt(), closeInbox()]);
});

describe("confirmed page loads on the server", () => {
  it("T-001-38/AC-1 GET /api/v1/plans/{planId}/confirmed answers 200, 404 and 409 not_locked as before", async () => {
    const open = await seedPlan("Open Thursday");
    const locked = await seedPlan("Locked in Zamalek");
    await setState(locked.planId, "locked");

    for (const [label, cookies] of [
      ["organizer", locked.organizer],
      ["participant", locked.participant],
      ["link reader", locked.linkReader],
    ] as const) {
      server.useCookies(cookies);
      const ok = await server.serve(`/api/v1/plans/${locked.planId}/confirmed`);
      expect(ok.status, label).toBe(200);
      expect(await ok.json(), label).toMatchObject({
        plan_id: locked.planId,
        title: "Locked in Zamalek",
        state: "locked",
      });
    }

    server.useCookies(open.organizer);
    const notLocked = await server.serve(`/api/v1/plans/${open.planId}/confirmed`);
    expect(notLocked.status).toBe(409);
    expect(await notLocked.json()).toMatchObject({
      error: { code: "conflict", reason: "not_locked", fields: [] },
    });

    server.useCookies(open.participant);
    const participantNotLocked = await server.serve(`/api/v1/plans/${open.planId}/confirmed`);
    expect(participantNotLocked.status).toBe(409);

    server.useCookies(open.organizer);
    const stranger = await server.serve(`/api/v1/plans/${locked.planId}/confirmed`);
    expect(stranger.status).toBe(404);
    const strangerBody = await stranger.json();
    expect(strangerBody).toMatchObject({ error: { code: "not_found", fields: [] } });
    expect(JSON.stringify(strangerBody)).not.toContain("Locked in Zamalek");

    const unknown = await server.serve("/api/v1/plans/pln_does_not_exist/confirmed");
    expect(unknown.status).toBe(404);
    expect(server.unserved).toEqual([]);
  });

  it("T-001-38/AC-2 the page renders ConfirmedView with the outing as initial data, and the component fetches nothing on first render", async () => {
    const { planId, participant } = await seedPlan("Thursday in Maadi");
    await setState(planId, "locked");

    const rendered = await openPage(planId, participant);
    expect(rendered.props.planId).toBe(planId);
    expect(rendered.props.initialDoc).toMatchObject({
      plan_id: planId,
      title: "Thursday in Maadi",
      state: "locked",
    });
    expect(redirectMock).not.toHaveBeenCalled();

    server.useCookies(participant);
    server.requested.length = 0;
    show(rendered);
    expect(await screen.findByText("Thursday in Maadi")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(server.requested).toEqual([]);
  });

  it("T-001-38/AC-3 the page redirects a plan that is not locked to the surface /opening names for the caller", async () => {
    const { planId, organizer, participant, linkReader } = await seedPlan("Not yet locked");

    const cases: [string, string, string, string][] = [
      ["organizer", "collecting", organizer, `/plans/${planId}`],
      ["participant collecting", "collecting", participant, `/plans/${planId}/respond`],
      ["participant blocked", "blocked", participant, `/plans/${planId}/respond`],
      ["participant proposed", "proposed", participant, `/plans/${planId}/proposal`],
      ["link reader", "collecting", linkReader, `/plans/${planId}/join`],
    ];
    for (const [label, state, cookies, path] of cases) {
      await setState(planId, state);
      redirectMock.mockClear();
      await expect(openPage(planId, cookies), label).rejects.toThrow(`NEXT_REDIRECT ${path}`);
      expect(redirectMock, label).toHaveBeenCalledWith(path);

      // The page and the API agree on where the caller goes.
      if (label !== "link reader") {
        server.useCookies(cookies);
        const opening = (await (await server.serve(`/api/v1/plans/${planId}/opening`)).json()) as {
          next: string;
        };
        expect(path, label).toBe(
          opening.next === "organizer" ? `/plans/${planId}` : `/plans/${planId}/${opening.next}`,
        );
      }
    }
  });

  it("T-001-38/AC-4 the page renders ConfirmedView with no initial data for no cookie, a stranger and an unknown plan", async () => {
    const { planId } = await seedPlan("Private Thursday");
    const other = await seedPlan("Someone else's plan");
    await setState(planId, "locked");

    const cases: [string, string, string][] = [
      ["no cookie", planId, ""],
      ["stranger", planId, other.organizer],
      ["unknown plan", "pln_does_not_exist", other.organizer],
    ];
    for (const [label, id, cookies] of cases) {
      const rendered = await openPage(id, cookies);
      expect(rendered.props.initialDoc, label).toBeNull();
      cleanup();
      server.useCookies(cookies);
      server.requested.length = 0;
      show(rendered);
      const alert = await screen.findByRole("alert");
      expect(alert.textContent, label).toBe(en.confirmed.loadError);
      expect(document.body.textContent, label).not.toContain("Private Thursday");
      expect(server.requested, label).toEqual([]);
    }
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
