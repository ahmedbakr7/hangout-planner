/**
 * T-001-92 — AC coverage for shipped tickets T-001-07 (shell), T-001-08 (account gate),
 * T-001-09 (plan rules) and T-001-10 (plans HTTP). Each test carries this ticket's tag, then the
 * shipped AC's tag, and asserts every clause of that AC through the route handlers and Postgres.
 * Harness copied from e2e/shipped-plans-shell.e2e.ts (T-001-87): requests go through the route
 * server, pages are rendered by calling their default exports with `next/headers` answering the
 * actor's cookies. The child-Vitest purity guard is copied from e2e/shipped-coverage-foundations.e2e.ts.
 *
 * T-001-10's AC text names `/v1/...`; the routes are `/api/v1/...` (ADR-0003). The tests below
 * send `/api/v1` URLs through the route server, which resolves each path to the route module
 * Next.js serves it from, so they prove those clauses on the `/api/v1` path.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import createNextIntlPlugin from "next-intl/plugin";
import React from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import nextConfig from "../next.config";
import { AccountGate } from "@/components/account-gate";
import AccountPage from "@/app/account/page";
import RootLayout from "@/app/layout";
import requestConfig, { mergeMessages } from "@/i18n/request";
import { editableFor } from "@/server/plans/edit-rules";
import { generateId, generateJoinToken } from "@/server/ids";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { closeDatabase as closeJoin } from "@/server/join/db";
import { closeDatabase as closeAttempt } from "@/server/proposal/attempt";
import { closeDatabase as closeInbox } from "@/server/invites/inbox";
import { cleanupThenClose } from "./db-cleanup";
import { createRouteServer, routeFor, type RouteServer } from "./route-server";

const { cookieJar, router } = vi.hoisted(() => ({
  cookieJar: { value: "" },
  router: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  },
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

// The font loader is a build-time transform; outside `next build` it only needs to answer a class name.
vi.mock("next/font/local", () => ({ default: () => ({ variable: "font-var" }) }));

// Under jsdom the "next-intl/server" entry resolves to its client build, whose getRequestConfig
// throws. The server build (what Next.js loads for src/i18n/request.ts) returns the callback as
// is; this does the same, so the test calls the product's own request config.
vi.mock("next-intl/server", () => ({ getRequestConfig: <T>(create: T): T => create }));

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}
const root = process.cwd();
const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

const emails: string[] = [];
const scratchDatabases: string[] = [];

let server: RouteServer;

type Json = Record<string, unknown>;
type Field = { path: string; code: string };
type Envelope = { error: { code: string; reason?: string; message: string; fields: Field[] } };

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

/** A new account; the server keeps its cookies. */
async function signUp(displayName = "Omar", password = "password1"): Promise<{ email: string; cookies: string; id: string }> {
  server.useCookies("");
  const email = `shipped-gate-${randomBytes(6).toString("hex")}@example.com`;
  emails.push(email);
  const account = await call("/api/v1/accounts", "POST", { email, password, display_name: displayName });
  expect(account.status).toBe(201);
  const body = await json<{ account: { id: string } }>(account);
  return { email, cookies: server.cookies(), id: body.account.id };
}

const validPlan = {
  title: "Thursday in Maadi",
  timezone: "Africa/Cairo",
  windows: [{ local_date: "2026-10-02", start_local: "18:00", end_local: "23:00" }],
  budget: { amount_minor: 50_000, currency: "EGP" },
  steps: [{ name: "Dinner", options: ["Koshary", "Grills"] }],
  threshold: 3,
};

type OrganizerPlan = {
  id: string;
  title: string;
  state: string;
  timezone: string;
  windows: { id: string; local_date: string; start_local: string; end_local: string }[];
  budget: { amount_minor: number; currency: string };
  steps: { id: string; name: string; options: { id: string; label: string }[] }[];
  threshold: number;
  answered_count: number;
  in_progress_count: number;
  participants: { id: string; display_name: string; distinguisher: string; status: string }[];
  editable: Json;
  join_path?: string;
};

const ORGANIZER_KEYS = [
  "answered_count",
  "budget",
  "editable",
  "id",
  "in_progress_count",
  "participants",
  "state",
  "steps",
  "threshold",
  "timezone",
  "title",
  "windows",
];

/** A collecting plan created by the account whose cookies the server holds. */
async function createPlan(overrides: Json = {}): Promise<OrganizerPlan> {
  const created = await call("/api/v1/plans", "POST", { ...validPlan, ...overrides });
  expect(created.status).toBe(201);
  return json<OrganizerPlan>(created);
}

