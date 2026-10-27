/**
 * T-001-88 — real-stack proof for shipped tickets T-001-14 (join by token), T-001-15 (opening),
 * T-001-16 (invitations), T-001-17 (invitation inbox), T-001-18 (join UI) and T-001-19 (invite UI).
 * Accounts, plans, joins and invitations go through the real route handlers and Postgres with the
 * route server. AC-5 and AC-6 call the pages' default exports with `next/headers` returning that
 * actor's cookies and render the components they produce.
 */
import { randomBytes } from "node:crypto";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import en from "../messages/en.json";
import { InvitationsList } from "@/components/invite-panel";
import { JoinPanel } from "@/components/join-panel";
import InvitationsPage from "@/app/invitations/page";
import PlanJoinPage from "@/app/plans/[planId]/join/page";
import { resetClock, setClock } from "@/server/clock";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { closeDatabase as closeJoin } from "@/server/join/db";
import { closeDatabase as closeAttempt } from "@/server/proposal/attempt";
import { closeDatabase as closeInbox } from "@/server/invites/inbox";
import { cleanupThenClose } from "./db-cleanup";
import { createRouteServer, type RouteServer } from "./route-server";
import { teardownThenAssertServed } from "./teardown";

const { router, cookieJar, redirectMock } = vi.hoisted(() => ({
  router: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
  cookieJar: { value: "" },
  redirectMock: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/invitations",
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

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = 30 * DAY_MS;

const emails: string[] = [];
const planIds: string[] = [];

let server: RouteServer;

async function call(path: string, method: string, body: unknown): Promise<Response> {
  return server.serve(path, {
    method,
    headers: { "content-type": "application/json", "x-hp-request": "1" },
    body: JSON.stringify(body),
  });
}

async function signUp(displayName: string): Promise<{ email: string; cookies: string }> {
  server.useCookies("");
  const email = `shipped-join-${randomBytes(6).toString("hex")}@example.com`;
  emails.push(email);
  const account = await call("/api/v1/accounts", "POST", {
    email,
    password: "password1",
    display_name: displayName,
  });
  expect(account.status).toBe(201);
  return { email, cookies: server.cookies() };
}

type PlanOptions = {
  title?: string;
  budget?: { amount_minor: number; currency: string };
  steps?: { name: string; options: string[] }[];
};

/** A collecting plan owned by `organizer`; returns its id and join token. */
async function createPlan(
  organizer: string,
  options: PlanOptions = {},
): Promise<{ id: string; token: string }> {
  server.useCookies(organizer);
  const created = await call("/api/v1/plans", "POST", {
    title: options.title ?? "Thursday in Maadi",
    timezone: "Africa/Cairo",
    windows: [{ local_date: "2026-10-02", start_local: "18:00", end_local: "19:00" }],
    budget: options.budget ?? { amount_minor: 50_000, currency: "EGP" },
    steps: options.steps ?? [{ name: "Dinner", options: ["Koshary", "Grills"] }],
    threshold: 3,
  });
  expect(created.status).toBe(201);
  const plan = (await created.json()) as { id: string; join_path: string };
  planIds.push(plan.id);
  return { id: plan.id, token: plan.join_path.slice("/join/".length) };
}

async function invite(organizer: string, planId: string, email: string): Promise<Response> {
  server.useCookies(organizer);
  return call(`/api/v1/plans/${planId}/invitations`, "POST", { email });
}

async function joinAnonymously(token: string, displayName: unknown, cookies = ""): Promise<Response> {
  server.useCookies(cookies);
  return call(`/api/v1/join/${token}`, "POST", { kind: "anonymous", display_name: displayName });
}

async function setState(planId: string, state: string): Promise<void> {
  if (state === "locked") {
    await sql`UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${planId}`;
    return;
  }
  await sql`UPDATE plans SET state = ${state} WHERE id = ${planId}`;
}

async function invitationCount(planId: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM invitations WHERE plan_id = ${planId}
  `;
  return rows[0]?.n ?? 0;
}

async function participantCount(planId: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM participants WHERE plan_id = ${planId}
  `;
  return rows[0]?.n ?? 0;
}

function guestCookie(response: Response): string | undefined {
  return response.headers.getSetCookie().find((line) => line.startsWith("hp_guest="));
}

function show(element: React.ReactElement) {
  return render(React.createElement(NextIntlClientProvider, { locale: "en", messages: en }, element));
}

/** The first element of `type` in the tree a page returned. */
function findElement(tree: React.ReactNode, type: unknown, label: string): React.ReactElement {
  const stack: React.ReactNode[] = [tree];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!React.isValidElement(current)) {
      continue;
    }
    if (current.type === type) {
      return current;
    }
    React.Children.forEach((current.props as { children?: React.ReactNode }).children, (child) =>
      stack.push(child),
    );
  }
  throw new Error(`the page did not render ${label}`);
}

/** Call /plans/{planId}/join as the actor with these cookies; return the JoinPanel element. */
async function openJoinPage(planId: string, cookies: string): Promise<React.ReactElement> {
  cookieJar.value = cookies;
  const tree = await PlanJoinPage({ params: Promise.resolve({ planId }) });
  return findElement(tree, JoinPanel, "JoinPanel");
}

/** Call /invitations as the actor with these cookies; return the InvitationsList element. */
async function openInvitationsPage(cookies: string): Promise<React.ReactElement> {
  cookieJar.value = cookies;
  const tree = await InvitationsPage();
  return findElement(tree, InvitationsList, "InvitationsList");
}

beforeEach(() => {
  server = createRouteServer();
  vi.stubGlobal("fetch", server.serve);
  process.env.HP_HASH_TEST = "1";
  router.push.mockClear();
  redirectMock.mockClear();
});

afterEach(() => {
  teardownThenAssertServed(
    server.unserved,
    () => cleanup(),
    () => resetClock(),
    () => vi.unstubAllGlobals(),
    () => {
      delete process.env.HP_HASH_TEST;
      cookieJar.value = "";
    },
  );
});

async function deleteSeededRows(): Promise<void> {
  const guestIds = new Set<string>();
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
    await sql`DELETE FROM invitations WHERE plan_id = ${planId}`;
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
      guestIds.add(guest.id);
    }
  }
  for (const id of guestIds) {
    await sql`DELETE FROM guest_sessions WHERE id = ${id}`;
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

describe("join by token (T-001-14)", () => {
  it("T-001-88/AC-1 T-001-14/AC-4 a display name of 1 and 40 characters after trim joins and 0 and 41 are rejected with 400", async () => {
    const organizer = await signUp("Omar");
    const plan = await createPlan(organizer.cookies);

    const forty = "n".repeat(40);
    const accepted: [string, string, string][] = [
      ["one character", "N", "N"],
      ["forty characters", forty, forty],
      ["forty characters inside spaces", `   ${forty}  `, forty],
    ];
    for (const [label, sent, stored] of accepted) {
      const response = await joinAnonymously(plan.token, sent);
      expect(response.status, label).toBe(201);
      const body = (await response.json()) as { participant: { id: string; display_name: string } };
      expect(body.participant.display_name, label).toBe(stored);
      const rows = await sql<{ display_name: string }[]>`
        SELECT display_name FROM participants WHERE id = ${body.participant.id}
      `;
      expect(rows[0]?.display_name, label).toBe(stored);
    }
    expect(await participantCount(plan.id)).toBe(3);

    const rejected: [string, unknown][] = [
      ["spaces only", "   "],
      ["empty", ""],
      ["forty-one characters", "n".repeat(41)],
      ["forty-one characters inside spaces", `  ${"n".repeat(41)}  `],
      ["missing", undefined],
      ["not a string", 7],
    ];
    for (const [label, sent] of rejected) {
      const response = await joinAnonymously(plan.token, sent);
      expect(response.status, label).toBe(400);
      expect(await response.json(), label).toMatchObject({
        error: { fields: [{ path: "display_name" }] },
      });
      expect(guestCookie(response), label).toBeUndefined();
    }
    expect(await participantCount(plan.id)).toBe(3);
  });

  it("T-001-88/AC-1 T-001-14/AC-4 anonymous join asks for no password: a body with only the kind and name joins, and no field error names a password", async () => {
    const organizer = await signUp("Omar");
    const plan = await createPlan(organizer.cookies);

    const joined = await joinAnonymously(plan.token, "Nour");
    expect(joined.status).toBe(201);
    expect(await joined.json()).toMatchObject({
      participant: { display_name: "Nour" },
      next: "respond",
    });

    const rejected = await joinAnonymously(plan.token, "   ");
    expect(rejected.status).toBe(400);
    const fields = ((await rejected.json()) as { error: { fields: { path: string }[] } }).error.fields;
    expect(fields.map((field) => field.path)).toEqual(["display_name"]);
  });

  it("T-001-88/AC-1 T-001-14/AC-4 201 sets hp_guest and a later join with that guest extends it", async () => {
    const organizer = await signUp("Omar");
    const first = await createPlan(organizer.cookies, { title: "First plan" });
    const second = await createPlan(organizer.cookies, { title: "Second plan" });

    const start = Date.now();
    setClock(start);
    const firstJoin = await joinAnonymously(first.token, "Nour");
    expect(firstJoin.status).toBe(201);
    const firstCookie = guestCookie(firstJoin);
    expect(firstCookie).toBeDefined();
    expect(firstCookie).toContain("HttpOnly");
    expect(firstCookie).toContain("Max-Age=2592000");
    const guestCookies = server.cookies();
    expect(guestCookies).toContain("hp_guest=");

    const firstId = ((await firstJoin.json()) as { participant: { id: string } }).participant.id;
    const before = await sql<{ guest_session_id: string; expires_at: Date }[]>`
      SELECT p.guest_session_id, g.expires_at
      FROM participants p JOIN guest_sessions g ON g.id = p.guest_session_id
      WHERE p.id = ${firstId}
    `;
    expect(before[0]?.expires_at.getTime()).toBe(start + SESSION_TTL_MS);

    // Ten days later the same guest joins another plan: the cookie is set again and the stored
    // expiry moves forward on the same guest session.
    setClock(start + 10 * DAY_MS);
    const secondJoin = await joinAnonymously(second.token, "Nour", guestCookies);
    expect(secondJoin.status).toBe(201);
    expect(guestCookie(secondJoin)).toBeDefined();
    const secondId = ((await secondJoin.json()) as { participant: { id: string } }).participant.id;
    const after = await sql<{ guest_session_id: string; expires_at: Date }[]>`
      SELECT p.guest_session_id, g.expires_at
      FROM participants p JOIN guest_sessions g ON g.id = p.guest_session_id
      WHERE p.id = ${secondId}
    `;
    expect(after[0]?.guest_session_id).toBe(before[0]?.guest_session_id);
    expect(after[0]?.expires_at.getTime()).toBe(start + 10 * DAY_MS + SESSION_TTL_MS);
    expect(after[0]!.expires_at.getTime()).toBeGreaterThan(before[0]!.expires_at.getTime());
  });

  it("T-001-88/AC-1 T-001-14/AC-4 the same guest and plan return 200 and the existing participant, creating none", async () => {
    const organizer = await signUp("Omar");
    const plan = await createPlan(organizer.cookies);

    const first = await joinAnonymously(plan.token, "Nour");
    expect(first.status).toBe(201);
    const guestCookies = server.cookies();
    const created = (await first.json()) as { participant: { id: string; distinguisher: string } };

    const again = await joinAnonymously(plan.token, "Nour", guestCookies);
    expect(again.status).toBe(200);
    const existing = (await again.json()) as { participant: { id: string; distinguisher: string } };
    expect(existing.participant.id).toBe(created.participant.id);
    expect(existing.participant.distinguisher).toBe(created.participant.distinguisher);

    // A different name from the same guest still answers the existing participant.
    const renamed = await joinAnonymously(plan.token, "Someone Else", guestCookies);
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as { participant: { id: string } }).participant.id).toBe(
      created.participant.id,
    );
    expect(await participantCount(plan.id)).toBe(1);
  });

  it("T-001-88/AC-1 T-001-14/AC-4 a new guest session creates a new participant even when the display name matches", async () => {
    const organizer = await signUp("Omar");
    const plan = await createPlan(organizer.cookies);

    const first = await joinAnonymously(plan.token, "Nour");
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { participant: { id: string } };

    const second = await joinAnonymously(plan.token, "Nour");
    expect(second.status).toBe(201);
    expect(guestCookie(second)).toBeDefined();
    const secondBody = (await second.json()) as { participant: { id: string } };
    expect(secondBody.participant.id).not.toBe(firstBody.participant.id);

    const rows = await sql<{ id: string; display_name: string; guest_session_id: string }[]>`
      SELECT id, display_name, guest_session_id FROM participants WHERE plan_id = ${plan.id}
    `;
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.display_name)).toEqual(["Nour", "Nour"]);
    expect(new Set(rows.map((row) => row.guest_session_id)).size).toBe(2);
  });
});

