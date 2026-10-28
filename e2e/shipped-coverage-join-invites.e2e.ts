/**
 * T-001-94 — AC coverage for shipped tickets T-001-14 (join by token), T-001-15 (opening),
 * T-001-16 (invitations), T-001-17 (invitation inbox), T-001-18 (join UI) and T-001-19 (invite UI).
 * Each test carries this ticket's tag, then the shipped AC's tag, and asserts every clause of that
 * AC through the route handlers and Postgres. Harness copied from e2e/shipped-join-invites.e2e.ts
 * (T-001-88): requests go through the route server, pages are rendered by calling their default
 * exports with `next/headers` answering the actor's cookies. The child-Vitest runs that prove
 * "handler tests use Postgres from DATABASE_URL" are copied from
 * e2e/shipped-coverage-shell-gate-plans.e2e.ts (T-001-92).
 *
 * T-001-15's AC text names `/v1/...`; the routes are `/api/v1/...` (ADR-0003). The tests below send
 * `/api/v1` URLs through the route server, which resolves each path to the route module Next.js
 * serves it from, so they prove those clauses on the `/api/v1` path.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import en from "../messages/en.json";
import { InvitePanel } from "@/components/invite-panel";
import { JoinPanel } from "@/components/join-panel";
import InvitePage from "@/app/plans/[planId]/invite/page";
import PlanJoinPage from "@/app/plans/[planId]/join/page";
import { resetClock } from "@/server/clock";
import { generateJoinToken, isDistinguisher } from "@/server/ids";
import { PARTICIPANT_CAP } from "@/server/join/open";
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
  usePathname: () => "/",
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
const root = process.cwd();
const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

const emails: string[] = [];
const planIds: string[] = [];
const scratchDatabases: string[] = [];

let server: RouteServer;

type Json = Record<string, unknown>;
type Participant = { id: string; display_name: string; distinguisher: string };
type JoinBody = { participant: Participant; next: string };
type Envelope = { error: { code: string; reason?: string; message: string; fields: unknown[] } };

async function call(path: string, method: string, body?: unknown, csrf = true): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (csrf) headers["x-hp-request"] = "1";
  return server.serve(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json<T = Json>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

type Account = { email: string; cookies: string; id: string };

async function signUp(displayName: string): Promise<Account> {
  server.useCookies("");
  const email = `shipped-cov-join-${randomBytes(6).toString("hex")}@example.com`;
  emails.push(email);
  const account = await call("/api/v1/accounts", "POST", {
    email,
    password: "password1",
    display_name: displayName,
  });
  expect(account.status).toBe(201);
  const body = await json<{ account: { id: string } }>(account);
  return { email, cookies: server.cookies(), id: body.account.id };
}

type PlanOptions = { title?: string; steps?: { name: string; options: string[] }[] };

/** A collecting plan owned by `organizer`; returns its id, join token and join path. */
async function createPlan(
  organizer: string,
  options: PlanOptions = {},
): Promise<{ id: string; token: string; joinPath: string }> {
  server.useCookies(organizer);
  const created = await call("/api/v1/plans", "POST", {
    title: options.title ?? "Thursday in Maadi",
    timezone: "Africa/Cairo",
    windows: [{ local_date: "2026-10-02", start_local: "18:00", end_local: "19:00" }],
    budget: { amount_minor: 50_000, currency: "EGP" },
    steps: options.steps ?? [{ name: "Dinner", options: ["Koshary", "Grills"] }],
    threshold: 3,
  });
  expect(created.status).toBe(201);
  const plan = await json<{ id: string; join_path: string }>(created);
  planIds.push(plan.id);
  return { id: plan.id, token: plan.join_path.slice("/join/".length), joinPath: plan.join_path };
}

async function invite(organizer: string, planId: string, email: string, csrf = true): Promise<Response> {
  server.useCookies(organizer);
  return call(`/api/v1/plans/${planId}/invitations`, "POST", { email }, csrf);
}

async function readInvite(cookies: string, planId: string): Promise<Response> {
  server.useCookies(cookies);
  return server.serve(`/api/v1/plans/${planId}/invite`);
}

/** POST /api/v1/join/{token} as anonymous with these cookies; the server keeps the new cookies. */
async function joinAnonymously(token: string, displayName: string, cookies = "", csrf = true): Promise<Response> {
  server.useCookies(cookies);
  return call(`/api/v1/join/${token}`, "POST", { kind: "anonymous", display_name: displayName }, csrf);
}

async function joinTokenAsAccount(token: string, cookies: string): Promise<Response> {
  server.useCookies(cookies);
  return call(`/api/v1/join/${token}`, "POST", { kind: "account" });
}

/** POST /api/v1/plans/{planId}/join (ADR-0003: the `/v1/...` path of T-001-15 is served here). */
async function joinPlan(planId: string, cookies: string, body: unknown = { kind: "account" }, csrf = true): Promise<Response> {
  server.useCookies(cookies);
  return call(`/api/v1/plans/${planId}/join`, "POST", body, csrf);
}

async function openByToken(token: string, cookies: string): Promise<Response> {
  server.useCookies(cookies);
  return server.serve(`/api/v1/join/${token}`);
}

async function setState(planId: string, state: string): Promise<void> {
  if (state === "locked") {
    await sql`UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${planId}`;
    return;
  }
  await sql`UPDATE plans SET state = ${state}, locked_at = NULL WHERE id = ${planId}`;
}