/** Everything a plan write could touch, for "writes nothing" checks. */
async function planSnapshot(planId: string): Promise<unknown> {
  const plan = await sql`
    SELECT title, timezone, budget_amount_minor, currency, threshold, state, answered_count, updated_at
    FROM plans WHERE id = ${planId}
  `;
  const windows = await sql`
    SELECT id, local_date, start_local, end_local FROM plan_windows WHERE plan_id = ${planId} ORDER BY id
  `;
  const steps = await sql`SELECT id, name, position FROM plan_steps WHERE plan_id = ${planId} ORDER BY id`;
  const options = await sql`
    SELECT o.id, o.label FROM plan_options o JOIN plan_steps s ON s.id = o.step_id
    WHERE s.plan_id = ${planId} ORDER BY o.id
  `;
  const participants = await sql`SELECT id, display_name FROM participants WHERE plan_id = ${planId} ORDER BY id`;
  return JSON.parse(JSON.stringify({ plan, windows, steps, options, participants }));
}

async function totals(): Promise<{ plans: number; participants: number }> {
  const [row] = await sql<{ plans: number; participants: number }[]>`
    SELECT (SELECT count(*)::int FROM plans) AS plans, (SELECT count(*)::int FROM participants) AS participants
  `;
  return row as { plans: number; participants: number };
}

function expectEnvelope(body: unknown, code: string, reason?: string): Envelope {
  expect(Object.keys(body as Json)).toEqual(["error"]);
  const envelope = body as Envelope;
  const keys = Object.keys(envelope.error).sort();
  expect(keys).toEqual(reason === undefined ? ["code", "fields", "message"] : ["code", "fields", "message", "reason"]);
  expect(envelope.error.code).toBe(code);
  expect(envelope.error.reason).toBe(reason);
  expect(typeof envelope.error.message).toBe("string");
  expect(envelope.error.fields).toEqual([]);
  return envelope;
}

function show(element: React.ReactElement, locale = "en", messages: object = en) {
  return render(
    React.createElement(
      NextIntlClientProvider,
      { locale, messages } as React.ComponentProps<typeof NextIntlClientProvider>,
      element,
    ),
  );
}

async function renderLayout(cookie: string): Promise<React.ReactElement<{ lang: string; dir: string }>> {
  cookieJar.value = cookie;
  const tree = await RootLayout({ children: null });
  return tree as React.ReactElement<{ lang: string; dir: string }>;
}

/** Plain data for comparing configs: functions become a marker, so two plugin results compare. */
function shape(value: unknown): unknown {
  if (typeof value === "function") return "[function]";
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, shape(inner)]));
  }
  return value;
}

// --- Child Vitest runs (copied from e2e/shipped-coverage-foundations.e2e.ts, T-001-91) ----------

/**
 * Runs unit test files in a child Vitest with no DATABASE_URL and with every outgoing socket and
 * `fetch` refused, so a test that touches a database or the network fails.
 */
const GUARD = [
  'import net from "node:net";',
  "const refuse = (what) => { throw new Error('blocked outgoing ' + what); };",
  "net.Socket.prototype.connect = function (...args) { refuse('socket ' + JSON.stringify(args[0])); };",
  "globalThis.fetch = async (input) => refuse('fetch ' + String(input));",
].join("\n");

type ChildEnv = { databaseUrl: string | null; guard: boolean };

function childEnv({ databaseUrl: url, guard }: ChildEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (url === null) delete env.DATABASE_URL;
  else env.DATABASE_URL = url;
  delete env.HP_HASH_TEST;
  if (guard) env.NODE_OPTIONS = `--import=data:text/javascript,${encodeURIComponent(GUARD)}`;
  else delete env.NODE_OPTIONS;
  return env;
}

type JsonReport = {
  success: boolean;
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  testResults: { name: string; status: string }[];
};