describe("opening (T-001-15)", () => {
  it("T-001-88/AC-2 T-001-15/AC-1 GET opening answers next by caller and state, and preview is the join preview only when next is join", async () => {
    const organizer = await signUp("Omar");
    const invitee = await signUp("Salma");
    const plan = await createPlan(organizer.cookies, {
      title: "Thursday in Maadi",
      steps: [
        { name: "Dinner", options: ["Koshary", "Grills"] },
        { name: "Coffee", options: ["Turkish", "Filter"] },
      ],
    });
    const sent = await invite(organizer.cookies, plan.id, invitee.email);
    expect(sent.status).toBe(200);
    const joined = await joinAnonymously(plan.token, "Hana");
    expect(joined.status).toBe(201);
    const participant = server.cookies();

    const joinPreview = {
      title: "Thursday in Maadi",
      organizer_display_name: "Omar",
      timezone: "Africa/Cairo",
      windows: [{ local_date: "2026-10-02", start_local: "18:00", end_local: "19:00" }],
      budget: { amount_minor: 50_000, currency: "EGP" },
      step_names: ["Dinner", "Coffee"],
    };

    const table: [string, string, string, string, unknown][] = [
      ["organizer", "collecting", organizer.cookies, "organizer", null],
      ["organizer", "blocked", organizer.cookies, "organizer", null],
      ["organizer", "proposed", organizer.cookies, "organizer", null],
      ["organizer", "locked", organizer.cookies, "confirmed", null],
      ["participant", "collecting", participant, "respond", null],
      ["participant", "blocked", participant, "respond", null],
      ["participant", "proposed", participant, "proposal", null],
      ["participant", "locked", participant, "confirmed", null],
      ["invited", "collecting", invitee.cookies, "join", joinPreview],
      ["invited", "blocked", invitee.cookies, "join", joinPreview],
      ["invited", "proposed", invitee.cookies, "join", joinPreview],
      ["invited", "locked", invitee.cookies, "confirmed", null],
    ];
    const seen = new Set<string>();
    for (const [caller, state, cookies, next, preview] of table) {
      const label = `${caller} ${state}`;
      await setState(plan.id, state);
      server.useCookies(cookies);
      const response = await server.serve(`/api/v1/plans/${plan.id}/opening`);
      expect(response.status, label).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body, label).toEqual({ plan_id: plan.id, next, preview });
      seen.add(next);
      if (next === "join") {
        // The preview omits option labels, counts and the threshold.
        expect(JSON.stringify(body.preview), label).not.toContain("Koshary");
        expect(Object.keys(body.preview as object).sort(), label).toEqual(Object.keys(joinPreview).sort());
      }
    }
    expect([...seen].sort()).toEqual(["confirmed", "join", "organizer", "proposal", "respond"]);
  });
});