async function participantCount(planId: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM participants WHERE plan_id = ${planId}`;
  return rows[0]?.n ?? 0;
}

async function invitationCount(planId: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM invitations WHERE plan_id = ${planId}`;
  return rows[0]?.n ?? 0;
}

async function answeredCount(planId: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`SELECT answered_count AS n FROM plans WHERE id = ${planId}`;
  return rows[0]!.n;
}

/**
 * Marks the participant's answer complete. Answering through PUT /response needs the Google stub;
 * the invite status reads only `responses.complete`, so the row is written here as the shipped
 * handler tests do (src/app/api/v1/plans/[planId]/invite/route.test.ts).
 */
async function markAnswered(planId: string, participantId: string): Promise<void> {
  await sql`INSERT INTO responses (participant_id, complete) VALUES (${participantId}, true)`;
  await sql`UPDATE plans SET answered_count = answered_count + 1 WHERE id = ${planId}`;
}

/** Every row a join or invite request could write, for "writes nothing". */
async function snapshot(planId: string): Promise<unknown> {
  const plan = await sql`SELECT * FROM plans WHERE id = ${planId}`;
  const participants = await sql`SELECT * FROM participants WHERE plan_id = ${planId} ORDER BY id`;
  const invitations = await sql`SELECT * FROM invitations WHERE plan_id = ${planId} ORDER BY id`;
  const links = await sql`SELECT * FROM link_session_plans WHERE plan_id = ${planId} ORDER BY link_session_id`;
  const responses = await sql`
    SELECT r.* FROM responses r JOIN participants p ON p.id = r.participant_id
    WHERE p.plan_id = ${planId} ORDER BY r.participant_id
  `;
  const totals = await sql`
    SELECT
      (SELECT count(*)::int FROM accounts) AS accounts,
      (SELECT count(*)::int FROM sessions) AS sessions,
      (SELECT count(*)::int FROM guest_sessions) AS guest_sessions,
      (SELECT count(*)::int FROM link_sessions) AS link_sessions,
      (SELECT count(*)::int FROM link_session_plans) AS link_session_plans,
      (SELECT count(*)::int FROM participants) AS participants,
      (SELECT count(*)::int FROM invitations) AS invitations,
      (SELECT count(*)::int FROM responses) AS responses
  `;
  return { plan, participants, invitations, links, responses, totals };
}

function setCookieNames(response: Response): string[] {
  return response.headers.getSetCookie().map((line) => line.slice(0, line.indexOf("=")));
}