function runChild(files: string[], env: ChildEnv): JsonReport | null {
  const dir = mkdtempSync(join(tmpdir(), "t00192-"));
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
      { cwd: root, env: childEnv(env), encoding: "utf8", timeout: 280_000 },
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

// --- Harness ------------------------------------------------------------------------------------

beforeEach(() => {
  server = createRouteServer();
  vi.stubGlobal("fetch", server.serve);
  process.env.HP_HASH_TEST = "1";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete process.env.HP_HASH_TEST;
  cookieJar.value = "";
  router.push.mockReset();
  router.refresh.mockReset();
  router.replace.mockReset();
  document.cookie = "hp_locale=;path=/;max-age=0";
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});

async function wipePlan(planId: string): Promise<void> {
  const guests = await sql<{ id: string }[]>`
    SELECT DISTINCT guest_session_id AS id FROM participants
    WHERE plan_id = ${planId} AND guest_session_id IS NOT NULL
  `;
  const links = await sql<{ id: string }[]>`
    SELECT DISTINCT link_session_id AS id FROM link_session_plans WHERE plan_id = ${planId}
  `;
  for (const table of ["place_searches", "response_picks", "response_windows", "responses"]) {
    await sql.unsafe(
      `DELETE FROM ${table} WHERE participant_id IN (SELECT id FROM participants WHERE plan_id = $1)`,
      [planId],
    );
  }
  await sql`DELETE FROM proposal_runs WHERE plan_id = ${planId}`;
  await sql`DELETE FROM participants WHERE plan_id = ${planId}`;
  await sql`DELETE FROM invitations WHERE plan_id = ${planId}`;
  await sql`DELETE FROM link_session_plans WHERE plan_id = ${planId}`;
  await sql`DELETE FROM plan_options WHERE step_id IN (SELECT id FROM plan_steps WHERE plan_id = ${planId})`;
  await sql`DELETE FROM plan_steps WHERE plan_id = ${planId}`;
  await sql`DELETE FROM plan_windows WHERE plan_id = ${planId}`;
  await sql`DELETE FROM plans WHERE id = ${planId}`;
  for (const link of links) {
    await sql`
      DELETE FROM link_sessions WHERE id = ${link.id}
      AND NOT EXISTS (SELECT 1 FROM link_session_plans WHERE link_session_id = ${link.id})
    `;
  }
  for (const guest of guests) {
    await sql`
      DELETE FROM guest_sessions WHERE id = ${guest.id}
      AND NOT EXISTS (SELECT 1 FROM participants WHERE guest_session_id = ${guest.id})
    `;
  }
}

async function deleteSeededRows(): Promise<void> {
  const accounts =
    emails.length === 0 ? [] : await sql<{ id: string }[]>`SELECT id FROM accounts WHERE email IN ${sql(emails)}`;
  // Every seeded plan first: an account may be a participant in another seeded account's plan.
  for (const account of accounts) {
    const plans = await sql<{ id: string }[]>`SELECT id FROM plans WHERE organizer_account_id = ${account.id}`;
    for (const plan of plans) {
      await wipePlan(plan.id);
    }
  }
  for (const account of accounts) {
    await sql`DELETE FROM invitations WHERE account_id = ${account.id}`;
    await sql`DELETE FROM participants WHERE account_id = ${account.id}`;
    await sql`DELETE FROM sessions WHERE account_id = ${account.id}`;
    await sql`DELETE FROM accounts WHERE id = ${account.id}`;
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

// --- T-001-07: shell ----------------------------------------------------------------------------

describe("T-001-07 shell, through the real stack", () => {
  it("T-001-92/AC-1 T-001-07/AC-4 locale is the hp_locale cookie, not a URL prefix, and next.config.ts only adds next-intl", async () => {
    // Locale is the cookie: the layout and the next-intl request config both read hp_locale.
    for (const [cookie, locale, dir] of [
      ["hp_locale=ar", "ar", "rtl"],
      ["hp_locale=en", "en", "ltr"],
      ["", "en", "ltr"],
    ] as const) {
      const html = await renderLayout(cookie);
      expect(html.props.lang, cookie).toBe(locale);
      expect(html.props.dir, cookie).toBe(dir);
      cookieJar.value = cookie;
      // Whatever locale a URL would carry, the request config answers the cookie's.
      for (const requested of ["en", "ar", undefined]) {
        const config = await (requestConfig as unknown as (params: {
          requestLocale: Promise<string | undefined>;
        }) => Promise<{ locale: string; messages: Json }>)({ requestLocale: Promise.resolve(requested) });
        expect(config.locale, `${cookie} with ${String(requested)}`).toBe(locale);
        expect((config.messages.Account as Json).title).toBe(locale === "ar" ? ar.Account.title : en.Account.title);
      }
    }

    // Not a URL prefix: no route segment carries a locale, so a prefixed path is served by nothing.
    const segments: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          segments.push(name);
          walk(path);
        }
      }
    };
    walk(resolve(root, "src/app"));
    expect(segments.length).toBeGreaterThan(0);
    for (const segment of segments) {
      expect(["ar", "en", "[locale]", "[lang]"]).not.toContain(segment);
    }
    expect(routeFor("/api/v1/currencies")).not.toBeNull();
    for (const prefixed of ["/ar/api/v1/currencies", "/en/api/v1/currencies"]) {
      expect(routeFor(prefixed), prefixed).toBeNull();
    }
    await signUp();
    cookieJar.value = "";
    expect((await call("/api/v1/currencies", "GET")).status).toBe(200);
    expect((await call("/ar/api/v1/currencies", "GET")).status).toBe(404);
    expect(server.unserved).toEqual(["GET /ar/api/v1/currencies"]);

    // The exported Next config equals the next-intl plugin applied to `{}`, and it has no
    // `i18n` key (no locale routing by URL prefix).
    expect(shape(nextConfig)).toEqual(shape(createNextIntlPlugin()({})));
    expect((nextConfig as Json).i18n).toBeUndefined();
  });
});

// --- T-001-08: account gate ---------------------------------------------------------------------