describe("invitations (T-001-16)", () => {
  it("T-001-88/AC-3 T-001-16/AC-3 an unknown email, an invalid email and the organizer's email each fail and add no invitation row", async () => {
    const organizer = await signUp("Omar");
    const invitee = await signUp("Hana");
    const plan = await createPlan(organizer.cookies);
    expect(await invitationCount(plan.id)).toBe(0);

    const unknown = `nobody-${randomBytes(6).toString("hex")}@example.com`;
    const cases: [string, string, number, string | null][] = [
      ["unknown email", unknown, 404, "account_not_found"],
      ["invalid email", "not-an-email", 400, null],
      ["empty email", "", 400, null],
      ["organizer email", organizer.email, 409, "cannot_invite_self"],
    ];
    for (const [label, email, status, reason] of cases) {
      const before = await invitationCount(plan.id);
      const response = await invite(organizer.cookies, plan.id, email);
      expect(response.status, label).toBe(status);
      const body = (await response.json()) as { error: { reason?: string; fields: unknown[] } };
      expect(body.error.reason, label).toBe(reason ?? undefined);
      expect(await invitationCount(plan.id), label).toBe(before);
    }
    expect(await invitationCount(plan.id)).toBe(0);

    // Control: a known account's email does add its row.
    const sent = await invite(organizer.cookies, plan.id, invitee.email);
    expect(sent.status).toBe(200);
    expect(await invitationCount(plan.id)).toBe(1);
  });
});

