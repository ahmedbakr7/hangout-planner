/**
 * T-001-50 — pages and components map the next surface through one helper. Plans are set up
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
import ConfirmedPage from "@/app/plans/[planId]/confirmed/page";
import { planPath } from "@/lib/plan-paths";
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
  // Any request the test did not serve fails it, as in e2e/confirmed-server-load.e2e.ts.
  expect(server.unserved).toEqual([]);
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
  await sql.end();
  await Promise.all([closeAccounts(), closePlans(), closeJoin(), closeAttempt(), closeInbox()]);
});

describe("plan next surface paths", () => {
  it("T-001-50/AC-1 the opening route's next maps to the screen path for each caller", async () => {
    const { planId, organizer, participant, invited } = await seedPlan("Paths Thursday");
    const next = async (cookies: string): Promise<Parameters<typeof planPath>[1]> => {
      server.useCookies(cookies);
      const response = await server.serve(`/api/v1/plans/${planId}/opening`);
      expect(response.status).toBe(200);
      return ((await response.json()) as { next: Parameters<typeof planPath>[1] }).next;
    };
    expect(planPath(planId, await next(organizer))).toBe(`/plans/${planId}`);
    expect(planPath(planId, await next(participant))).toBe(`/plans/${planId}/respond`);
    expect(planPath(planId, await next(invited))).toBe(`/plans/${planId}/join`);
    await setState(planId, "proposed");
    expect(planPath(planId, await next(participant))).toBe(`/plans/${planId}/proposal`);
    await setState(planId, "locked");
    expect(planPath(planId, await next(participant))).toBe(`/plans/${planId}/confirmed`);
  });

  it("T-001-50/AC-2 the confirmed page redirects a not-locked caller to its next, an invited caller to the join page", async () => {
    const { planId, organizer, participant, invited } = await seedPlan("Not locked yet");
    const cases: [string, string, string, string][] = [
      ["organizer", "collecting", organizer, `/plans/${planId}`],
      ["participant collecting", "collecting", participant, `/plans/${planId}/respond`],
      ["participant proposed", "proposed", participant, `/plans/${planId}/proposal`],
      ["invited collecting", "collecting", invited, `/plans/${planId}/join`],
    ];
    for (const [label, state, cookies, path] of cases) {
      await setState(planId, state);
      redirectMock.mockClear();
      cookieJar.value = cookies;
      await expect(ConfirmedPage({ params: Promise.resolve({ planId }) }), label).rejects.toThrow(
        `NEXT_REDIRECT ${path}`,
      );
      expect(redirectMock, label).toHaveBeenCalledWith(path);
    }
  });

  it("T-001-50/AC-2 the plan join page keeps an invited caller and redirects the others", async () => {
    const { planId, organizer, participant, invited } = await seedPlan("Join stays");
    cookieJar.value = invited;
    await PlanJoinPage({ params: Promise.resolve({ planId }) });
    expect(redirectMock).not.toHaveBeenCalled();
    for (const [cookies, path] of [
      [organizer, `/plans/${planId}`],
      [participant, `/plans/${planId}/respond`],
    ] as const) {
      cookieJar.value = cookies;
      await expect(PlanJoinPage({ params: Promise.resolve({ planId }) })).rejects.toThrow(
        `NEXT_REDIRECT ${path}`,
      );
    }
  });

  it("T-001-50/AC-2 JoinPanel stays on the join preview for an invited caller", async () => {
    const { planId, invited } = await seedPlan("Panel Thursday");
    const rendered = await openPage(planId, invited);
    server.useCookies(invited);
    router.push.mockClear();
    router.replace.mockClear();
    show(rendered);
    expect(await screen.findByRole("button", { name: en.join.joinWithAccount })).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("T-001-50/AC-2 ConfirmedView renders for a participant and a link reader of a locked plan without redirecting", async () => {
    const { planId, participant, linkReader } = await seedPlan("Locked outing");
    await setState(planId, "locked");
    for (const cookies of [participant, linkReader]) {
      cookieJar.value = cookies;
      const tree = await ConfirmedPage({ params: Promise.resolve({ planId }) });
      expect(React.isValidElement(tree)).toBe(true);
    }
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("T-001-50/AC-3 the helper keeps the join path the existing redirect suites expect", () => {
    // The existing plan-join-server-load and confirmed-server-load suites run unchanged in this gate.
    expect(planPath("pln_1", "join")).toBe("/plans/pln_1/join");
  });
});