function expectEnvelopeOnly(body: unknown, code: string, reason?: string): void {
  const envelope = body as Envelope;
  expect(Object.keys(envelope)).toEqual(["error"]);
  expect(envelope.error.code).toBe(code);
  expect(envelope.error.reason).toBe(reason);
  expect(envelope.error.fields).toEqual([]);
  expect(Object.keys(envelope.error).sort()).toEqual(
    (reason === undefined ? ["code", "fields", "message"] : ["code", "fields", "message", "reason"]).sort(),
  );
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

/** Call /plans/{planId}/invite as the actor with these cookies; return the InvitePanel element. */
async function openInvitePage(planId: string, cookies: string): Promise<React.ReactElement> {
  cookieJar.value = cookies;
  const tree = await InvitePage({ params: Promise.resolve({ planId }) });
  return findElement(tree, InvitePanel, "InvitePanel");
}

function classTokens(element: Element): string[] {
  return element.className.split(/\s+/);
}

function stubClipboard(): ReturnType<typeof vi.fn> {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  return writeText;
}

// --- Child Vitest runs (copied from e2e/shipped-coverage-shell-gate-plans.e2e.ts, T-001-92) ----

type JsonReport = {
  success: boolean;
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  testResults: { name: string; status: string }[];
};

function childEnv(url: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (url === null) delete env.DATABASE_URL;
  else env.DATABASE_URL = url;
  delete env.HP_HASH_TEST;
  delete env.NODE_OPTIONS;
  return env;
}

function runChild(files: string[], url: string | null): JsonReport | null {
  const dir = mkdtempSync(join(tmpdir(), "t00194-"));
  const out = join(dir, "report.json");
  try {
    const result = spawnSync(
      process.execPath,
      [
        resolve(root, "node_modules/vitest/vitest.mjs"),
        "run",
        "--config",
        "vitest.config.ts",
        "--reporter=json",
        `--outputFile=${out}`,
        ...files,
      ],
      { cwd: root, env: childEnv(url), encoding: "utf8", timeout: 280_000 },
    );
    try {
      return JSON.parse(readFileSync(out, "utf8")) as JsonReport;
    } catch {
      // No report: the run itself failed (for example its global setup could not connect).
      expect(result.status, result.stderr).not.toBe(0);
      return null;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function expectAllPassed(report: JsonReport | null, files: string[]): void {
  if (report === null) throw new Error(`vitest wrote no report for ${files.join(", ")}`);
  expect(report.testResults.map((file) => file.name.slice(root.length + 1)).sort()).toEqual([...files].sort());
  expect(report.numFailedTests).toBe(0);
  expect(report.numTotalTests).toBeGreaterThan(0);
  expect(report.numPassedTests).toBe(report.numTotalTests);
  expect(report.success).toBe(true);
}

function expectNonePassed(report: JsonReport | null): void {
  if (report === null) return; // the run failed before any test
  expect(report.success).toBe(false);
  expect(report.numPassedTests).toBe(0);
}

function urlFor(database: string): string {
  const url = new URL(databaseUrl as string);
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * The handler test files pass against a scratch database that only DATABASE_URL names and leave
 * their writes in its statistics; without DATABASE_URL, or naming a database that does not exist,
 * none of them passes.
 */
async function expectHandlerTestsUseDatabaseUrl(files: string[], tables: string[]): Promise<void> {
  const name = `hangout_t94_${randomBytes(6).toString("hex")}`;
  scratchDatabases.push(name);
  await sql.unsafe(`CREATE DATABASE "${name}"`);
  expectAllPassed(runChild(files, urlFor(name)), files);
  const scratch = postgres(urlFor(name), { max: 1, onnotice: () => {} });
  try {
    const inserted = await scratch<{ relname: string; n_tup_ins: number }[]>`
      SELECT relname, n_tup_ins::int AS n_tup_ins FROM pg_stat_user_tables
      WHERE relname IN ${scratch(tables)} ORDER BY relname
    `;
    expect(inserted.map((row) => row.relname)).toEqual([...tables].sort());
    for (const row of inserted) {
      expect(row.n_tup_ins, row.relname).toBeGreaterThan(0);
    }
  } finally {
    await scratch.end();
  }

  expectNonePassed(runChild(files, null));
  await sql.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  expectNonePassed(runChild(files, urlFor(name)));
}

// --- Harness ------------------------------------------------------------------------------------

beforeEach(() => {
  server = createRouteServer();
  vi.stubGlobal("fetch", server.serve);
  process.env.HP_HASH_TEST = "1";
  router.push.mockClear();
  router.replace.mockClear();
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
  for (const name of scratchDatabases) {
    await sql.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
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

// --- T-001-14 join by token ---------------------------------------------------------------------

describe("join by token (T-001-14)", () => {
  it("T-001-94/AC-1 T-001-14/AC-3 the organizer receives next organizer or confirmed and is not inserted as a participant; an existing account or guest participant is returned without a second participant", async () => {
    const organizer = await signUp("Omar");
    const member = await signUp("Nour");
    const plan = await createPlan(organizer.cookies);

    const memberJoin = await joinTokenAsAccount(plan.token, member.cookies);
    expect(memberJoin.status).toBe(201);
    const memberParticipant = (await json<JoinBody>(memberJoin)).participant;
    const guestJoin = await joinAnonymously(plan.token, "Hana");
    expect(guestJoin.status).toBe(201);
    const guest = server.cookies();
    const guestParticipant = (await json<JoinBody>(guestJoin)).participant;
    expect(await participantCount(plan.id)).toBe(2);

    // The organizer opens the link: next organizer while not locked, confirmed while locked, and
    // never a participant row.
    for (const state of ["collecting", "blocked", "proposed"]) {
      await setState(plan.id, state);
      const opened = await openByToken(plan.token, organizer.cookies);
      expect(opened.status, state).toBe(200);
      expect(await json(opened), state).toEqual({ plan_id: plan.id, next: "organizer", preview: null });
      expect(await participantCount(plan.id), state).toBe(2);
    }
    await setState(plan.id, "collecting");

    // The existing account and guest participants open the link and join again: each gets its own
    // participant back with 200, and no second participant is created.
    for (const [label, cookies, expected, body] of [
      ["account", member.cookies, memberParticipant, { kind: "account" }],
      ["guest", guest, guestParticipant, { kind: "anonymous", display_name: "Hana" }],
    ] as const) {
      const opened = await openByToken(plan.token, cookies);
      expect(opened.status, label).toBe(200);
      expect(await json(opened), label).toEqual({ plan_id: plan.id, next: "respond", preview: null });

      server.useCookies(cookies);
      const again = await call(`/api/v1/join/${plan.token}`, "POST", body);
      expect(again.status, label).toBe(200);
      expect(await json(again), label).toEqual({ participant: expected, next: "respond" });
      expect(await participantCount(plan.id), label).toBe(2);
    }

    await setState(plan.id, "locked");
    const lockedOrganizer = await openByToken(plan.token, organizer.cookies);
    expect(lockedOrganizer.status).toBe(200);
    expect(await json(lockedOrganizer)).toEqual({ plan_id: plan.id, next: "confirmed", preview: null });

    const rows = await sql<{ id: string; account_id: string | null }[]>`
      SELECT id, account_id FROM participants WHERE plan_id = ${plan.id} ORDER BY id
    `;
    expect(rows.map((row) => row.id).sort()).toEqual([memberParticipant.id, guestParticipant.id].sort());
    expect(rows.map((row) => row.account_id)).not.toContain(organizer.id);
  });

  it("T-001-94/AC-1 T-001-14/AC-6 locked, organizer and full return 409 plan_locked, organizer_cannot_join or plan_full and create no participant; POST without X-HP-Request: 1 returns 403 csrf and writes nothing", async () => {
    const organizer = await signUp("Omar");
    const member = await signUp("Nour");
    const plan = await createPlan(organizer.cookies);

    // Missing X-HP-Request: 403 csrf, no cookie set, and no row anywhere changes.
    const before = await snapshot(plan.id);
    for (const [label, cookies, body] of [
      ["anonymous", "", { kind: "anonymous", display_name: "Nour" }],
      ["account", member.cookies, { kind: "account" }],
    ] as const) {
      server.useCookies(cookies);
      const csrf = await call(`/api/v1/join/${plan.token}`, "POST", body, false);
      expect(csrf.status, label).toBe(403);
      expectEnvelopeOnly(await json(csrf), "forbidden", "csrf");
      expect(setCookieNames(csrf), label).toEqual([]);
      expect(await snapshot(plan.id), label).toEqual(before);
    }

    const conflict = async (response: Response, reason: string, label: string): Promise<void> => {
      expect(response.status, label).toBe(409);
      expectEnvelopeOnly(await json(response), "conflict", reason);
      expect(setCookieNames(response), label).not.toContain("hp_guest");
    };

    await conflict(await joinTokenAsAccount(plan.token, organizer.cookies), "organizer_cannot_join", "organizer");
    expect(await participantCount(plan.id)).toBe(0);

    await setState(plan.id, "locked");
    await conflict(await joinAnonymously(plan.token, "Nour"), "plan_locked", "locked anonymous");
    await conflict(await joinTokenAsAccount(plan.token, member.cookies), "plan_locked", "locked account");
    expect(await participantCount(plan.id)).toBe(0);

    await setState(plan.id, "collecting");
    for (let index = 0; index < PARTICIPANT_CAP; index += 1) {
      expect((await joinAnonymously(plan.token, `Guest ${index}`)).status).toBe(201);
    }
    expect(await participantCount(plan.id)).toBe(PARTICIPANT_CAP);
    await conflict(await joinAnonymously(plan.token, "Nour"), "plan_full", "full anonymous");
    await conflict(await joinTokenAsAccount(plan.token, member.cookies), "plan_full", "full account");
    expect(await participantCount(plan.id)).toBe(PARTICIPANT_CAP);
  }, 120_000);

  it("T-001-94/AC-1 T-001-14/AC-8 the join-by-token handler tests use Postgres from DATABASE_URL", async () => {
    await expectHandlerTestsUseDatabaseUrl(
      ["src/app/api/v1/join/[token]/route.test.ts"],
      ["accounts", "participants", "plans"],
    );
  }, 600_000);
});

// --- T-001-15 opening and in-app join -----------------------------------------------------------

describe("opening and in-app join (T-001-15)", () => {
  it("T-001-94/AC-2 T-001-15/AC-3 POST /api/v1/plans/{planId}/join accepts kind account only, uses the account display name, and does not return the join token", async () => {
    // ADR-0003: T-001-15 names POST /v1/plans/{planId}/join; it is served at /api/v1.
    const organizer = await signUp("Omar");
    const invited = await signUp("Nour El");
    const plan = await createPlan(organizer.cookies);
    expect((await invite(organizer.cookies, plan.id, invited.email)).status).toBe(200);

    for (const [label, body, code] of [
      ["anonymous", { kind: "anonymous", display_name: "Nour" }, "not_one"],
      ["unknown kind", { kind: "guest" }, "not_one"],
      ["no kind", { display_name: "Nour" }, "required"],
    ] as const) {
      const rejected = await joinPlan(plan.id, invited.cookies, body);
      expect(rejected.status, label).toBe(400);
      expect(await json(rejected), label).toMatchObject({
        error: { code: "validation_failed", fields: [{ path: "kind", code }] },
      });
      expect(await participantCount(plan.id), label).toBe(0);
    }

    const joined = await joinPlan(plan.id, invited.cookies, { kind: "account", display_name: "Someone Else" });
    expect(joined.status).toBe(201);
    const body = await json<JoinBody>(joined);
    expect(Object.keys(body).sort()).toEqual(["next", "participant"]);
    expect(Object.keys(body.participant).sort()).toEqual(["display_name", "distinguisher", "id"]);
    expect(body.participant.display_name).toBe("Nour El");
    expect(body.next).toBe("respond");
    const text = JSON.stringify(body);
    expect(text).not.toContain(plan.token);
    expect(text).not.toContain(plan.joinPath);
    expect(text).not.toContain("jt_");
    expect(setCookieNames(joined)).not.toContain("hp_link");

    const stored = await sql<{ display_name: string; account_id: string }[]>`
      SELECT display_name, account_id FROM participants WHERE plan_id = ${plan.id}
    `;
    expect(stored).toEqual([{ display_name: "Nour El", account_id: invited.id }]);
  });

  it("T-001-94/AC-2 T-001-15/AC-6 a stranger gets 404 with the envelope only; missing X-HP-Request: 1 on POST returns 403 csrf and writes nothing", async () => {
    const organizer = await signUp("Omar");
    const invited = await signUp("Hana");
    const stranger = await signUp("Sam");
    const plan = await createPlan(organizer.cookies, { title: "Secret supper" });
    expect((await invite(organizer.cookies, plan.id, invited.email)).status).toBe(200);
    expect((await joinAnonymously(plan.token, "Ziad")).status).toBe(201);
    const before = await snapshot(plan.id);

    // ADR-0003: the `/v1/...` paths of T-001-15 are served at /api/v1.
    const leaks = [plan.id, "Secret supper", "Omar", "Hana", "Ziad", "Dinner", "Koshary", plan.token];
    for (const [label, cookies] of [["stranger account", stranger.cookies]] as const) {
      server.useCookies(cookies);
      const opening = await server.serve(`/api/v1/plans/${plan.id}/opening`);
      expect(opening.status, label).toBe(404);
      const openingBody = await json(opening);
      expectEnvelopeOnly(openingBody, "not_found");
      const posted = await joinPlan(plan.id, cookies);
      expect(posted.status, label).toBe(404);
      const postedBody = await json(posted);
      expectEnvelopeOnly(postedBody, "not_found");
      expect(postedBody, label).toEqual(openingBody);
      for (const leak of leaks) {
        expect(JSON.stringify(openingBody), `${label} ${leak}`).not.toContain(leak);
        expect(JSON.stringify(postedBody), `${label} ${leak}`).not.toContain(leak);
      }
      expect(await snapshot(plan.id), label).toEqual(before);
    }

    const csrf = await joinPlan(plan.id, invited.cookies, { kind: "account" }, false);
    expect(csrf.status).toBe(403);
    expectEnvelopeOnly(await json(csrf), "forbidden", "csrf");
    expect(setCookieNames(csrf)).toEqual([]);
    expect(await snapshot(plan.id)).toEqual(before);

    // Control: the same request with the header joins.
    expect((await joinPlan(plan.id, invited.cookies)).status).toBe(201);
    expect(await snapshot(plan.id)).not.toEqual(before);
  });

  it("T-001-94/AC-2 T-001-15/AC-7 the opening and in-app join handler tests use Postgres from DATABASE_URL", async () => {
    await expectHandlerTestsUseDatabaseUrl(
      ["src/app/api/v1/plans/[planId]/join/route.test.ts", "src/app/api/v1/plans/[planId]/opening/route.test.ts"],
      ["invitations", "participants", "plans"],
    );
  }, 600_000);
});

// --- T-001-16 invitations -----------------------------------------------------------------------

describe("invitations (T-001-16)", () => {
  it("T-001-94/AC-3 T-001-16/AC-1 GET invite returns a join_path that stays the same for the life of the plan, and one row per account in created_at order with display_name, distinguisher, and status invited, joined, or answered", async () => {
    const organizer = await signUp("Omar");
    const nour = await signUp("Nour");
    const ziad = await signUp("Ziad");
    const hana = await signUp("Hana");
    const plan = await createPlan(organizer.cookies);

    const readBody = async (label: string) => {
      const response = await readInvite(organizer.cookies, plan.id);
      expect(response.status, label).toBe(200);
      const body = await json<{ join_path: string; invitations: Json[] }>(response);
      expect(Object.keys(body).sort(), label).toEqual(["invitations", "join_path"]);
      expect(body.join_path, label).toBe(plan.joinPath);
      return body;
    };

    expect((await readBody("new plan")).invitations).toEqual([]);

    server.useCookies(organizer.cookies);
    const edited = await call(`/api/v1/plans/${plan.id}`, "PATCH", { title: "Friday in Zamalek" });
    expect(edited.status).toBe(200);
    await readBody("after an edit");

    // Invited in this order: Nour, Ziad, Hana.
    for (const account of [nour, ziad, hana]) {
      expect((await invite(organizer.cookies, plan.id, account.email)).status).toBe(200);
    }
    const nourJoin = await joinPlan(plan.id, nour.cookies);
    expect(nourJoin.status).toBe(201);
    const nourParticipant = (await json<JoinBody>(nourJoin)).participant;
    const ziadJoin = await joinPlan(plan.id, ziad.cookies);
    expect(ziadJoin.status).toBe(201);
    const ziadParticipant = (await json<JoinBody>(ziadJoin)).participant;
    await markAnswered(plan.id, ziadParticipant.id);
    // A guest participant is not an invited account and has no row.
    expect((await joinAnonymously(plan.token, "Guest")).status).toBe(201);
    // Inviting Nour again keeps Nour's single row in its first place.
    expect((await invite(organizer.cookies, plan.id, nour.email)).status).toBe(200);

    const hanaInvite = await sql<{ distinguisher: string }[]>`
      SELECT i.distinguisher FROM invitations i WHERE i.plan_id = ${plan.id} AND i.account_id = ${hana.id}
    `;
    const expectedRows = [
      { display_name: "Nour", distinguisher: nourParticipant.distinguisher, status: "joined" },
      { display_name: "Ziad", distinguisher: ziadParticipant.distinguisher, status: "answered" },
      { display_name: "Hana", distinguisher: hanaInvite[0]!.distinguisher, status: "invited" },
    ];
    const order = await sql<{ account_id: string }[]>`
      SELECT account_id FROM invitations WHERE plan_id = ${plan.id} ORDER BY created_at, id
    `;
    expect(order.map((row) => row.account_id)).toEqual([nour.id, ziad.id, hana.id]);

    for (const state of ["collecting", "blocked", "proposed"]) {
      await setState(plan.id, state);
      const body = await readBody(state);
      expect(body.invitations, state).toEqual(expectedRows);
      for (const row of body.invitations) {
        expect(Object.keys(row).sort(), state).toEqual(["display_name", "distinguisher", "status"]);
        expect(isDistinguisher(row.distinguisher as string), state).toBe(true);
      }
    }
    const stored = await sql<{ join_token: string }[]>`SELECT join_token FROM plans WHERE id = ${plan.id}`;
    expect(`/join/${stored[0]!.join_token}`).toBe(plan.joinPath);
  });

  it("T-001-94/AC-3 T-001-16/AC-6 a stranger gets 404 with the envelope only; a participant, invited account, or link reader gets 403 organizer_only; missing X-HP-Request: 1 returns 403 csrf and writes nothing", async () => {
    const organizer = await signUp("Omar");
    const member = await signUp("Nour");
    const invited = await signUp("Hana");
    const stranger = await signUp("Sam");
    const target = await signUp("Ziad");
    const plan = await createPlan(organizer.cookies, { title: "Secret supper" });
    expect((await invite(organizer.cookies, plan.id, member.email)).status).toBe(200);
    expect((await invite(organizer.cookies, plan.id, invited.email)).status).toBe(200);
    expect((await joinPlan(plan.id, member.cookies)).status).toBe(201);
    // A link reader: opened the share link without an account and holds only hp_link.
    const opened = await openByToken(plan.token, "");
    expect(opened.status).toBe(200);
    const linkReader = server.cookies();
    expect(linkReader).toContain("hp_link=");
    expect(linkReader).not.toContain("hp_session=");
    const before = await snapshot(plan.id);

    for (const [label, cookies] of [
      ["participant", member.cookies],
      ["invited account", invited.cookies],
      ["link reader", linkReader],
    ] as const) {
      const read = await readInvite(cookies, plan.id);
      expect(read.status, label).toBe(403);
      expectEnvelopeOnly(await json(read), "forbidden", "organizer_only");
      const sent = await invite(cookies, plan.id, target.email);
      expect(sent.status, label).toBe(403);
      expectEnvelopeOnly(await json(sent), "forbidden", "organizer_only");
      expect(await snapshot(plan.id), label).toEqual(before);
    }

    const leaks = [plan.id, "Secret supper", "Omar", "Nour", "Hana", target.email, plan.token];
    const read = await readInvite(stranger.cookies, plan.id);
    expect(read.status).toBe(404);
    const readBody = await json(read);
    expectEnvelopeOnly(readBody, "not_found");
    const sent = await invite(stranger.cookies, plan.id, target.email);
    expect(sent.status).toBe(404);
    const sentBody = await json(sent);
    expectEnvelopeOnly(sentBody, "not_found");
    for (const leak of leaks) {
      expect(JSON.stringify(readBody), leak).not.toContain(leak);
      expect(JSON.stringify(sentBody), leak).not.toContain(leak);
    }
    expect(await snapshot(plan.id)).toEqual(before);

    const csrf = await invite(organizer.cookies, plan.id, target.email, false);
    expect(csrf.status).toBe(403);
    expectEnvelopeOnly(await json(csrf), "forbidden", "csrf");
    expect(await snapshot(plan.id)).toEqual(before);

    // Control: the organizer's request with the header adds the row.
    expect((await invite(organizer.cookies, plan.id, target.email)).status).toBe(200);
    expect(await invitationCount(plan.id)).toBe(3);
  });

  it("T-001-94/AC-3 T-001-16/AC-7 the invite and invitations handler tests use Postgres from DATABASE_URL", async () => {
    await expectHandlerTestsUseDatabaseUrl(
      ["src/app/api/v1/plans/[planId]/invite/route.test.ts", "src/app/api/v1/plans/[planId]/invitations/route.test.ts"],
      ["accounts", "invitations", "plans"],
    );
  }, 600_000);
});

// --- T-001-17 invitation inbox ------------------------------------------------------------------

describe("invitation inbox (T-001-17)", () => {
  it("T-001-94/AC-4 T-001-17/AC-5 a failed read does not include another plan's people or places", async () => {
    const organizer = await signUp("Omar");
    const hana = await signUp("Hana");
    const mine = await createPlan(organizer.cookies, { title: "Thursday in Maadi" });
    const other = await createPlan(organizer.cookies, {
      title: "Secret supper",
      steps: [{ name: "Dinner", options: ["Hidden Grill", "Quiet Cafe"] }],
    });
    expect((await invite(organizer.cookies, mine.id, hana.email)).status).toBe(200);
    // The other plan has people and places: a participant whose answer names a starting place.
    const joined = await joinAnonymously(other.token, "Secret Person");
    expect(joined.status).toBe(201);
    const person = (await json<JoinBody>(joined)).participant;
    const guestOnly = server.cookies();
    expect(guestOnly).toContain("hp_guest=");
    expect(guestOnly).not.toContain("hp_session=");
    await sql`
      INSERT INTO responses (participant_id, start_google_place_id, start_name, start_lat, start_lng, complete)
      VALUES (${person.id}, 'ChIJ-secret-start', 'Helwan rooftop', 29.85, 31.33, true)
    `;

    // Control: the inbox read itself succeeds for Hana and shows only her row.
    server.useCookies(hana.cookies);
    const ok = await server.serve("/api/v1/invitations");
    expect(ok.status).toBe(200);
    expect(await json(ok)).toEqual({
      invitations: [{ plan_id: mine.id, title: "Thursday in Maadi", organizer_display_name: "Omar" }],
      truncated: false,
    });

    const leaks = [
      other.id,
      "Secret supper",
      "Secret Person",
      person.distinguisher,
      "Helwan rooftop",
      "ChIJ-secret-start",
      "Hidden Grill",
      "Quiet Cafe",
      mine.id,
      "Thursday in Maadi",
      "Omar",
      hana.email,
    ];
    const hanaSession = hana.cookies.split(";").find((pair) => pair.trim().startsWith("hp_session="))!;
    for (const [label, cookies] of [
      ["no cookies", ""],
      ["unknown session", "hp_session=not-a-session"],
      ["a participant's guest cookie only", guestOnly],
      ["expired session", hanaSession],
    ] as const) {
      if (label === "expired session") {
        await sql`UPDATE sessions SET expires_at = ${new Date("2020-01-01T00:00:00.000Z")} WHERE account_id = ${hana.id}`;
      }
      server.useCookies(cookies);
      const failed = await server.serve("/api/v1/invitations");
      expect(failed.status, label).toBe(401);
      const body = await json(failed);
      expectEnvelopeOnly(body, "unauthenticated", "missing_session");
      for (const leak of leaks) {
        expect(JSON.stringify(body), `${label} ${leak}`).not.toContain(leak);
      }
    }
  });

  it("T-001-94/AC-4 T-001-17/AC-6 the invitation inbox handler tests use Postgres from DATABASE_URL", async () => {
    await expectHandlerTestsUseDatabaseUrl(["src/app/api/v1/invitations/route.test.ts"], ["accounts", "invitations", "plans"]);
  }, 600_000);
});

// --- T-001-18 join UI ---------------------------------------------------------------------------

describe("join UI (T-001-18)", () => {
  it("T-001-94/AC-5 T-001-18/AC-4 an unknown link uses text-destructive and shows no other plan's title and no participant list; a failed account join stays here and still is not a participant; an empty display name is identified and creates no participant", async () => {
    const organizer = await signUp("Omar");
    const member = await signUp("Nour");
    const other = await createPlan(organizer.cookies, { title: "Secret supper" });
    expect((await joinAnonymously(other.token, "Secret Person")).status).toBe(201);
    // The visitor has opened the other plan's link, so a stale hp_link for it is present.
    expect((await openByToken(other.token, "")).status).toBe(200);
    const visitor = server.cookies();

    // An unknown link.
    server.useCookies(visitor);
    show(React.createElement(JoinPanel, { token: generateJoinToken() }));
    const unknown = await screen.findByRole("alert");
    expect(unknown.textContent).toBe(en.join.unknownLink);
    expect(classTokens(unknown)).toContain("text-destructive");
    expect(document.body.textContent).not.toContain("Secret supper");
    expect(document.body.textContent).not.toContain("Secret Person");
    expect(document.body.textContent).not.toContain("Omar");
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByRole("listitem")).toBeNull();
    cleanup();

    // A failed account join: the session ends after the preview loaded, so the join answers 401.
    const plan = await createPlan(organizer.cookies, { title: "Thursday in Maadi" });
    server.useCookies(member.cookies);
    show(React.createElement(JoinPanel, { token: plan.token }));
    expect(await screen.findByRole("heading", { level: 1, name: "Thursday in Maadi" })).toBeTruthy();
    const joinButton = await screen.findByRole("button", { name: en.join.joinWithAccount });
    await sql`DELETE FROM sessions WHERE account_id = ${member.id}`;
    fireEvent.click(joinButton);
    const failed = await screen.findByRole("alert");
    expect(failed.textContent).toBe(en.errors.reason.missing_session);
    expect(classTokens(failed)).toContain("text-destructive");
    expect(screen.getByRole("heading", { level: 1, name: "Thursday in Maadi" })).toBeTruthy();
    expect(screen.getByRole("button", { name: en.join.joinWithoutAccount })).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(server.requested).toContain(`POST /api/v1/join/${plan.token}`);
    expect(await participantCount(plan.id)).toBe(0);
    cleanup();

    // An empty display name.
    server.useCookies("");
    show(React.createElement(JoinPanel, { token: plan.token }));
    await screen.findByRole("heading", { level: 1, name: "Thursday in Maadi" });
    const postsBefore = server.requested.filter((entry) => entry.startsWith("POST ")).length;
    fireEvent.change(screen.getByLabelText(en.join.displayName), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: en.join.joinWithoutAccount }));
    const nameError = await screen.findByText(en.join.nameRequired);
    expect(classTokens(nameError)).toContain("text-destructive");
    expect(screen.getByLabelText(en.join.displayName).getAttribute("aria-invalid")).toBe("true");
    expect(server.requested.filter((entry) => entry.startsWith("POST ")).length).toBe(postsBefore);
    expect(router.push).not.toHaveBeenCalled();
    expect(await participantCount(plan.id)).toBe(0);
  });

  it("T-001-94/AC-5 T-001-18/AC-5 while locked the join surface is absent and the open shows the confirmed surface", async () => {
    const organizer = await signUp("Omar");
    const invited = await signUp("Hana");
    const plan = await createPlan(organizer.cookies, { title: "Thursday in Maadi" });
    expect((await invite(organizer.cookies, plan.id, invited.email)).status).toBe(200);
    expect((await joinAnonymously(plan.token, "Nour")).status).toBe(201);
    const participant = server.cookies();
    await setState(plan.id, "locked");
    const confirmed = `/plans/${plan.id}/confirmed`;

    // Opening the share link: the link reader, the invited account and the participant.
    for (const [label, cookies] of [
      ["link reader", ""],
      ["invited account", invited.cookies],
      ["participant", participant],
    ] as const) {
      router.replace.mockClear();
      server.useCookies(cookies);
      show(React.createElement(JoinPanel, { token: plan.token }));
      await waitFor(() => expect(router.replace, label).toHaveBeenCalledWith(confirmed));
      expect(screen.queryByText("Thursday in Maadi"), label).toBeNull();
      expect(screen.queryByRole("button", { name: en.join.joinWithAccount }), label).toBeNull();
      expect(screen.queryByRole("link", { name: en.join.joinWithAccount }), label).toBeNull();
      expect(screen.queryByRole("button", { name: en.join.joinWithoutAccount }), label).toBeNull();
      expect(screen.queryByLabelText(en.join.displayName), label).toBeNull();
      cleanup();
    }

    // Opening /plans/{planId}/join directly: the page redirects to the confirmed surface.
    for (const [label, cookies] of [
      ["invited account", invited.cookies],
      ["participant", participant],
    ] as const) {
      redirectMock.mockClear();
      cookieJar.value = cookies;
      await expect(PlanJoinPage({ params: Promise.resolve({ planId: plan.id }) }), label).rejects.toThrow(
        `NEXT_REDIRECT ${confirmed}`,
      );
      expect(redirectMock, label).toHaveBeenCalledWith(confirmed);
    }
    expect(await participantCount(plan.id)).toBe(1);
  });
});

// --- T-001-19 invite UI -------------------------------------------------------------------------

describe("invite UI (T-001-19)", () => {
  it("T-001-94/AC-6 T-001-19/AC-4 a failed identification or failed send uses text-destructive, leaves the answered count unchanged, adds no row, and leaves the link section usable", async () => {
    const organizer = await signUp("Omar");
    const nour = await signUp("Nour");
    const hana = await signUp("Hana");
    const plan = await createPlan(organizer.cookies);
    expect((await invite(organizer.cookies, plan.id, nour.email)).status).toBe(200);
    const joined = await joinPlan(plan.id, nour.cookies);
    expect(joined.status).toBe(201);
    await markAnswered(plan.id, (await json<JoinBody>(joined)).participant.id);
    expect(await answeredCount(plan.id)).toBe(1);

    const rendered = await openInvitePage(plan.id, organizer.cookies);
    expect(redirectMock).not.toHaveBeenCalled();
    server.useCookies(organizer.cookies);
    show(rendered);
    const shareUrl = `${window.location.origin}${plan.joinPath}`;
    expect(await screen.findByText(shareUrl)).toBeTruthy();
    const rows = (): string[] => screen.queryAllByRole("listitem").map((item) => item.textContent ?? "");
    const shownBefore = rows();
    expect(shownBefore).toEqual([`Nour${en.invite.statusAnswered}`]);
    const storedBefore = await snapshot(plan.id);

    const realFetch = server.serve;
    const failures: [string, string, string, () => void][] = [
      ["unknown email", `nobody-${randomBytes(6).toString("hex")}@example.com`, en.invite.identifyFailed, () => {}],
      ["the organizer's own email", organizer.email, en.errors.reason.cannot_invite_self, () => {}],
      [
        "unreachable server",
        hana.email,
        en.invite.sendFailed,
        () => {
          // The send never reaches the server: the network fails for this one request.
          vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
            if ((init?.method ?? "GET").toUpperCase() === "POST") throw new TypeError("Failed to fetch");
            return realFetch(input, init);
          });
        },
      ],
    ];
    for (const [label, email, message, arrange] of failures) {
      arrange();
      fireEvent.change(screen.getByLabelText(en.invite.email), { target: { value: email } });
      fireEvent.click(screen.getByRole("button", { name: en.invite.send }));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent, label).toBe(message);
      expect(classTokens(alert), label).toContain("text-destructive");
      expect(rows(), label).toEqual(shownBefore);
      expect(await answeredCount(plan.id), label).toBe(1);
      expect(await snapshot(plan.id), label).toEqual(storedBefore);

      // The link section is still there and its copy control still copies the link.
      expect(screen.getByText(shareUrl), label).toBeTruthy();
      const writeText = stubClipboard();
      fireEvent.click(screen.getByRole("button", { name: en.invite.copy }));
      await waitFor(() => expect(writeText, label).toHaveBeenCalledWith(shareUrl));
      expect(screen.queryByText(en.invite.copyFailed), label).toBeNull();
      vi.stubGlobal("fetch", realFetch);
    }
    expect(await invitationCount(plan.id)).toBe(1);
  });

  it("T-001-94/AC-6 T-001-19/AC-5 while locked the invite surface is absent: the organizer's open redirects to confirmed and GET invite returns neither the link nor the invitations", async () => {
    const organizer = await signUp("Omar");
    const nour = await signUp("Nour");
    const hana = await signUp("Hana");
    const plan = await createPlan(organizer.cookies, { title: "Thursday in Maadi" });
    expect((await invite(organizer.cookies, plan.id, nour.email)).status).toBe(200);
    expect((await invite(organizer.cookies, plan.id, hana.email)).status).toBe(200);
    expect((await joinPlan(plan.id, nour.cookies)).status).toBe(201);

    // Control: before the lock the organizer's read carries the link and both rows.
    const before = await readInvite(organizer.cookies, plan.id);
    expect(before.status).toBe(200);
    const beforeText = await before.text();
    expect(beforeText).toContain(plan.joinPath);
    expect(beforeText).toContain("Nour");
    expect(beforeText).toContain("Hana");

    await setState(plan.id, "locked");
    const confirmed = `/plans/${plan.id}/confirmed`;
    const stored = await snapshot(plan.id);

    // Opening /plans/{planId}/invite as the organizer: the page redirects and renders no InvitePanel.
    redirectMock.mockClear();
    cookieJar.value = organizer.cookies;
    await expect(InvitePage({ params: Promise.resolve({ planId: plan.id }) })).rejects.toThrow(
      `NEXT_REDIRECT ${confirmed}`,
    );
    expect(redirectMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith(confirmed);

    // GET /api/v1/plans/{planId}/invite: an error envelope with no link and no invitations.
    const locked = await readInvite(organizer.cookies, plan.id);
    expect(locked.status).toBe(409);
    const lockedText = await locked.text();
    const body = JSON.parse(lockedText) as Envelope;
    expectEnvelopeOnly(body, "conflict", "plan_locked");
    expect(body).not.toHaveProperty("join_path");
    expect(body).not.toHaveProperty("invitations");
    for (const leak of [plan.joinPath, plan.token, "/join/", "Nour", "Hana", nour.email, hana.email]) {
      expect(lockedText, leak).not.toContain(leak);
    }
    expect(await snapshot(plan.id)).toEqual(stored);
  });
});