describe("T-001-08 account gate, through the real stack", () => {
  it("T-001-92/AC-2 T-001-08/AC-2 a failed sign-in or registration stays on the gate, signed out, keeps non-secret values, creates no plan or participant, and uses text-destructive", async () => {
    const existing = await signUp("Nour");
    server.useCookies("");
    const before = await totals();

    // Failed sign-in: wrong password for a real account.
    show(React.createElement(AccountGate, { next: "/plans/new" }));
    await screen.findByText(en.Account.requiredToOrganize);
    fireEvent.change(screen.getByLabelText(en.Account.email), { target: { value: existing.email } });
    fireEvent.change(screen.getByLabelText(en.Account.password), { target: { value: "wrong-password" } });
    fireEvent.click(screen.getByRole("button", { name: en.Account.submitSignIn }));
    const signInAlert = await screen.findByRole("alert");
    expect(signInAlert.className.split(/\s+/)).toContain("text-destructive");
    expect(screen.getByText(en.Account.requiredToOrganize)).toBeTruthy();
    expect(screen.queryByText(/Signed in as/)).toBeNull();
    expect((screen.getByLabelText(en.Account.email) as HTMLInputElement).value).toBe(existing.email);
    expect((screen.getByLabelText(en.Account.password) as HTMLInputElement).value).toBe("");
    expect(router.push).not.toHaveBeenCalled();
    expect(server.cookies()).not.toContain("hp_session=");
    expect((await call("/api/v1/me", "GET")).status).toBe(401);
    expect(await totals()).toEqual(before);
    cleanup();

    // Failed registration: the email already has an account.
    server.useCookies("");
    show(React.createElement(AccountGate, { next: "/plans/new" }));
    await screen.findByText(en.Account.requiredToOrganize);
    fireEvent.click(screen.getByRole("tab", { name: en.Account.register }));
    fireEvent.change(screen.getByLabelText(en.Account.email), { target: { value: existing.email } });
    fireEvent.change(screen.getByLabelText(en.Account.password), { target: { value: "another-pass" } });
    fireEvent.change(screen.getByLabelText(en.Account.displayName), { target: { value: "Nour Again" } });
    fireEvent.click(screen.getByRole("button", { name: en.Account.submitRegister }));
    const registerAlert = await screen.findByRole("alert");
    expect(registerAlert.className.split(/\s+/)).toContain("text-destructive");
    expect(screen.getByText(en.Account.requiredToOrganize)).toBeTruthy();
    expect(screen.queryByText(/Signed in as/)).toBeNull();
    expect((screen.getByLabelText(en.Account.email) as HTMLInputElement).value).toBe(existing.email);
    expect((screen.getByLabelText(en.Account.displayName) as HTMLInputElement).value).toBe("Nour Again");
    expect((screen.getByLabelText(en.Account.password) as HTMLInputElement).value).toBe("");
    expect(router.push).not.toHaveBeenCalled();
    expect(server.cookies()).not.toContain("hp_session=");
    expect((await call("/api/v1/me", "GET")).status).toBe(401);
    expect(await totals()).toEqual(before);
    const accounts = await sql`SELECT id FROM accounts WHERE email = ${existing.email}`;
    expect(accounts).toHaveLength(1);

    expect(server.requested.filter((line) => line.includes("/plans") || line.includes("/join"))).toEqual([]);
    expect(server.unserved).toEqual([]);
  });

  it("T-001-92/AC-2 T-001-08/AC-6 a missing Arabic key renders the English string in an RTL layout and the gate stays usable", async () => {
    const account = await signUp("Nour");
    server.useCookies("");

    // The layout for hp_locale=ar is RTL Arabic; the document takes its lang and dir.
    const html = await renderLayout("hp_locale=ar");
    expect(html.props.lang).toBe("ar");
    expect(html.props.dir).toBe("rtl");
    document.documentElement.lang = html.props.lang;
    document.documentElement.dir = html.props.dir;

    // Arabic catalog with one gate key missing, merged over English as the request config does.
    type Tree = { [key: string]: string | Tree };
    const overlay = structuredClone(ar) as unknown as Tree;
    delete (overlay.Account as Tree).requiredToOrganize;
    const messages = mergeMessages(en as unknown as Tree, overlay);

    // The account page, signed out, through its real loader.
    cookieJar.value = "hp_locale=ar";
    const page = await AccountPage({ searchParams: Promise.resolve({ next: "/invitations" }) });
    show(page, "ar", messages);

    expect(screen.getByText(en.Account.requiredToOrganize)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: ar.Account.title })).toBeTruthy();
    expect(document.documentElement.dir).toBe("rtl");
    expect(document.documentElement.lang).toBe("ar");

    // Usable: sign in through the Arabic form with a real account and continue to next.
    fireEvent.change(screen.getByLabelText(ar.Account.email), { target: { value: account.email } });
    fireEvent.change(screen.getByLabelText(ar.Account.password), { target: { value: "password1" } });
    fireEvent.click(screen.getByRole("button", { name: ar.Account.submitSignIn }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith("/invitations");
    });
    expect(server.cookies()).toContain("hp_session=");
    const me = await call("/api/v1/me", "GET");
    expect(me.status).toBe(200);
    expect((await json<{ account: { display_name: string } }>(me)).account.display_name).toBe("Nour");
    expect(document.documentElement.dir).toBe("rtl");
    expect(server.unserved).toEqual([]);
  });
});

// --- T-001-09: plan rules -----------------------------------------------------------------------