describe("invitation inbox (T-001-17)", () => {
  it("T-001-88/AC-4 T-001-17/AC-1 GET /v1/invitations answers this account's rows created_at descending, one row per plan, each with plan_id, title and organizer_display_name", async () => {
    const organizer = await signUp("Omar");
    const invitee = await signUp("Hana");
    const other = await signUp("Salma");
    const first = await createPlan(organizer.cookies, { title: "First" });
    const second = await createPlan(organizer.cookies, { title: "Second" });
    const third = await createPlan(organizer.cookies, { title: "Third" });
    const elsewhere = await createPlan(organizer.cookies, { title: "Not for Hana" });
    for (const plan of [first, second, third]) {
      expect((await invite(organizer.cookies, plan.id, invitee.email)).status).toBe(200);
    }
    expect((await invite(organizer.cookies, elsewhere.id, other.email)).status).toBe(200);
    // A further invitation of the same account to the same plan keeps a single row.
    expect((await invite(organizer.cookies, first.id, invitee.email)).status).toBe(200);

    server.useCookies(invitee.cookies);
    const response = await server.serve("/api/v1/invitations");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      invitations: { plan_id: string; title: string; organizer_display_name: string }[];
      truncated: boolean;
    };
    expect(body.truncated).toBe(false);
    expect(body.invitations).toEqual([
      { plan_id: third.id, title: "Third", organizer_display_name: "Omar" },
      { plan_id: second.id, title: "Second", organizer_display_name: "Omar" },
      { plan_id: first.id, title: "First", organizer_display_name: "Omar" },
    ]);
    for (const row of body.invitations) {
      expect(Object.keys(row).sort()).toEqual(["organizer_display_name", "plan_id", "title"]);
    }

    const stored = await sql<{ plan_id: string }[]>`
      SELECT i.plan_id FROM invitations i JOIN accounts a ON a.id = i.account_id
      WHERE a.email = ${invitee.email} ORDER BY i.created_at DESC
    `;
    expect(body.invitations.map((row) => row.plan_id)).toEqual(stored.map((row) => row.plan_id));
    expect(stored).toHaveLength(3);
  });

  it("T-001-88/AC-4 T-001-17/AC-1 101 invitations come back as the newest 100, newest first, flagged truncated", async () => {
    const organizer = await signUp("Omar");
    const invitee = await signUp("Hana");
    const invitedOrder: string[] = [];
    for (let i = 0; i < 101; i += 1) {
      const plan = await createPlan(organizer.cookies, { title: `Plan ${String(i).padStart(3, "0")}` });
      expect((await invite(organizer.cookies, plan.id, invitee.email)).status).toBe(200);
      invitedOrder.push(plan.id);
    }

    server.useCookies(invitee.cookies);
    const response = await server.serve("/api/v1/invitations");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      invitations: { plan_id: string; title: string; organizer_display_name: string }[];
      truncated: boolean;
    };
    expect(body.invitations).toHaveLength(100);
    expect(body.truncated).toBe(true);
    expect(body.invitations.map((row) => row.plan_id)).toEqual(invitedOrder.slice(1).reverse());
    expect(body.invitations[0]).toEqual({
      plan_id: invitedOrder[100],
      title: "Plan 100",
      organizer_display_name: "Omar",
    });
    expect(new Set(body.invitations.map((row) => row.plan_id)).size).toBe(100);
    expect(body.invitations.map((row) => row.plan_id)).not.toContain(invitedOrder[0]);
  }, 120_000);
});

