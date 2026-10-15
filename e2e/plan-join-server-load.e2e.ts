/**
 * T-001-42 — the plan join page loads the join preview on the server (ADR-0007). Plans are set up
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
import { JoinPanel } from "@/components/join-panel";
import PlanJoinPage from "@/app/plans/[planId]/join/page";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { closeDatabase as closeJoin } from "@/server/join/db";
import { closeDatabase as closeAttempt } from "@/server/proposal/attempt";
import { closeDatabase as closeInbox } from "@/server/invites/inbox";
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
const linkSessionIds = new Set<string>();

let server: RouteServer;

type PanelElement = React.ReactElement<{
  planId?: string;
  token?: string;
  initialOpening?: unknown;
  initialSignedIn?: boolean;
}>;

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
  invited: string;
  token: string;
};

/** A collecting plan owned by a new account, joined by an anonymous participant, opened by a link reader and sent to an invited account. */
async function seedPlan(title: string): Promise<Seeded> {
  server.useCookies("");
  const email = `join-load-${randomBytes(6).toString("hex")}@example.com`;
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

  server.useCookies("");
  const inviteeEmail = `join-load-${randomBytes(6).toString("hex")}@example.com`;
  emails.push(inviteeEmail);
  const invitee = await call("/api/v1/accounts", "POST", {
    email: inviteeEmail,
    password: "password1",
    display_name: "Salma",
  });
  expect(invitee.status).toBe(201);
  const invited = server.cookies();
  server.useCookies(organizer);
  const invitation = await call(`/api/v1/plans/${plan.id}/invitations`, "POST", {
    email: inviteeEmail,
  });
  expect(invitation.status).toBe(200);
  return { planId: plan.id, organizer, participant, linkReader, invited, token };
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

/** Call the page as the actor with these cookies; return the JoinPanel element it renders. */
async function openPage(planId: string, cookies: string): Promise<PanelElement> {
  cookieJar.value = cookies;
  const tree = await PlanJoinPage({ params: Promise.resolve({ planId }) });
  const stack: React.ReactNode[] = [tree];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!React.isValidElement(current)) {
      continue;
    }
    if (current.type === JoinPanel) {
      return current as PanelElement;
    }
    React.Children.forEach((current.props as { children?: React.ReactNode }).children, (child) =>
      stack.push(child),
    );
  }
  throw new Error("the page did not render JoinPanel");
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
    await sql`DELETE FROM proposal_runs WHERE plan_id = ${planId}`;
    await sql`DELETE FROM response_picks WHERE participant_id IN (${participants})`;
    await sql`DELETE FROM response_windows WHERE participant_id IN (${participants})`;
    await sql`DELETE FROM responses WHERE participant_id IN (${participants})`;
    await sql`DELETE FROM participants WHERE plan_id = ${planId}`;
    const links = await sql<{ id: string }[]>`
      SELECT link_session_id AS id FROM link_session_plans WHERE plan_id = ${planId}
    `;
    for (const link of links) {
      linkSessionIds.add(link.id);
    }
    await sql`DELETE FROM link_session_plans WHERE plan_id = ${planId}`;
    await sql`DELETE FROM invitations WHERE plan_id = ${planId}`;
    await sql`DELETE FROM plan_options WHERE step_id IN (SELECT id FROM plan_steps WHERE plan_id = ${planId})`;
    await sql`DELETE FROM plan_steps WHERE plan_id = ${planId}`;
    await sql`DELETE FROM plan_windows WHERE plan_id = ${planId}`;
    await sql`DELETE FROM plans WHERE id = ${planId}`;
    for (const guest of guests) {
      await sql`DELETE FROM guest_sessions WHERE id = ${guest.id}`;
    }
  }
  for (const id of linkSessionIds) {
    await sql`DELETE FROM link_session_plans WHERE link_session_id = ${id}`;
    await sql`DELETE FROM link_sessions WHERE id = ${id}`;
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

describe("plan join page loads on the server", () => {
  it("T-001-42/AC-1 GET /api/v1/plans/{planId}/opening answers 200 with next and the preview, and 404, as before", async () => {
    const { planId, organizer, participant, invited, linkReader } = await seedPlan("Thursday in Maadi");

    const body = async (cookies: string, id = planId) => {
      server.useCookies(cookies);
      const response = await server.serve(`/api/v1/plans/${id}/opening`);
      return { status: response.status, json: (await response.json()) as Record<string, unknown> };
    };

    expect(await body(organizer)).toEqual({
      status: 200,
      json: { plan_id: planId, next: "organizer", preview: null },
    });
    expect(await body(participant)).toEqual({
      status: 200,
      json: { plan_id: planId, next: "respond", preview: null },
    });
    expect(await body(invited)).toEqual({
      status: 200,
      json: {
        plan_id: planId,
        next: "join",
        preview: {
          title: "Thursday in Maadi",
          organizer_display_name: "Omar",
          timezone: "Africa/Cairo",
          windows: [{ local_date: "2026-10-02", start_local: "18:00", end_local: "19:00" }],
          budget: { amount_minor: 50_000, currency: "EGP" },
          step_names: ["Dinner"],
        },
      },
    });

    for (const [label, cookies, id] of [
      ["link reader", linkReader, planId],
      ["stranger", "", planId],
      ["unknown plan", organizer, "pln_does_not_exist"],
    ] as const) {
      const result = await body(cookies, id);
      expect(result.status, label).toBe(404);
      expect(result.json, label).toMatchObject({ error: { code: "not_found", fields: [] } });
      expect(JSON.stringify(result.json), label).not.toContain("Thursday in Maadi");
    }
    expect(server.unserved).toEqual([]);
  });

  it("T-001-42/AC-2 the page renders JoinPanel with the preview and signed-in state, and the panel fetches nothing on first render", async () => {
    const { planId, invited } = await seedPlan("Thursday in Maadi");

    const rendered = await openPage(planId, invited);
    expect(rendered.props.planId).toBe(planId);
    expect(rendered.props.initialSignedIn).toBe(true);
    expect(rendered.props.initialOpening).toMatchObject({
      plan_id: planId,
      next: "join",
      preview: { title: "Thursday in Maadi", organizer_display_name: "Omar" },
    });
    expect(redirectMock).not.toHaveBeenCalled();

    server.useCookies(invited);
    server.requested.length = 0;
    show(rendered);
    expect(await screen.findByText("Thursday in Maadi")).toBeTruthy();
    expect(screen.getByText(en.join.organizer.replace("{name}", "Omar"))).toBeTruthy();
    expect(screen.getByRole("button", { name: en.join.joinWithAccount })).toBeTruthy();
    expect(screen.queryByText(en.join.unknownLink)).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 100));
    // ADR-0009: the one slide request is the only fetch; no opening or token load.
    expect(server.requested).toEqual(["GET /api/v1/me"]);
  });

  it("T-001-42/AC-3 the page redirects a caller whose next is not join to that surface", async () => {
    const { planId, organizer, participant, invited } = await seedPlan("Not yet locked");

    const cases: [string, string, string, string][] = [
      ["organizer", "collecting", organizer, `/plans/${planId}`],
      ["participant collecting", "collecting", participant, `/plans/${planId}/respond`],
      ["participant blocked", "blocked", participant, `/plans/${planId}/respond`],
      ["participant proposed", "proposed", participant, `/plans/${planId}/proposal`],
      ["organizer locked", "locked", organizer, `/plans/${planId}/confirmed`],
      ["participant locked", "locked", participant, `/plans/${planId}/confirmed`],
      ["invited locked", "locked", invited, `/plans/${planId}/confirmed`],
    ];
    for (const [label, state, cookies, path] of cases) {
      await setState(planId, state);
      redirectMock.mockClear();
      await expect(openPage(planId, cookies), label).rejects.toThrow(`NEXT_REDIRECT ${path}`);
      expect(redirectMock, label).toHaveBeenCalledTimes(1);
      expect(redirectMock, label).toHaveBeenCalledWith(path);

      // The page and the API agree on where the caller goes.
      server.useCookies(cookies);
      const opening = (await (await server.serve(`/api/v1/plans/${planId}/opening`)).json()) as {
        next: string;
      };
      expect(path, label).toBe(
        opening.next === "organizer" ? `/plans/${planId}` : `/plans/${planId}/${opening.next}`,
      );
    }
  });

  it("T-001-42/AC-4 the page renders JoinPanel with no initial opening for no cookie, a stranger, a link reader and an unknown plan", async () => {
    const { planId, linkReader } = await seedPlan("Private Thursday");
    const other = await seedPlan("Someone else's plan");

    const cases: [string, string, string][] = [
      ["no cookie", planId, ""],
      ["stranger", planId, other.organizer],
      ["link reader", planId, linkReader],
      ["unknown plan", "pln_does_not_exist", other.organizer],
    ];
    for (const [label, id, cookies] of cases) {
      const rendered = await openPage(id, cookies);
      expect(rendered.props.initialOpening, label).toBeNull();
      cleanup();
      server.useCookies(cookies);
      server.requested.length = 0;
      show(rendered);
      expect((await screen.findByText(en.join.unknownLink)).textContent, label).toBe(en.join.unknownLink);
      expect(document.body.textContent, label).not.toContain("Private Thursday");
      expect(server.requested, label).toEqual([]);
    }
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("T-001-42/AC-6 /join/{token} keeps client loading: the panel fetches the token route and /api/v1/me on first render", async () => {
    const { token, planId } = await seedPlan("Thursday in Maadi");

    server.useCookies("");
    server.requested.length = 0;
    show(React.createElement(JoinPanel, { token }));
    expect(await screen.findByText("Thursday in Maadi")).toBeTruthy();
    expect(server.requested).toContain(`GET /api/v1/join/${token}`);
    expect(server.requested).toContain("GET /api/v1/me");
    expect(server.requested.some((line) => line.includes(`/plans/${planId}/opening`))).toBe(false);
    expect(server.unserved).toEqual([]);
  });
});
