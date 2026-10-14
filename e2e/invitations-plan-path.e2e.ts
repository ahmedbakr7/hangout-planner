/**
 * T-001-51 — InvitationsList opens an invitation through the shared plan path helper. Plans are
 * set up through the real route handlers and database with the route server; the list is
 * rendered and its row clicked, with `next/navigation` mocked to record the pushed path.
 */
import { randomBytes } from "node:crypto";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import en from "../messages/en.json";
import { InvitationsList } from "@/components/invite-panel";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { closeDatabase as closeJoin } from "@/server/join/db";
import { closeDatabase as closeAttempt } from "@/server/proposal/attempt";
import { closeDatabase as closeInbox } from "@/server/invites/inbox";
import { createRouteServer, type RouteServer } from "./route-server";

const { router } = vi.hoisted(() => ({
  router: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/invitations",
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
  invited: string;
};

/** A collecting plan owned by a new account, joined by an anonymous participant and sent to an invited account. */
async function seedPlan(title: string): Promise<Seeded> {
  server.useCookies("");
  const email = `invite-path-${randomBytes(6).toString("hex")}@example.com`;
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
  const inviteeEmail = `invite-path-${randomBytes(6).toString("hex")}@example.com`;
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
  return { planId: plan.id, organizer, participant, invited };
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

beforeEach(() => {
  server = createRouteServer();
  vi.stubGlobal("fetch", server.serve);
  process.env.HP_HASH_TEST = "1";
  router.push.mockClear();
});

afterEach(() => {
  expect(server.unserved).toEqual([]);
  cleanup();
  vi.unstubAllGlobals();
  delete process.env.HP_HASH_TEST;
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

const NEXT_PATHS = [
  ["organizer", (id: string) => `/plans/${id}`],
  ["respond", (id: string) => `/plans/${id}/respond`],
  ["proposal", (id: string) => `/plans/${id}/proposal`],
  ["confirmed", (id: string) => `/plans/${id}/confirmed`],
  ["join", (id: string) => `/plans/${id}/join`],
] as const;

function inbox(planId: string, next?: string) {
  return {
    invitations: [
      {
        plan_id: planId,
        title: "Opened invitation",
        organizer_display_name: "Omar",
        ...(next ? { next } : {}),
      },
    ],
    truncated: false,
  };
}

async function openRow(cookies: string, initialInbox: unknown): Promise<void> {
  server.useCookies(cookies);
  router.push.mockClear();
  server.requested.length = 0;
  show(React.createElement(InvitationsList, { initialInbox }));
  fireEvent.click(await screen.findByRole("button", { name: /Opened invitation/ }));
}

describe("invitations list opens through the plan path helper", () => {
  it.each(NEXT_PATHS)(
    "T-001-51/AC-1 a row carrying next %s navigates to the plan's screen path",
    async (next, path) => {
      const { planId, invited } = await seedPlan("Row next");
      await openRow(invited, inbox(planId, next));
      await vi.waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
      expect(router.push).toHaveBeenCalledWith(path(planId));
      expect(server.requested.filter((line) => line.includes("/opening"))).toEqual([]);
    },
  );

  it("T-001-51/AC-1 the next read from GET /api/v1/plans/{planId}/opening navigates to the plan's screen path for each caller", async () => {
    const { planId, organizer, participant, invited } = await seedPlan("Opening next");
    const cases: [string, string, string, string][] = [
      ["organizer", "collecting", organizer, `/plans/${planId}`],
      ["respond", "collecting", participant, `/plans/${planId}/respond`],
      ["join", "collecting", invited, `/plans/${planId}/join`],
      ["proposal", "proposed", participant, `/plans/${planId}/proposal`],
      ["confirmed", "locked", participant, `/plans/${planId}/confirmed`],
    ];
    for (const [label, state, cookies, path] of cases) {
      await setState(planId, state);
      await openRow(cookies, inbox(planId));
      await vi.waitFor(() => expect(router.push, label).toHaveBeenCalledTimes(1));
      expect(router.push, label).toHaveBeenCalledWith(path);
      expect(screen.queryByRole("alert"), label).toBeNull();
      cleanup();
    }
  });

  it("T-001-51/AC-2 a failed opening shows the load error and does not navigate", async () => {
    const { invited } = await seedPlan("Missing plan");
    await openRow(invited, inbox("pln_does_not_exist"));
    expect((await screen.findByRole("alert")).textContent).toBe(en.invitations.loadError);
    expect(router.push).not.toHaveBeenCalled();
  });
});