describe("T-001-09 plan rules", () => {
  it("T-001-92/AC-3 T-001-09/AC-8 the plan rule and view tests are pure: they pass with no database and no network", () => {
    const files = ["src/server/plans/edit-rules.test.ts", "src/server/plans/views.test.ts"];

    // The guard bites: a handler test that needs Postgres fails under it, and fetch is refused.
    expectNonePassed(runChild(["src/app/api/v1/currencies/route.test.ts"], { databaseUrl: null, guard: true }));
    expectNonePassed(
      runChild(["src/app/api/v1/currencies/route.test.ts"], { databaseUrl, guard: true }),
    );
    const probe = spawnSync(
      process.execPath,
      ["-e", `fetch("https://places.googleapis.com/").then(() => process.exit(0), (e) => { console.error(String(e)); process.exit(3); })`],
      { cwd: root, env: childEnv({ databaseUrl: null, guard: true }), encoding: "utf8", timeout: 30_000 },
    );
    expect(probe.status).toBe(3);
    expect(probe.stderr).toContain("blocked outgoing fetch");

    // The rule and view tests pass in full under the same guard.
    expectAllPassed(runChild(files, { databaseUrl: null, guard: true }), files);
  }, 300_000);
});

// --- T-001-10: plans HTTP -----------------------------------------------------------------------

