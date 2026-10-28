/**
 * T-001-91 — AC coverage for shipped tickets T-001-01, -02, -03, -04, -05, -06 and -13.
 * Each test carries this ticket's tag, then the shipped AC's tag, and asserts every clause of that
 * AC through the route handlers and Postgres (harness copied from shipped-foundations-auth.e2e.ts).
 *
 * T-001-06's AC text names `/v1/...`; the routes are `/api/v1/...` (ADR-0003). The tests below call
 * the `/api/v1` handlers with `/api/v1` URLs, which proves those clauses.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import ts from "typescript";
import { now, resetClock, setClock } from "@/server/clock";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { closeDatabase as closeJoin } from "@/server/join/db";
import { POST as createAccount } from "@/app/api/v1/accounts/route";
import { DELETE as signOut, POST as signIn } from "@/app/api/v1/sessions/route";
import { GET as getMe } from "@/app/api/v1/me/route";
import { GET as listInvitations } from "@/app/api/v1/invitations/route";
import { GET as listPlans, POST as createPlan } from "@/app/api/v1/plans/route";
import { GET as getPlan } from "@/app/api/v1/plans/[planId]/route";
import { GET as joinGet, POST as joinPost } from "@/app/api/v1/join/[token]/route";
import { cleanupThenClose } from "./db-cleanup";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const root = process.cwd();

const sql = postgres(databaseUrl, {
  max: 1,
  idle_timeout: 0,
  connect_timeout: 10,
  onnotice: () => {},
});

const createdEmails: string[] = [];
const originalCookieSecure = process.env.HP_COOKIE_SECURE;

type Account = { id: string; email: string; display_name: string };
type Envelope = {
  error: { code: string; reason?: string; message: string; fields: { path: string; code: string }[] };
};

function uniqueEmail(label = "user"): string {
  return `${label}.${randomBytes(8).toString("hex")}@example.com`;
}

function track(email: string): string {
  createdEmails.push(email);
  return email;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

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

async function forget(email: string): Promise<void> {
  const accounts = await sql<{ id: string }[]>`SELECT id FROM accounts WHERE email = ${email}`;
  for (const account of accounts) {
    const plans = await sql<{ id: string }[]>`
      SELECT id FROM plans WHERE organizer_account_id = ${account.id}
    `;
    for (const plan of plans) {
      await wipePlan(plan.id);
    }
    await sql`DELETE FROM invitations WHERE account_id = ${account.id}`;
    await sql`DELETE FROM participants WHERE account_id = ${account.id}`;
    await sql`DELETE FROM sessions WHERE account_id = ${account.id}`;
    await sql`DELETE FROM accounts WHERE id = ${account.id}`;
  }
}

function setCookieLines(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function setCookieLine(response: Response, name: string): string {
  return setCookieLines(response).find((entry) => entry.startsWith(`${name}=`)) ?? "";
}

function cookieValue(response: Response, name: string): string {
  const pair = setCookieLine(response, name).split(";", 1)[0] ?? "";
  return decodeURIComponent(pair.slice(`${name}=`.length));
}

function cookieAttributes(line: string): string[] {
  return line
    .split(";")
    .slice(1)
    .map((part) => part.trim().toLowerCase());
}

function jsonRequest(
  path: string,
  method: string,
  body: unknown,
  init?: { cookie?: string; csrf?: string | null; locale?: string },
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const csrf = init?.csrf === undefined ? "1" : init.csrf;
  if (csrf !== null) {
    headers["x-hp-request"] = csrf;
  }
  const cookies = [init?.cookie, init?.locale ? `hp_locale=${init.locale}` : undefined].filter(Boolean);
  if (cookies.length > 0) {
    headers.cookie = cookies.join("; ");
  }
  if (init?.locale) {
    headers["accept-language"] = init.locale;
  }
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(body),
  });
}

function getRequest(path: string, cookie?: string) {
  return new Request(`http://localhost${path}`, cookie ? { headers: { cookie } } : undefined);
}

function deleteSessions(init: { cookie?: string; csrf?: string | null } = {}) {
  return signOut(jsonRequest("/api/v1/sessions", "DELETE", undefined, init));
}

function accountBody(email: string, overrides: Record<string, unknown> = {}) {
  return { email, password: "password1", display_name: "Omar", ...overrides };
}

async function register(email: string, overrides: Record<string, unknown> = {}) {
  const response = await createAccount(
    jsonRequest("/api/v1/accounts", "POST", accountBody(email, overrides)),
  );
  expect(response.status).toBe(201);
  const body = (await response.json()) as { account: Account };
  const token = cookieValue(response, "hp_session");
  return { account: body.account, token, cookie: `hp_session=${token}` };
}

function validPlan() {
  return {
    title: "Thursday in Maadi",
    timezone: "Africa/Cairo",
    windows: [{ local_date: "2026-10-02", start_local: "18:00", end_local: "19:00" }],
    budget: { amount_minor: 50_000, currency: "EGP" },
    steps: [{ name: "Dinner", options: ["Koshary", "Grills"] }],
    threshold: 1,
  };
}

async function openPlan(cookie: string) {
  const response = await createPlan(jsonRequest("/api/v1/plans", "POST", validPlan(), { cookie }));
  expect(response.status).toBe(201);
  return { response, body: (await response.clone().json()) as { id: string; join_path: string } };
}

async function joinAnonymously(joinPath: string) {
  const token = joinPath.slice("/join/".length);
  const response = await joinPost(
    jsonRequest(`/api/v1/join/${token}`, "POST", { kind: "anonymous", display_name: "Hana" }),
    { params: Promise.resolve({ token }) },
  );
  expect(response.status).toBe(201);
  return { response, token: cookieValue(response, "hp_guest") };
}

async function count(table: "accounts" | "sessions", email: string): Promise<number> {
  const rows =
    table === "accounts"
      ? await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM accounts WHERE email = ${email}`
      : await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM sessions s JOIN accounts a ON a.id = s.account_id
          WHERE a.email = ${email}
        `;
  return rows[0]?.n ?? 0;
}

function expectEnvelope(body: unknown, code: string, reason?: string): Envelope {
  expect(Object.keys(body as object)).toEqual(["error"]);
  const envelope = body as Envelope;
  const keys = Object.keys(envelope.error).sort();
  expect(keys).toEqual(reason === undefined ? ["code", "fields", "message"] : ["code", "fields", "message", "reason"]);
  expect(envelope.error.code).toBe(code);
  expect(envelope.error.reason).toBe(reason);
  expect(typeof envelope.error.message).toBe("string");
  expect(Array.isArray(envelope.error.fields)).toBe(true);
  return envelope;
}

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

function guardedEnv(keepDatabaseUrl = false): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (!keepDatabaseUrl) delete env.DATABASE_URL;
  delete env.HP_HASH_TEST;
  env.NODE_OPTIONS = `--import=data:text/javascript,${encodeURIComponent(GUARD)}`;
  return env;
}

type JsonReport = {
  success: boolean;
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  testResults: { name: string; status: string }[];
};

function runIsolated(files: string[], keepDatabaseUrl = false): JsonReport | null {
  const dir = mkdtempSync(join(tmpdir(), "t00191-"));
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
      { cwd: root, env: guardedEnv(keepDatabaseUrl), encoding: "utf8", timeout: 110_000 },
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

function expectPure(files: string[]): void {
  const report = runIsolated(files);
  if (report === null) throw new Error(`vitest wrote no report for ${files.join(", ")}`);
  expect(report.testResults.map((file) => file.name.slice(root.length + 1)).sort()).toEqual([...files].sort());
  expect(report.numFailedTests).toBe(0);
  expect(report.numTotalTests).toBeGreaterThan(0);
  expect(report.numPassedTests).toBe(report.numTotalTests);
  expect(report.success).toBe(true);
}

let guardChecked = false;

/**
 * The guard itself works: a handler test that needs Postgres fails under it, both without
 * DATABASE_URL and with it (the socket to Postgres is refused), and any outgoing request fails.
 */