describe("join UI (T-001-18)", () => {
  it("T-001-88/AC-5 T-001-18/AC-1 the join preview shows the title, organizer, timezone, day windows, per-person budget with currency and step names", async () => {
    const organizer = await signUp("Omar");
    const invitee = await signUp("Salma");
    const plan = await createPlan(organizer.cookies, {
      title: "Thursday in Maadi",
      budget: { amount_minor: 12_345, currency: "USD" },
      steps: [
        { name: "Dinner", options: ["Koshary", "Grills"] },
        { name: "Coffee", options: ["Turkish", "Filter"] },
      ],
    });
    expect((await invite(organizer.cookies, plan.id, invitee.email)).status).toBe(200);

    const rendered = await openJoinPage(plan.id, invitee.cookies);
    expect(redirectMock).not.toHaveBeenCalled();
    server.useCookies(invitee.cookies);
    show(rendered);

    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Thursday in Maadi");
    expect(screen.getByText(en.join.organizer.replace("{name}", "Omar"))).toBeTruthy();

    const section = (heading: string): HTMLElement => {
      const title = screen.getByRole("heading", { level: 2, name: heading });
      return title.parentElement as HTMLElement;
    };
    expect(section(en.join.timezone).textContent).toContain("Africa/Cairo");
    expect(section(en.join.windows).textContent).toContain("2026-10-02 18:00-19:00");
    expect(section(en.join.budget).textContent).toContain("123.45 USD");
    const steps = Array.from(section(en.join.steps).querySelectorAll("li")).map((li) => li.textContent);
    expect(steps).toEqual(["Dinner", "Coffee"]);

    // The preview omits the options.
    expect(document.body.textContent).not.toContain("Koshary");
    expect(document.body.textContent).not.toContain("Turkish");
  });

  it("T-001-88/AC-5 T-001-18/AC-1 the preview of an EGP plan shows the budget in EGP", async () => {
    const organizer = await signUp("Omar");
    const invitee = await signUp("Salma");
    const plan = await createPlan(organizer.cookies, {
      title: "Friday in Zamalek",
      budget: { amount_minor: 50_000, currency: "EGP" },
    });
    expect((await invite(organizer.cookies, plan.id, invitee.email)).status).toBe(200);

    const rendered = await openJoinPage(plan.id, invitee.cookies);
    server.useCookies(invitee.cookies);
    show(rendered);
    expect(await screen.findByText("Friday in Zamalek")).toBeTruthy();
    const budget = screen.getByRole("heading", { level: 2, name: en.join.budget }).parentElement;
    expect(budget?.textContent).toContain("500.00 EGP");
  });
});