describe("T-001-10 plans HTTP, through the real stack (ADR-0003: /api/v1 paths)", () => {
  it("T-001-92/AC-4 T-001-10/AC-1 GET /api/v1/currencies returns EGP, USD, SAR, and AED, each exponent 2, for an account", async () => {
    await signUp();
    const response = await call("/api/v1/currencies", "GET");
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      currencies: [
        { code: "EGP", exponent: 2 },
        { code: "USD", exponent: 2 },
        { code: "SAR", exponent: 2 },
        { code: "AED", exponent: 2 },
      ],
    });

    // Only for an account: no session is 401 missing_session.
    server.useCookies("");
    const anonymous = await call("/api/v1/currencies", "GET");
    expect(anonymous.status).toBe(401);
    expectEnvelope(await json(anonymous), "unauthenticated", "missing_session");
    expect(server.unserved).toEqual([]);
  });

  it("T-001-92/AC-4 T-001-10/AC-3 GET /api/v1/plans returns only plans this account organizes, updated_at descending, at most 100, and empty is plans [] with truncated false", async () => {
    // Empty: an account that organizes nothing.
    await signUp("Empty");
    const empty = await call("/api/v1/plans", "GET");
    expect(empty.status).toBe(200);
    expect(await json(empty)).toEqual({ plans: [], truncated: false });

    // Another account's plan, which the organizer below joins as a participant.
    const other = await signUp("Hana");
    const otherPlan = await createPlan({ title: "Hana's plan" });
    const otherToken = (otherPlan.join_path as string).slice("/join/".length);

    const organizer = await signUp("Omar");
    const first = await createPlan({ title: "First" });
    const second = await createPlan({ title: "Second" });
    const third = await createPlan({ title: "Third" });
    expect((await call(`/api/v1/join/${otherToken}`, "POST", { kind: "account" })).status).toBe(201);
    await sql`UPDATE plans SET updated_at = ${new Date("2026-01-03T00:00:00.000Z")} WHERE id = ${first.id}`;
    await sql`UPDATE plans SET updated_at = ${new Date("2026-01-01T00:00:00.000Z")} WHERE id = ${second.id}`;
    await sql`UPDATE plans SET updated_at = ${new Date("2026-01-02T00:00:00.000Z")} WHERE id = ${third.id}`;

    server.useCookies(organizer.cookies);
    const listed = await call("/api/v1/plans", "GET");
    expect(listed.status).toBe(200);
    const body = await json<{ plans: { id: string; title: string }[]; truncated: boolean }>(listed);
    expect(body.truncated).toBe(false);
    expect(body.plans.map((plan) => plan.id)).toEqual([first.id, third.id, second.id]);
    expect(body.plans.map((plan) => plan.id)).not.toContain(otherPlan.id);
    expect(body.plans[0]).toEqual({ id: first.id, title: "First", answered_count: 0, threshold: 3, state: "collecting" });

    server.useCookies(other.cookies);
    const otherList = await json<{ plans: { id: string }[] }>(await call("/api/v1/plans", "GET"));
    expect(otherList.plans.map((plan) => plan.id)).toEqual([otherPlan.id]);

    // At most 100: an account with 101 plans gets the newest 100, updated_at descending.
    const many = await signUp("Many");
    for (let index = 0; index < 101; index += 1) {
      await sql`
        INSERT INTO plans (
          id, organizer_account_id, title, timezone, budget_amount_minor,
          currency, threshold, answered_count, state, join_token, updated_at
        ) VALUES (
          ${generateId("pln_")}, ${many.id}, ${`Plan ${index}`}, 'Africa/Cairo', 50000,
          'EGP', 3, 0, 'collecting', ${generateJoinToken()}, ${new Date(Date.UTC(2026, 0, 1, 0, 0, index))}
        )
      `;
    }
    server.useCookies(many.cookies);
    const capped = await json<{ plans: { title: string }[]; truncated: boolean }>(await call("/api/v1/plans", "GET"));
    expect(capped.plans).toHaveLength(100);
    expect(capped.plans.map((plan) => plan.title)).toEqual(
      Array.from({ length: 100 }, (_, index) => `Plan ${100 - index}`),
    );
    expect(capped.truncated).toBe(true);
    expect(server.unserved).toEqual([]);
  });

  it("T-001-92/AC-4 T-001-10/AC-4 GET /api/v1/plans/{planId} returns the organizer document without starting points, picks or itinerary; participant, invited account and link reader get 403 organizer_only; a stranger 404; locked 409 plan_locked", async () => {
    const member = await signUp("Nour");
    const invited = await signUp("Hana");
    const stranger = await signUp("Ziad");
    const organizer = await signUp("Omar");
    const plan = await createPlan();
    const token = (plan.join_path as string).slice("/join/".length);

    // A participant with an account, two guests, an invited account and a link reader.
    server.useCookies(member.cookies);
    expect((await call(`/api/v1/join/${token}`, "POST", { kind: "account" })).status).toBe(201);
    const guestCookies: string[] = [];
    for (const name of ["Karim", "Laila"]) {
      server.useCookies("");
      expect((await call(`/api/v1/join/${token}`, "POST", { kind: "anonymous", display_name: name })).status).toBe(201);
      guestCookies.push(server.cookies());
    }
    server.useCookies(organizer.cookies);
    expect((await call(`/api/v1/plans/${plan.id}/invitations`, "POST", { email: invited.email })).status).toBe(200);
    server.useCookies("");
    expect((await call(`/api/v1/join/${token}`, "GET")).status).toBe(200);
    const linkReader = server.cookies();
    expect(linkReader).toContain("hp_link=");

    // Order: created_at, then id. The two guests share a created_at; Nour joined first.
    const rows = await sql<{ id: string; display_name: string }[]>`
      SELECT id, display_name FROM participants WHERE plan_id = ${plan.id}
    `;
    const byName = new Map(rows.map((row) => [row.display_name, row.id]));
    const [nour, karim, laila] = [byName.get("Nour"), byName.get("Karim"), byName.get("Laila")] as string[];
    await sql`UPDATE participants SET created_at = ${new Date("2026-09-01T10:00:00.000Z")} WHERE id = ${nour}`;
    await sql`UPDATE participants SET created_at = ${new Date("2026-09-02T10:00:00.000Z")} WHERE id IN (${karim}, ${laila})`;
    const tied = [karim, laila].sort();

    // Nour answered with a starting point and a pick.
    await sql`
      INSERT INTO responses (participant_id, start_google_place_id, start_name, start_lat, start_lng, complete, first_completed_at)
      VALUES (${nour}, 'ChIJ-start-nour', 'Maadi Corniche', 29.9612, 31.2513, true, now())
    `;
    await sql`
      INSERT INTO response_picks (participant_id, step_id, option_id)
      VALUES (${nour}, ${plan.steps[0]?.id ?? ""}, ${plan.steps[0]?.options[0]?.id ?? ""})
    `;
    await sql`UPDATE plans SET answered_count = 1 WHERE id = ${plan.id}`;

    server.useCookies(organizer.cookies);
    const response = await call(`/api/v1/plans/${plan.id}`, "GET");
    expect(response.status).toBe(200);
    const body = await json<OrganizerPlan>(response);
    expect(Object.keys(body).sort()).toEqual([...ORGANIZER_KEYS].sort());
    expect(body).toMatchObject({
      id: plan.id,
      title: "Thursday in Maadi",
      state: "collecting",
      timezone: "Africa/Cairo",
      budget: { amount_minor: 50_000, currency: "EGP" },
      threshold: 3,
      windows: plan.windows,
      steps: plan.steps,
    });
    expect(body.editable).toEqual(editableFor("collecting", 1));
    expect(body.answered_count).toBe(1);
    expect(body.in_progress_count).toBe(2);
    expect(body.participants.map((participant) => participant.id)).toEqual([nour, ...tied]);
    expect(body.participants[0]).toMatchObject({ id: nour, display_name: "Nour", status: "answered" });
    for (const participant of body.participants) {
      expect(Object.keys(participant).sort()).toEqual(["display_name", "distinguisher", "id", "status"]);
    }
    expect(body.participants.slice(1).map((participant) => participant.status)).toEqual(["in_progress", "in_progress"]);
    const text = JSON.stringify(body);
    for (const leak of ["ChIJ-start-nour", "Maadi Corniche", "29.9612", "31.2513", '"start"', "starting", "picks", "itinerary", "proposal", "legs"]) {
      expect(text, leak).not.toContain(leak);
    }

    // Everyone but the organizer.
    for (const [who, cookies] of [
      ["participant account", member.cookies],
      ["participant guest", guestCookies[0] as string],
      ["invited account", invited.cookies],
      ["link reader", linkReader],
    ] as const) {
      server.useCookies(cookies);
      const denied = await call(`/api/v1/plans/${plan.id}`, "GET");
      expect(denied.status, who).toBe(403);
      expectEnvelope(await json(denied), "forbidden", "organizer_only");
    }
    server.useCookies(stranger.cookies);
    const hidden = await call(`/api/v1/plans/${plan.id}`, "GET");
    expect(hidden.status).toBe(404);
    const hiddenBody = await json(hidden);
    expectEnvelope(hiddenBody, "not_found");
    expect(JSON.stringify(hiddenBody)).not.toContain("Thursday");

    await sql`UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${plan.id}`;
    server.useCookies(organizer.cookies);
    const locked = await call(`/api/v1/plans/${plan.id}`, "GET");
    expect(locked.status).toBe(409);
    expectEnvelope(await json(locked), "conflict", "plan_locked");
    expect(server.unserved).toEqual([]);
  });

  it("T-001-92/AC-4 T-001-10/AC-5 PATCH applies a legal subset and returns the organizer plan; frozen or illegal is 409 field_frozen and locked is 409 plan_locked, both writing nothing; stored text comes back as entered", async () => {
    const organizer = await signUp("Omar");
    const title = "خميس في المعادي ☕ Thursday";
    const plan = await createPlan({
      title,
      steps: [
        { name: "عشاء Dinner", options: ["كشري Koshary", "Grills & Co."] },
        { name: "قهوة", options: ["تركي", "Filter", "V60"] },
      ],
    });
    const token = (plan.join_path as string).slice("/join/".length);
    server.useCookies("");
    expect(
      (await call(`/api/v1/join/${token}`, "POST", { kind: "anonymous", display_name: "نور El-Sayed" })).status,
    ).toBe(201);
    server.useCookies(organizer.cookies);

    // A legal subset while open: threshold and budget (another currency); the rest stays.
    const legal = await call(`/api/v1/plans/${plan.id}`, "PATCH", {
      threshold: 4,
      budget: { amount_minor: 30_000, currency: "USD" },
    });
    expect(legal.status).toBe(200);
    const patched = await json<OrganizerPlan>(legal);
    expect(Object.keys(patched).sort()).toEqual([...ORGANIZER_KEYS].sort());
    expect(patched.threshold).toBe(4);
    expect(patched.budget).toEqual({ amount_minor: 30_000, currency: "USD" });
    expect(patched.timezone).toBe("Africa/Cairo");
    expect(patched.windows).toEqual(plan.windows);
    expect(patched.steps).toEqual(plan.steps);
    // Stored title, step names, option labels and display names come back as entered.
    expect(patched.title).toBe(title);
    expect(patched.steps.map((step) => step.name)).toEqual(["عشاء Dinner", "قهوة"]);
    expect(patched.steps.map((step) => step.options.map((option) => option.label))).toEqual([
      ["كشري Koshary", "Grills & Co."],
      ["تركي", "Filter", "V60"],
    ]);
    expect(patched.participants.map((participant) => participant.display_name)).toEqual(["نور El-Sayed"]);
    const [stored] = await sql<{ threshold: number; currency: string; budget_amount_minor: number; title: string }[]>`
      SELECT threshold, currency, budget_amount_minor::int AS budget_amount_minor, title FROM plans WHERE id = ${plan.id}
    `;
    expect(stored).toEqual({ threshold: 4, currency: "USD", budget_amount_minor: 30_000, title });

    // A title-only subset after the first answer is legal too, and comes back as entered.
    await sql`UPDATE plans SET answered_count = 1 WHERE id = ${plan.id}`;
    const renamed = "  Friday بالليل  ";
    const retitled = await call(`/api/v1/plans/${plan.id}`, "PATCH", { title: renamed });
    expect(retitled.status).toBe(200);
    expect((await json<OrganizerPlan>(retitled)).title).toBe(renamed.trim());

    // Frozen keys and illegal changes: 409 field_frozen, nothing written.
    const frozenCases: [Json, Field[]][] = [
      [{ timezone: "Asia/Dubai" }, [{ path: "timezone", code: "frozen" }]],
      [{ steps: [{ name: "Lunch", options: ["A", "B"] }] }, [{ path: "steps", code: "frozen" }]],
      [{ budget: { amount_minor: 20_000, currency: "USD" } }, [{ path: "budget", code: "frozen" }]],
      [
        { budget: { amount_minor: 90_000, currency: "EGP" } },
        [
          { path: "budget", code: "frozen" },
          { path: "currency", code: "frozen" },
        ],
      ],
      [{ threshold: 9 }, [{ path: "threshold", code: "frozen" }]],
      [{ title: "Not this", windows: [] }, [{ path: "windows", code: "frozen" }]],
    ];
    for (const [patch, fields] of frozenCases) {
      const before = await planSnapshot(plan.id);
      const rejected = await call(`/api/v1/plans/${plan.id}`, "PATCH", patch);
      expect(rejected.status, JSON.stringify(patch)).toBe(409);
      const envelope = await json<Envelope>(rejected);
      expect(envelope.error).toMatchObject({ code: "conflict", reason: "field_frozen" });
      expect(envelope.error.fields).toEqual(fields);
      expect(await planSnapshot(plan.id)).toEqual(before);
    }

    // Locked: 409 plan_locked, nothing written, even for a title.
    await sql`UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${plan.id}`;
    const lockedBefore = await planSnapshot(plan.id);
    const locked = await call(`/api/v1/plans/${plan.id}`, "PATCH", { title: "Too late" });
    expect(locked.status).toBe(409);
    expectEnvelope(await json(locked), "conflict", "plan_locked");
    expect(await planSnapshot(plan.id)).toEqual(lockedBefore);
    expect(server.unserved).toEqual([]);
  });

  it("T-001-92/AC-4 T-001-10/AC-7 missing X-HP-Request: 1 on POST and PATCH is 403 csrf and writes nothing; a 404 body is the envelope only", async () => {
    const organizer = await signUp("Omar");
    const plan = await createPlan();
    const countPlans = async () =>
      (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM plans WHERE organizer_account_id = ${organizer.id}`)[0]?.n;
    const plansBefore = await countPlans();

    const post = await call("/api/v1/plans", "POST", validPlan, false);
    expect(post.status).toBe(403);
    expectEnvelope(await json(post), "forbidden", "csrf");
    expect(await countPlans()).toBe(plansBefore);

    const before = await planSnapshot(plan.id);
    const patch = await call(`/api/v1/plans/${plan.id}`, "PATCH", { title: "No header", threshold: 5 }, false);
    expect(patch.status).toBe(403);
    expectEnvelope(await json(patch), "forbidden", "csrf");
    expect(await planSnapshot(plan.id)).toEqual(before);

    // A header with another value is missing too.
    const wrong = await server.serve(`/api/v1/plans/${plan.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-hp-request": "0" },
      body: JSON.stringify({ title: "Wrong header" }),
    });
    expect(wrong.status).toBe(403);
    expectEnvelope(await json(wrong), "forbidden", "csrf");
    expect(await planSnapshot(plan.id)).toEqual(before);

    // 404s are the envelope only: an unknown plan, and a hidden one read or patched by a stranger.
    const unknownId = generateId("pln_");
    const unknown = await call(`/api/v1/plans/${unknownId}`, "GET");
    expect(unknown.status).toBe(404);
    const unknownBody = await json(unknown);
    expectEnvelope(unknownBody, "not_found");
    expect(JSON.stringify(unknownBody)).not.toContain(unknownId);

    await signUp("Ziad");
    for (const method of ["GET", "PATCH"]) {
      const hidden = await call(`/api/v1/plans/${plan.id}`, method, method === "PATCH" ? { title: "Stolen" } : undefined);
      expect(hidden.status, method).toBe(404);
      const body = await json(hidden);
      expectEnvelope(body, "not_found");
      for (const leak of [plan.id, "Thursday", "Dinner", "Koshary", "Omar"]) {
        expect(JSON.stringify(body), `${method} ${leak}`).not.toContain(leak);
      }
    }
    expect(await planSnapshot(plan.id)).toEqual(before);
    expect(server.unserved).toEqual([]);
  });

  it("T-001-92/AC-4 T-001-10/AC-8 the plans handler tests use Postgres from DATABASE_URL", async () => {
    const files = [
      "src/app/api/v1/currencies/route.test.ts",
      "src/app/api/v1/plans/route.test.ts",
      "src/app/api/v1/plans/[planId]/route.test.ts",
    ];

    // A scratch database that only DATABASE_URL names: the handler tests pass against it and
    // leave their writes in its statistics.
    const name = `hangout_t92_${randomBytes(6).toString("hex")}`;
    scratchDatabases.push(name);
    await sql.unsafe(`CREATE DATABASE "${name}"`);
    expectAllPassed(runChild(files, { databaseUrl: urlFor(name), guard: false }), files);
    const scratch = postgres(urlFor(name), { max: 1, onnotice: () => {} });
    try {
      const inserted = await scratch<{ relname: string; n_tup_ins: number }[]>`
        SELECT relname, n_tup_ins::int AS n_tup_ins FROM pg_stat_user_tables
        WHERE relname IN ('accounts', 'plans') ORDER BY relname
      `;
      expect(inserted.map((row) => row.relname)).toEqual(["accounts", "plans"]);
      for (const row of inserted) {
        expect(row.n_tup_ins, row.relname).toBeGreaterThan(0);
      }
    } finally {
      await scratch.end();
    }

    // Without DATABASE_URL, or with one naming a database that does not exist, none passes.
    expectNonePassed(runChild(files, { databaseUrl: null, guard: false }));
    await sql.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    expectNonePassed(runChild(files, { databaseUrl: urlFor(name), guard: false }));
  }, 600_000);
});