function expectGuardBites(): void {
  if (guardChecked) return;
  for (const keepDatabaseUrl of [false, true]) {
    const dbTest = runIsolated(["src/app/api/v1/me/route.test.ts"], keepDatabaseUrl);
    if (dbTest !== null) {
      expect(dbTest.success, `DATABASE_URL kept: ${keepDatabaseUrl}`).toBe(false);
      expect(dbTest.numPassedTests).toBe(0);
    }
  }

  for (const target of ["https://places.googleapis.com/v1/places:searchText", "https://routes.googleapis.com/"]) {
    const probe = spawnSync(
      process.execPath,
      ["-e", `fetch(${JSON.stringify(target)}).then(() => process.exit(0), (e) => { console.error(String(e)); process.exit(3); })`],
      { cwd: root, env: guardedEnv(), encoding: "utf8", timeout: 30_000 },
    );
    expect(probe.status).toBe(3);
    expect(probe.stderr).toContain("blocked outgoing fetch");
    const socket = spawnSync(
      process.execPath,
      ["-e", `require("node:https").get(${JSON.stringify(target)}).on("error", () => process.exit(4)); setTimeout(() => process.exit(0), 5000);`],
      { cwd: root, env: guardedEnv(), encoding: "utf8", timeout: 30_000 },
    );
    expect(socket.status).not.toBe(0);
    expect(socket.stderr).toContain("blocked outgoing socket");
  }
  guardChecked = true;
}