describe("invite UI (T-001-19)", () => {
  it("T-001-88/AC-6 T-001-19/AC-7 the invitations page shows one row per plan with the authored title and organizer display name, and opening a row follows that plan's opening next", async () => {
    const organizer = await signUp("Omar");
    const invitee = await signUp("Hana");
    const open = await createPlan(organizer.cookies, { title: "Thursday in Maadi" });
    const locked = await createPlan(organizer.cookies, { title: "Friday in Zamalek" });
    const joined = await createPlan(organizer.cookies, { title: "Saturday in Dokki" });
    for (const plan of [open, locked, joined]) {
      expect((await invite(organizer.cookies, plan.id, invitee.email)).status).toBe(200);
    }
    // A further invitation of the same account to the same plan keeps a single row.
    expect((await invite(organizer.cookies, open.id, invitee.email)).status).toBe(200);
    // The invitee has already joined one plan as a participant.
    server.useCookies(invitee.cookies);
    const accepted = await call(`/api/v1/plans/${joined.id}/join`, "POST", { kind: "account" });
    expect(accepted.status).toBe(201);
    await setState(locked.id, "locked");

    const rendered = await openInvitationsPage(invitee.cookies);
    server.useCookies(invitee.cookies);
    show(rendered);

    expect(await screen.findByText("Thursday in Maadi")).toBeTruthy();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    for (const title of ["Thursday in Maadi", "Friday in Zamalek", "Saturday in Dokki"]) {
      const row = rows.find((item) => item.textContent?.includes(title));
      expect(row, title).toBeDefined();
      expect(row?.textContent, title).toContain(en.invitations.organizedBy.replace("{name}", "Omar"));
    }

    const expectations: [string, string, string][] = [
      ["Thursday in Maadi", open.id, "join"],
      ["Friday in Zamalek", locked.id, "confirmed"],
      ["Saturday in Dokki", joined.id, "respond"],
    ];
    for (const [title, planId, next] of expectations) {
      server.useCookies(invitee.cookies);
      const opening = await server.serve(`/api/v1/plans/${planId}/opening`);
      expect(opening.status, title).toBe(200);
      const openingBody = (await opening.json()) as { next: string };
      expect(openingBody.next, title).toBe(next);

      router.push.mockClear();
      fireEvent.click(screen.getByRole("button", { name: new RegExp(title) }));
      await vi.waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
      expect(router.push, title).toHaveBeenCalledWith(`/plans/${planId}/${openingBody.next}`);
    }
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