function chromeStrings(): Set<string> {
  const strings = new Set<string>();
  const walk = (value: unknown) => {
    if (typeof value === "string") strings.add(value.trim());
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  for (const file of ["messages/en.json", "messages/ar.json"]) {
    walk(JSON.parse(readFileSync(resolve(root, file), "utf8")));
  }
  return strings;
}

beforeEach(() => {
  process.env.HP_HASH_TEST = "1";
  delete process.env.HP_COOKIE_SECURE;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    throw new Error(`e2e must not call the network: ${String(input)}`);
  });
});

afterEach(async () => {
  resetClock();
  delete process.env.HP_HASH_TEST;
  if (originalCookieSecure === undefined) {
    delete process.env.HP_COOKIE_SECURE;
  } else {
    process.env.HP_COOKIE_SECURE = originalCookieSecure;
  }
  vi.unstubAllGlobals();
  for (const email of createdEmails.splice(0, createdEmails.length)) {
    await forget(email);
  }
});

afterAll(async () => {
  await cleanupThenClose(
    async () => {},
    () => sql.end({ timeout: 5 }),
    closeJoin,
    closePlans,
    closeAccounts,
  );
});

describe("e2e shipped coverage: bootstrap, schema, money, errors, auth, Google clients", () => {
  it("T-001-91/AC-1 T-001-01/AC-4 tsconfig is TypeScript strict and @/ maps to src/, read through TypeScript's parsed options", () => {
    const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
    expect(configPath).toBe(resolve(root, "tsconfig.json"));
    const read = ts.readConfigFile(configPath!, ts.sys.readFile);
    expect(read.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root);
    const options = parsed.options;

    expect(options.strict).toBe(true);
    for (const flag of [
      "noImplicitAny",
      "strictNullChecks",
      "strictFunctionTypes",
      "strictBindCallApply",
      "strictPropertyInitialization",
      "noImplicitThis",
      "alwaysStrict",
      "useUnknownInCatchVariables",
    ] as const) {
      expect(options[flag], flag).not.toBe(false);
    }

    expect(options.paths).toEqual({ "@/*": ["./src/*"] });
    const from = resolve(root, "src/app/api/v1/me/route.ts");
    for (const [specifier, file] of [
      ["@/server/clock", "src/server/clock.ts"],
      ["@/server/db/client", "src/server/db/client.ts"],
      ["@/components/route-load-error", "src/components/route-load-error.tsx"],
    ] as const) {
      const resolved = ts.resolveModuleName(specifier, from, options, ts.sys).resolvedModule;
      expect(resolved?.resolvedFileName, specifier).toBe(resolve(root, file));
    }
  });

  it("T-001-91/AC-3 T-001-03/AC-6 the money and id tests are pure: they pass with no database and no network", () => {
    expectGuardBites();
    expectPure(["src/server/money.test.ts", "src/server/ids.test.ts"]);
  });

  it("T-001-91/AC-4 T-001-04/AC-2 route errors omit reason when the code is enough, and message is log text rather than product chrome", async () => {
    const owner = await register(track(uniqueEmail("envelope")));
    const stranger = await register(track(uniqueEmail("envelope-other")));
    const plan = await openPlan(owner.cookie);
    const chrome = chromeStrings();
    expect(chrome.size).toBeGreaterThan(0);

    async function collect(locale?: string) {
      const missingPlan = `pln_${"a".repeat(22)}`;
      const calls: [string, Promise<Response>, number, string, string | undefined][] = [
        [
          "400 validation",
          createAccount(jsonRequest("/api/v1/accounts", "POST", accountBody("not-an-email"), { locale })),
          400,
          "validation_failed",
          undefined,
        ],
        [
          "404 unknown plan",
          getPlan(jsonRequest(`/api/v1/plans/${missingPlan}`, "GET", undefined, { cookie: owner.cookie, locale }), {
            params: Promise.resolve({ planId: missingPlan }),
          }),
          404,
          "not_found",
          undefined,
        ],
        [
          "404 hidden plan",
          getPlan(jsonRequest(`/api/v1/plans/${plan.body.id}`, "GET", undefined, { cookie: stranger.cookie, locale }), {
            params: Promise.resolve({ planId: plan.body.id }),
          }),
          404,
          "not_found",
          undefined,
        ],
        [
          "401 missing session",
          getMe(jsonRequest("/api/v1/me", "GET", undefined, { locale })),
          401,
          "unauthenticated",
          "missing_session",
        ],
        [
          "401 bad credentials",
          signIn(
            jsonRequest("/api/v1/sessions", "POST", { email: owner.account.email, password: "wrong-pass" }, { locale }),
          ),
          401,
          "unauthenticated",
          "bad_credentials",
        ],
        [
          "403 csrf",
          createAccount(jsonRequest("/api/v1/accounts", "POST", accountBody(uniqueEmail()), { csrf: null, locale })),
          403,
          "forbidden",
          "csrf",
        ],
        [
          "409 email taken",
          createAccount(jsonRequest("/api/v1/accounts", "POST", accountBody(owner.account.email), { locale })),
          409,
          "conflict",
          "email_taken",
        ],
      ];
      const messages: Record<string, string> = {};
      for (const [name, pending, status, code, reason] of calls) {
        const response = await pending;
        expect(response.status, name).toBe(status);
        const envelope = expectEnvelope(await response.json(), code, reason);
        if (reason === undefined) {
          expect("reason" in envelope.error, name).toBe(false);
        }
        const message = envelope.error.message;
        expect(message.length, name).toBeGreaterThan(0);
        // Log text: plain ASCII, never one of the en/ar chrome strings the UI renders.
        expect(message, name).toMatch(/^[\x20-\x7e]+$/);
        expect(chrome.has(message.trim()), `${name}: "${message}" is a chrome string`).toBe(false);
        messages[name] = message;
      }
      return messages;
    }

    const english = await collect();
    const arabic = await collect("ar");
    // The message does not follow the locale: it is not product chrome.
    expect(arabic).toEqual(english);
  });

  it("T-001-91/AC-4 T-001-04/AC-4 src/server/clock.ts is the clock, and tests can replace it", async () => {
    const before = Date.now();
    const wall = now();
    expect(wall).toBeInstanceOf(Date);
    expect(Math.abs(wall.getTime() - before)).toBeLessThan(1000);

    // Replaced: the route handlers read the replaced clock for what they write and check.
    setClock(new Date("2031-05-01T10:00:00.000Z"));
    expect(now().toISOString()).toBe("2031-05-01T10:00:00.000Z");
    const email = track(uniqueEmail("clock"));
    const { token, cookie } = await register(email);
    const rows = await sql<{ expires_at: Date }[]>`
      SELECT expires_at FROM sessions WHERE token_hash = ${sha256(token)}
    `;
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0]!.expires_at).toISOString()).toBe("2031-05-31T10:00:00.000Z");

    setClock(new Date("2031-05-31T09:59:00.000Z"));
    expect((await getMe(getRequest("/api/v1/me", cookie))).status).toBe(200);
    setClock(new Date("2031-07-15T00:00:00.000Z"));
    expect((await getMe(getRequest("/api/v1/me", cookie))).status).toBe(401);

    // Restored: back to wall time.
    resetClock();
    expect(Math.abs(now().getTime() - Date.now())).toBeLessThan(1000);
  });

  it("T-001-91/AC-4 T-001-04/AC-5 the error and clock tests are pure: they pass with no database and no network", () => {
    expectGuardBites();
    expectPure(["src/server/http/errors.test.ts", "src/server/clock.test.ts"]);
  });

  it("T-001-91/AC-5 T-001-05/AC-4 the database stores the SHA-256 of each cookie token and does not hash the plan join token", async () => {
    const email = track(uniqueEmail("hash"));
    const owner = await register(email);
    const signedIn = await signIn(
      jsonRequest("/api/v1/sessions", "POST", { email, password: "password1" }),
    );
    expect(signedIn.status).toBe(200);
    const sessionTokens = [owner.token, cookieValue(signedIn, "hp_session")];
    const plan = await openPlan(owner.cookie);
    const guest = await joinAnonymously(plan.body.join_path);
    const joinToken = plan.body.join_path.slice("/join/".length);
    const link = await joinGet(getRequest(`/api/v1/join/${joinToken}`), {
      params: Promise.resolve({ token: joinToken }),
    });
    expect(link.status).toBe(200);
    const linkToken = cookieValue(link, "hp_link");

    const stored = await sql<{ token_hash: string }[]>`
      SELECT s.token_hash FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE a.email = ${email}
    `;
    expect(stored.map((row) => row.token_hash).sort()).toEqual(sessionTokens.map(sha256).sort());

    for (const [table, token] of [
      ["sessions", owner.token],
      ["guest_sessions", guest.token],
      ["link_sessions", linkToken],
    ] as const) {
      expect(token.length, table).toBeGreaterThan(0);
      const hashed = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM ${sql(table)} WHERE token_hash = ${sha256(token)}
      `;
      expect(hashed[0]!.n, `${table} stores the SHA-256`).toBe(1);
      expect(sha256(token)).toMatch(/^[0-9a-f]{64}$/);
      const raw = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM ${sql(table)} WHERE token_hash = ${token}
      `;
      expect(raw[0]!.n, `${table} stores the raw token`).toBe(0);
    }

    const planRow = await sql<{ join_token: string }[]>`SELECT join_token FROM plans WHERE id = ${plan.body.id}`;
    expect(planRow[0]!.join_token).toBe(joinToken);
    expect(planRow[0]!.join_token).toMatch(/^jt_[A-Za-z0-9_-]{43}$/);
    expect(planRow[0]!.join_token).not.toBe(sha256(joinToken));
  });

  it("T-001-91/AC-6 T-001-06/AC-2 email is trimmed and lowercased; password is 8–72 characters and not trimmed; display name is 1–40 characters after trim", async () => {
    // Email: trimmed and lowercased on create and on sign-in.
    const email = track(uniqueEmail("trim"));
    const created = await createAccount(
      jsonRequest("/api/v1/accounts", "POST", accountBody(`   ${email.toUpperCase()}\t `)),
    );
    expect(created.status).toBe(201);
    expect(((await created.json()) as { account: Account }).account.email).toBe(email);
    const stored = await sql<{ email: string }[]>`SELECT email FROM accounts WHERE email = ${email}`;
    expect(stored).toEqual([{ email }]);
    const mixedCase = await signIn(
      jsonRequest("/api/v1/sessions", "POST", { email: `  ${email.toUpperCase()} `, password: "password1" }),
    );
    expect(mixedCase.status).toBe(200);

    // Password: 8 through 72 characters, counted and stored without trimming.
    async function create(password: string, displayName = "Omar") {
      const target = track(uniqueEmail("pw"));
      const response = await createAccount(
        jsonRequest("/api/v1/accounts", "POST", { email: target, password, display_name: displayName }),
      );
      return { target, response };
    }
    for (const [password, fieldCode] of [
      ["a".repeat(7), "below_min"],
      ["a".repeat(73), "above_max"],
      ["  abcd  ".slice(0, 7), "below_min"],
    ] as const) {
      const { target, response } = await create(password);
      expect(response.status, `${password.length} chars`).toBe(400);
      expect(((await response.json()) as Envelope).error.fields).toEqual([{ path: "password", code: fieldCode }]);
      expect(await count("accounts", target)).toBe(0);
    }
    for (const password of ["a".repeat(8), "a".repeat(72)]) {
      const { response } = await create(password);
      expect(response.status, `${password.length} chars`).toBe(201);
    }
    // Eight characters only with its spaces: accepted, so the spaces were counted.
    const spaced = "  abcd  ";
    const kept = await create(spaced);
    expect(kept.response.status).toBe(201);
    const withSpaces = await signIn(
      jsonRequest("/api/v1/sessions", "POST", { email: kept.target, password: spaced }),
    );
    expect(withSpaces.status).toBe(200);
    const trimmed = await signIn(
      jsonRequest("/api/v1/sessions", "POST", { email: kept.target, password: spaced.trim() + "1234" }),
    );
    expect(trimmed.status).toBe(401);
    const trimmedOnly = await signIn(
      jsonRequest("/api/v1/sessions", "POST", { email: kept.target, password: "abcd" }),
    );
    expect(trimmedOnly.status).toBe(400);

    // Display name: 1 through 40 characters after trim.
    for (const [name, expected] of [
      [" n ", "n"],
      [`  ${"n".repeat(40)}  `, "n".repeat(40)],
    ] as const) {
      const { response } = await create("password1", name);
      expect(response.status).toBe(201);
      expect(((await response.json()) as { account: Account }).account.display_name).toBe(expected);
    }
    for (const [name, fieldCode] of [
      ["", "required"],
      ["    ", "required"],
      ["n".repeat(41), "too_long"],
      [` ${"n".repeat(41)} `, "too_long"],
    ] as const) {
      const { target, response } = await create("password1", name);
      expect(response.status).toBe(400);
      expect(((await response.json()) as Envelope).error.fields).toEqual([{ path: "display_name", code: fieldCode }]);
      expect(await count("accounts", target)).toBe(0);
    }
  });

  it("T-001-91/AC-6 T-001-06/AC-3 POST /api/v1/sessions returns 200 with the same account object and sets hp_session; unknown email and wrong password are both 401 bad_credentials with the same envelope message and set no cookie", async () => {
    const email = track(uniqueEmail("signin"));
    const created = await register(email);
    const sessionsBefore = await count("sessions", email);

    const response = await signIn(jsonRequest("/api/v1/sessions", "POST", { email, password: "password1" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ account: created.account });
    const line = setCookieLine(response, "hp_session");
    expect(line).not.toBe("");
    const token = cookieValue(response, "hp_session");
    expect(token.length).toBeGreaterThan(0);
    expect(cookieAttributes(line)).toEqual(expect.arrayContaining(["httponly", "samesite=lax", "path=/"]));
    expect(await count("sessions", email)).toBe(sessionsBefore + 1);
    const me = await getMe(getRequest("/api/v1/me", `hp_session=${token}`));
    expect(await me.json()).toEqual({ account: created.account });

    const sessionsAfterSignIn = await count("sessions", email);
    const unknown = await signIn(
      jsonRequest("/api/v1/sessions", "POST", { email: uniqueEmail("nobody"), password: "password1" }),
    );
    const wrong = await signIn(jsonRequest("/api/v1/sessions", "POST", { email, password: "password2" }));
    const bodies: Envelope[] = [];
    for (const failed of [unknown, wrong]) {
      expect(failed.status).toBe(401);
      expect(setCookieLines(failed)).toEqual([]);
      bodies.push(expectEnvelope(await failed.json(), "unauthenticated", "bad_credentials"));
    }
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0]!.error.message).toBe(bodies[1]!.error.message);
    expect(await count("sessions", email)).toBe(sessionsAfterSignIn);
  });

  it("T-001-91/AC-6 T-001-06/AC-4 DELETE /api/v1/sessions returns 204, clears hp_session, and is idempotent when already signed out", async () => {
    const email = track(uniqueEmail("signout"));
    const { cookie, token } = await register(email);
    expect(await count("sessions", email)).toBe(1);

    const first = await deleteSessions({ cookie });
    expect(first.status).toBe(204);
    expect(await first.text()).toBe("");
    const cleared = setCookieLine(first, "hp_session");
    expect(cleared).not.toBe("");
    expect(cookieValue(first, "hp_session")).toBe("");
    expect(cookieAttributes(cleared)).toEqual(expect.arrayContaining(["max-age=0", "path=/"]));
    expect(await count("sessions", email)).toBe(0);
    const sessionRow = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM sessions WHERE token_hash = ${sha256(token)}
    `;
    expect(sessionRow[0]!.n).toBe(0);
    expect((await getMe(getRequest("/api/v1/me", cookie))).status).toBe(401);

    for (const again of [await deleteSessions({ cookie }), await deleteSessions()]) {
      expect(again.status).toBe(204);
      expect(await again.text()).toBe("");
      expect(cookieValue(again, "hp_session")).toBe("");
    }
    expect(await count("accounts", email)).toBe(1);
  });

  it("T-001-91/AC-6 T-001-06/AC-5 GET /api/v1/me returns 200 with the account for a session, and 401 missing_session otherwise, including a guest-only browser", async () => {
    const email = track(uniqueEmail("me"));
    const owner = await register(email);
    const signedIn = await getMe(getRequest("/api/v1/me", owner.cookie));
    expect(signedIn.status).toBe(200);
    expect(await signedIn.json()).toEqual({ account: owner.account });

    const plan = await openPlan(owner.cookie);
    const guest = await joinAnonymously(plan.body.join_path);
    const guestCookie = `hp_guest=${guest.token}`;
    const guestRows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM guest_sessions WHERE token_hash = ${sha256(guest.token)}
    `;
    expect(guestRows[0]!.n).toBe(1);

    for (const [name, cookie] of [
      ["no cookie", undefined],
      ["guest-only browser", guestCookie],
      ["unknown session", "hp_session=not-a-session"],
      ["signed-out session", `hp_session=${randomBytes(32).toString("base64url")}; ${guestCookie}`],
    ] as const) {
      const response = await getMe(getRequest("/api/v1/me", cookie));
      expect(response.status, name).toBe(401);
      const body = await response.json();
      expectEnvelope(body, "unauthenticated", "missing_session");
      expect(JSON.stringify(body)).not.toContain(email);
    }
  });

  it("T-001-91/AC-6 T-001-06/AC-6 POST and DELETE without X-HP-Request: 1 return 403 csrf and write nothing", async () => {
    const email = track(uniqueEmail("csrf"));
    const owner = await register(email);
    const fresh = track(uniqueEmail("csrf-new"));

    for (const csrf of [null, "0", "true"]) {
      const created = await createAccount(
        jsonRequest("/api/v1/accounts", "POST", accountBody(fresh), { csrf }),
      );
      const signedIn = await signIn(
        jsonRequest("/api/v1/sessions", "POST", { email, password: "password1" }, { csrf }),
      );
      const signedOut = await deleteSessions({ cookie: owner.cookie, csrf });
      for (const [name, response] of [
        ["POST /api/v1/accounts", created],
        ["POST /api/v1/sessions", signedIn],
        ["DELETE /api/v1/sessions", signedOut],
      ] as const) {
        expect(response.status, `${name} ${csrf}`).toBe(403);
        expectEnvelope(await response.json(), "forbidden", "csrf");
        expect(setCookieLines(response), name).toEqual([]);
      }
    }
    expect(await count("accounts", fresh)).toBe(0);
    expect(await count("sessions", email)).toBe(1);
    const stillSignedIn = await getMe(getRequest("/api/v1/me", owner.cookie));
    expect(stillSignedIn.status).toBe(200);
  });

  it("T-001-91/AC-6 T-001-06/AC-7 the account payloads are the only ones that include the caller email, and a 404 body is the envelope only", async () => {
    const email = track(uniqueEmail("payload"));
    const created = await createAccount(jsonRequest("/api/v1/accounts", "POST", accountBody(email)));
    const cookie = `hp_session=${cookieValue(created, "hp_session")}`;
    const signedIn = await signIn(jsonRequest("/api/v1/sessions", "POST", { email, password: "password1" }));
    const me = await getMe(getRequest("/api/v1/me", cookie));
    for (const [name, response] of [
      ["POST /api/v1/accounts", created],
      ["POST /api/v1/sessions", signedIn],
      ["GET /api/v1/me", me],
    ] as const) {
      const body = (await response.json()) as { account: Account };
      expect(Object.keys(body), name).toEqual(["account"]);
      expect(Object.keys(body.account).sort(), name).toEqual(["display_name", "email", "id"]);
      expect(body.account.email, name).toBe(email);
    }

    const other = await register(track(uniqueEmail("payload-other")));
    const plan = await openPlan(cookie);
    const planId = plan.body.id;
    const missing = `pln_${"b".repeat(22)}`;
    const params = (id: string) => ({ params: Promise.resolve({ planId: id }) });
    const responses: [string, Response][] = [
      ["POST /api/v1/plans", plan.response],
      ["GET /api/v1/plans", await listPlans(getRequest("/api/v1/plans", cookie))],
      ["GET /api/v1/plans/{id}", await getPlan(getRequest(`/api/v1/plans/${planId}`, cookie), params(planId))],
      ["GET /api/v1/invitations", await listInvitations(getRequest("/api/v1/invitations", cookie))],
      [
        "409 email_taken",
        await createAccount(jsonRequest("/api/v1/accounts", "POST", accountBody(email.toUpperCase()))),
      ],
      [
        "401 bad_credentials",
        await signIn(jsonRequest("/api/v1/sessions", "POST", { email, password: "wrong-password" })),
      ],
      ["403 csrf", await signIn(jsonRequest("/api/v1/sessions", "POST", { email, password: "password1" }, { csrf: null }))],
      ["400 invalid", await createAccount(jsonRequest("/api/v1/accounts", "POST", accountBody(email, { password: "x" })))],
      ["404 unknown plan", await getPlan(getRequest(`/api/v1/plans/${missing}`, cookie), params(missing))],
      ["404 hidden plan", await getPlan(getRequest(`/api/v1/plans/${planId}`, other.cookie), params(planId))],
    ];
    const notFound: unknown[] = [];
    for (const [name, response] of responses) {
      expect(response.status, name).toBeLessThan(500);
      const text = await response.text();
      expect(text.toLowerCase(), `${name} includes the caller email`).not.toContain(email.toLowerCase());
      if (response.status === 404) {
        const body = JSON.parse(text) as Envelope;
        expectEnvelope(body, "not_found");
        expect(body.error.fields).toEqual([]);
        expect(text).not.toContain(planId);
        expect(text).not.toContain("Thursday in Maadi");
        notFound.push(body);
      }
    }
    expect(notFound).toHaveLength(2);
    expect(notFound[0]).toEqual(notFound[1]);

    const signedOut = await deleteSessions({ cookie });
    expect(signedOut.status).toBe(204);
    expect(await signedOut.text()).toBe("");
  });

  it("T-001-91/AC-6 T-001-06/AC-8 the handlers read and write the Postgres in DATABASE_URL", async () => {
    const email = track(uniqueEmail("pg"));
    const { account, cookie } = await register(email);

    const check = postgres(databaseUrl, { max: 1, onnotice: () => {} });
    try {
      const rows = await check<{ id: string; db: string; version: string }[]>`
        SELECT id, current_database() AS db, version() AS version FROM accounts WHERE email = ${email}
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(account.id);
      expect(rows[0]!.db).toBe(decodeURIComponent(new URL(databaseUrl).pathname.slice(1)));
      expect(rows[0]!.version).toMatch(/^PostgreSQL /);

      // A change made directly in that database is what the handler reads back.
      await check`UPDATE accounts SET display_name = 'Renamed' WHERE id = ${account.id}`;
      const me = await getMe(getRequest("/api/v1/me", cookie));
      expect(((await me.json()) as { account: Account }).account.display_name).toBe("Renamed");

      const signedIn = await signIn(jsonRequest("/api/v1/sessions", "POST", { email, password: "password1" }));
      expect(signedIn.status).toBe(200);
      const sessions = await check<{ n: number }[]>`
        SELECT count(*)::int AS n FROM sessions WHERE token_hash = ${sha256(cookieValue(signedIn, "hp_session"))}
      `;
      expect(sessions[0]!.n).toBe(1);
    } finally {
      await check.end({ timeout: 5 });
    }
  });

  it("T-001-91/AC-7 T-001-13/AC-4 the Google client tests use fakes only and do not call places.googleapis.com or routes.googleapis.com", () => {
    expectGuardBites();
    expectPure(["src/server/google/places.test.ts", "src/server/google/routes.test.ts"]);
  });
});
