/**
 * T-001-86 — real-stack proof for shipped tickets T-001-01, -02, -03, -04, -05, -06 and -13.
 * Each test carries this ticket's tag and one shipped ticket's tag, and asserts that AC through
 * the route handlers and Postgres.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { resetClock } from "@/server/clock";
import { generateId } from "@/server/ids";
import { closeDatabase as closeAttempt } from "@/server/proposal/attempt";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { closeDatabase as closeJoin } from "@/server/join/db";
import { PLACES_SEARCH_TEXT_URL, type FetchFn } from "@/server/google/places";
import { ROUTES_MATRIX_URL } from "@/server/google/routes";
import { setProposalAttemptGoogleOptions } from "@/server/proposal/trigger";
import { setGoogleClientOptions as setResponseGoogle } from "@/server/response/google";
import { setGoogleClientOptions as setPlaceSearchGoogle } from "@/server/response/place-search";
import { POST as createAccount } from "@/app/api/v1/accounts/route";
import { GET as getMe } from "@/app/api/v1/me/route";
import { POST as createPlan } from "@/app/api/v1/plans/route";
import { GET as joinGet, POST as joinPost } from "@/app/api/v1/join/[token]/route";
import { PUT as putResponse } from "@/app/api/v1/plans/[planId]/response/route";
import { GET as searchPlaces } from "@/app/api/v1/plans/[planId]/place-searches/route";
import { cleanupThenClose } from "./db-cleanup";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const sql = postgres(databaseUrl, {
  max: 1,
  idle_timeout: 0,
  connect_timeout: 10,
  onnotice: () => {},
});

const createdEmails: string[] = [];
const originalCookieSecure = process.env.HP_COOKIE_SECURE;
const originalProposalEnabled = process.env.HP_PROPOSAL_ENABLED;

const SESSION_MAX_AGE = 30 * 24 * 60 * 60;
const START_MASK = "places.id,places.displayName,places.location";
const DETAILS_MASK = "id,displayName,location";
const VENUE_MASK = "places.id,places.displayName,places.location,places.priceRange";

const startCafe = {
  id: "ChIJ-start",
  displayName: { text: "Maadi, Cairo" },
  location: { latitude: 29.96, longitude: 31.25 },
};

function uniqueEmail(label = "user"): string {
  return `${label}.${randomBytes(8).toString("hex")}@example.com`;
}

function track(email: string): string {
  createdEmails.push(email);
  return email;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function wipePlan(planId: string): Promise<void> {
  const guests = await sql<{ id: string }[]>`
    SELECT DISTINCT guest_session_id AS id FROM participants
    WHERE plan_id = ${planId} AND guest_session_id IS NOT NULL
  `;
  const links = await sql<{ id: string }[]>`
    SELECT DISTINCT link_session_id AS id FROM link_session_plans WHERE plan_id = ${planId}
  `;
  const byProposal = (table: string) =>
    sql.unsafe(
      `DELETE FROM ${table} WHERE proposal_id IN (SELECT id FROM proposals WHERE plan_id = $1)`,
      [planId],
    );
  const byParticipant = (table: string) =>
    sql.unsafe(
      `DELETE FROM ${table} WHERE participant_id IN (SELECT id FROM participants WHERE plan_id = $1)`,
      [planId],
    );
  for (const table of [
    "step_signals",
    "proposal_alternatives",
    "proposal_candidates",
    "proposal_legs",
    "proposal_steps",
    "proposal_cohort",
  ]) {
    await byProposal(table);
  }
  await sql`DELETE FROM proposals WHERE plan_id = ${planId}`;
  await sql`DELETE FROM proposal_runs WHERE plan_id = ${planId}`;
  for (const table of ["place_searches", "response_picks", "response_windows", "responses"]) {
    await byParticipant(table);
  }
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
    await sql`DELETE FROM guest_sessions WHERE id = ${guest.id}`;
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

function jsonRequest(
  path: string,
  method: string,
  body: unknown,
  init?: { cookie?: string },
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-hp-request": "1",
  };
  if (init?.cookie) {
    headers.cookie = init.cookie;
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

function validPlan(overrides: Record<string, unknown> = {}) {
  return {
    title: "Thursday in Maadi",
    timezone: "Africa/Cairo",
    windows: [{ local_date: "2026-10-02", start_local: "18:00", end_local: "19:00" }],
    budget: { amount_minor: 50_000, currency: "EGP" },
    steps: [{ name: "Dinner", options: ["Koshary", "Grills"] }],
    threshold: 1,
    ...overrides,
  };
}

function accountBody(email: string, overrides: Record<string, unknown> = {}) {
  return { email, password: "password1", display_name: "Omar", ...overrides };
}

async function register(email: string) {
  const response = await createAccount(jsonRequest("/api/v1/accounts", "POST", accountBody(email)));
  expect(response.status).toBe(201);
  const body = (await response.json()) as { account: { id: string } };
  return { accountId: body.account.id, cookie: `hp_session=${cookieValue(response, "hp_session")}` };
}

async function openPlan(cookie: string, overrides: Record<string, unknown> = {}) {
  const response = await createPlan(
    jsonRequest("/api/v1/plans", "POST", validPlan(overrides), { cookie }),
  );
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; join_path: string };
}

async function joinAnonymously(joinPath: string, displayName = "Hana") {
  const token = joinPath.slice("/join/".length);
  const response = await joinPost(
    jsonRequest(`/api/v1/join/${token}`, "POST", { kind: "anonymous", display_name: displayName }),
    { params: Promise.resolve({ token }) },
  );
  expect(response.status).toBe(201);
  return { response, cookie: `hp_guest=${cookieValue(response, "hp_guest")}` };
}

async function accountCount(email: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM accounts WHERE email = ${email}
  `;
  return rows[0]?.n ?? 0;
}

type Recorded = { url: string; method: string; headers: Record<string, string>; body: unknown };

function recordingFetch(
  recorded: Recorded[],
  answer: (url: string, body: Record<string, unknown>) => unknown,
): FetchFn {
  return async (request, init) => {
    const url = typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
    const body = init?.body === undefined ? {} : (JSON.parse(String(init.body)) as Record<string, unknown>);
    recorded.push({
      url,
      method: init?.method ?? "GET",
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      body,
    });
    return jsonResponse(answer(url, body));
  };
}

function latLng(value: unknown): { latitude: number; longitude: number } | null {
  const point = (
    value as { waypoint?: { location?: { latLng?: { latitude: number; longitude: number } } } }
  ).waypoint?.location?.latLng;
  return point ?? null;
}

function googleAnswer(url: string, body: Record<string, unknown>): unknown {
  if (url === PLACES_SEARCH_TEXT_URL) {
    return {
      places: [
        {
          id: "ChIJ-dinner-a",
          displayName: { text: "Abu Tarek" },
          location: { latitude: 30.01, longitude: 31.235 },
          priceRange: { startPrice: { currencyCode: "EGP", units: 120, nanos: 0 } },
        },
      ],
    };
  }
  if (url === ROUTES_MATRIX_URL) {
    const origins = ((body.origins as unknown[]) ?? []).map(latLng);
    const destinations = ((body.destinations as unknown[]) ?? []).map(latLng);
    return origins.flatMap((_, i) =>
      destinations.map((__, j) => ({
        originIndex: i,
        destinationIndex: j,
        status: { code: 0 },
        condition: "ROUTE_EXISTS",
        duration: "180s",
      })),
    );
  }
  if (url.startsWith("https://places.googleapis.com/v1/places/")) {
    return startCafe;
  }
  throw new Error(`unexpected Google URL: ${url}`);
}

function contractTables(): Map<string, string[]> {
  const text = readFileSync(resolve(process.cwd(), "arch/CONTRACTS.md"), "utf8");
  const section = text.slice(text.indexOf("\n## Tables"), text.indexOf("\n## External Google"));
  const tables = new Map<string, string[]>();
  for (const line of section.split("\n")) {
    const match = /^\| `([a-z_]+)` \| (.+) \|$/.exec(line);
    if (!match) continue;
    const cell = match[2]!.split(/\.(?:\s|$)/, 1)[0]!;
    const columns = cell
      .split(",")
      .map((part) => part.trim())
      .filter((part) => !part.startsWith("primary key"))
      .map((part) => part.split(/\s+/, 1)[0]!);
    tables.set(match[1]!, columns);
  }
  return tables;
}

async function insertionError(run: () => Promise<unknown>): Promise<{ constraint: string }> {
  try {
    await run();
  } catch (error) {
    const constraint = (error as { constraint_name?: string }).constraint_name;
    return { constraint: constraint ?? String(error) };
  }
  throw new Error("insert was accepted");
}

beforeEach(() => {
  process.env.HP_HASH_TEST = "1";
  delete process.env.HP_PROPOSAL_ENABLED;
  delete process.env.HP_COOKIE_SECURE;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    throw new Error(`e2e must not call the network: ${String(input)}`);
  });
});

afterEach(async () => {
  resetClock();
  delete process.env.HP_HASH_TEST;
  for (const [name, original] of [
    ["HP_COOKIE_SECURE", originalCookieSecure],
    ["HP_PROPOSAL_ENABLED", originalProposalEnabled],
  ] as const) {
    if (original === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = original;
    }
  }
  setResponseGoogle(undefined);
  setPlaceSearchGoogle(undefined);
  setProposalAttemptGoogleOptions(undefined);
  vi.unstubAllGlobals();
  for (const email of createdEmails.splice(0, createdEmails.length)) {
    await forget(email);
  }
});

afterAll(async () => {
  await cleanupThenClose(
    async () => {},
    () => sql.end({ timeout: 5 }),
    closeAttempt,
    closeJoin,
    closePlans,
    closeAccounts,
  );
});

describe("e2e shipped foundations and auth", () => {
  it("T-001-86/AC-1 T-001-01/AC-6 the Drizzle client reads DATABASE_URL: a write through a route lands in that database", async () => {
    const email = track(uniqueEmail("db"));
    const { accountId } = await register(email);

    const check = postgres(databaseUrl, { max: 1, onnotice: () => {} });
    try {
      const rows = await check<{ id: string; db: string }[]>`
        SELECT id, current_database() AS db FROM accounts WHERE email = ${email}
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(accountId);
      expect(rows[0]!.db).toBe(decodeURIComponent(new URL(databaseUrl).pathname.slice(1)));
    } finally {
      await check.end({ timeout: 5 });
    }
  });

  it("T-001-86/AC-2 T-001-02/AC-1 the migration creates every contracted table and column and enforces the participant and invitation constraints", async () => {
    const tables = contractTables();
    expect(tables.size).toBe(23);
    const present = await sql<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = current_schema()
    `;
    for (const [table, columns] of tables) {
      const found = present.filter((row) => row.table_name === table).map((row) => row.column_name);
      expect({ table, missing: columns.filter((column) => !found.includes(column)) }).toEqual({
        table,
        missing: [],
      });
    }

    const email = track(uniqueEmail("schema"));
    const other = track(uniqueEmail("schema-other"));
    const organizer = await register(email);
    const member = await register(other);
    const plan = await openPlan(organizer.cookie);
    const guestId = `gst_${randomBytes(16).toString("hex")}`;
    await sql`
      INSERT INTO guest_sessions (id, token_hash, expires_at)
      VALUES (${guestId}, ${randomBytes(16).toString("hex")}, now() + interval '1 day')
    `;
    const participant = (accountId: string | null, guest: string | null, distinguisher = "a3k9") =>
      sql`
        INSERT INTO participants (id, plan_id, account_id, guest_session_id, display_name, distinguisher)
        VALUES (${generateId("prt_")}, ${plan.id}, ${accountId}, ${guest}, 'Pat', ${distinguisher})
      `;

    expect(
      await insertionError(() => participant(member.accountId, guestId)),
    ).toEqual({ constraint: "participants_account_xor_guest" });
    expect(await insertionError(() => participant(null, null))).toEqual({
      constraint: "participants_account_xor_guest",
    });

    await participant(member.accountId, null);
    expect(await insertionError(() => participant(member.accountId, null, "b4m8"))).toEqual({
      constraint: "participants_plan_id_account_id_uidx",
    });

    const invite = (distinguisher: string) =>
      sql`
        INSERT INTO invitations (id, plan_id, account_id, distinguisher)
        VALUES (${generateId("inv_")}, ${plan.id}, ${member.accountId}, ${distinguisher})
      `;
    await invite("c5n7");
    expect(await insertionError(() => invite("d6p6"))).toEqual({
      constraint: "invitations_plan_id_account_id_unique",
    });
    await sql`DELETE FROM guest_sessions WHERE id = ${guestId}`;
  });

  it("T-001-86/AC-3 T-001-03/AC-1 money is integer minor units and amount_minor is rejected outside 1 through 100000000000", async () => {
    const email = track(uniqueEmail("money"));
    const { cookie } = await register(email);
    const create = (amount: number) =>
      createPlan(
        jsonRequest("/api/v1/plans", "POST", validPlan({ budget: { amount_minor: amount, currency: "EGP" } }), {
          cookie,
        }),
      );
    const plansBefore = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM plans`;

    for (const rejected of [0, 100_000_000_001]) {
      const response = await create(rejected);
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string; fields: { path: string }[] } };
      expect(body.error.code).toBe("validation_failed");
      expect(body.error.fields.map((field) => field.path)).toContain("budget.amount_minor");
    }
    const plansAfterRejects = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM plans`;
    expect(plansAfterRejects[0]!.n).toBe(plansBefore[0]!.n);

    for (const accepted of [1, 100_000_000_000]) {
      const response = await create(accepted);
      expect(response.status).toBe(201);
      const plan = (await response.json()) as { id: string; budget: { amount_minor: number } };
      expect(plan.budget.amount_minor).toBe(accepted);
      const stored = await sql<{ budget_amount_minor: string; type: string }[]>`
        SELECT budget_amount_minor, pg_typeof(budget_amount_minor)::text AS type
        FROM plans WHERE id = ${plan.id}
      `;
      expect(Number(stored[0]!.budget_amount_minor)).toBe(accepted);
      expect(["integer", "bigint"]).toContain(stored[0]!.type);
    }
  });

  it("T-001-86/AC-4 T-001-04/AC-1 an error body has code, message, and fields as an array", async () => {
    const unauthenticated = await getMe(getRequest("/api/v1/me"));
    expect(unauthenticated.status).toBe(401);
    const missing = (await unauthenticated.json()) as {
      error: { code: string; reason?: string; message: unknown; fields: unknown };
    };
    expect(missing.error.code).toBe("unauthenticated");
    expect(missing.error.reason).toBe("missing_session");
    expect(typeof missing.error.message).toBe("string");
    expect(missing.error.fields).toEqual([]);

    const invalid = await createAccount(
      jsonRequest("/api/v1/accounts", "POST", accountBody("not-an-email")),
    );
    expect(invalid.status).toBe(400);
    const rejected = (await invalid.json()) as {
      error: { code: string; message: unknown; fields: { path: string; code: string }[] };
    };
    expect(rejected.error.code).toBe("validation_failed");
    expect(typeof rejected.error.message).toBe("string");
    expect(Array.isArray(rejected.error.fields)).toBe(true);
    expect(rejected.error.fields).toContainEqual({ path: "email", code: "bad_email" });
  });

  it("T-001-86/AC-5 T-001-05/AC-3 hp_session, hp_guest, and hp_link are httpOnly, SameSite=Lax, Path=/, 30-day, and Secure only when HP_COOKIE_SECURE=1", async () => {
    async function issued(): Promise<Record<string, string>> {
      const { cookie } = await register(track(uniqueEmail("cookies")));
      const plan = await openPlan(cookie);
      const registered = await createAccount(
        jsonRequest("/api/v1/accounts", "POST", accountBody(track(uniqueEmail("cookies")))),
      );
      const guest = await joinAnonymously(plan.join_path);
      const token = plan.join_path.slice("/join/".length);
      const link = await joinGet(getRequest(`/api/v1/join/${token}`), {
        params: Promise.resolve({ token }),
      });
      expect(link.status).toBe(200);
      return {
        hp_session: setCookieLine(registered, "hp_session"),
        hp_guest: setCookieLine(guest.response, "hp_guest"),
        hp_link: setCookieLine(link, "hp_link"),
      };
    }

    function expectContracted(name: string, line: string, secure: boolean): void {
      expect(line, `${name} was not set`).not.toBe("");
      const attributes = line.split(";").slice(1).map((part) => part.trim().toLowerCase());
      expect(attributes).toContain("httponly");
      expect(attributes).toContain("samesite=lax");
      expect(attributes).toContain("path=/");
      expect(attributes.includes("secure")).toBe(secure);
      const maxAge = attributes.find((part) => part.startsWith("max-age="));
      const expires = attributes.find((part) => part.startsWith("expires="));
      if (maxAge) {
        expect(Number(maxAge.slice("max-age=".length))).toBe(SESSION_MAX_AGE);
      } else {
        expect(expires, `${name} has no Max-Age or Expires`).toBeDefined();
        const lifetime = Date.parse(expires!.slice("expires=".length)) - Date.now();
        expect(Math.abs(lifetime - SESSION_MAX_AGE * 1000)).toBeLessThan(5 * 60 * 1000);
      }
    }

    const plain = await issued();
    for (const [name, line] of Object.entries(plain)) {
      expectContracted(name, line, false);
    }

    process.env.HP_COOKIE_SECURE = "1";
    const secured = await issued();
    for (const [name, line] of Object.entries(secured)) {
      expectContracted(name, line, true);
    }
  });

  it("T-001-86/AC-6 T-001-06/AC-1 POST /v1/accounts answers 201 with the account and hp_session; 409 email_taken and 400 create nothing and set no cookie", async () => {
    const email = track(uniqueEmail("signup"));
    const created = await createAccount(jsonRequest("/api/v1/accounts", "POST", accountBody(email)));
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      account: { id: string; email: string; display_name: string };
    };
    expect(body.account).toEqual({ id: expect.stringMatching(/^acc_/), email, display_name: "Omar" });
    expect(cookieValue(created, "hp_session").length).toBeGreaterThan(8);
    expect(await accountCount(email)).toBe(1);

    const taken = await createAccount(
      jsonRequest("/api/v1/accounts", "POST", accountBody(email, { display_name: "Second" })),
    );
    expect(taken.status).toBe(409);
    expect(((await taken.json()) as { error: { code: string; reason: string } }).error).toMatchObject({
      code: "conflict",
      reason: "email_taken",
    });
    expect(setCookieLine(taken, "hp_session")).toBe("");
    expect(await accountCount(email)).toBe(1);

    const badEmail = `bad-${randomBytes(6).toString("hex")}`;
    const invalid = await createAccount(
      jsonRequest("/api/v1/accounts", "POST", accountBody(badEmail, { password: "short" })),
    );
    expect(invalid.status).toBe(400);
    const fields = ((await invalid.json()) as { error: { fields: { path: string }[] } }).error.fields;
    expect(fields.map((field) => field.path)).toEqual(expect.arrayContaining(["email", "password"]));
    expect(setCookieLines(invalid)).toEqual([]);
    expect(await accountCount(badEmail)).toBe(0);
  });

  it("T-001-86/AC-7 T-001-13/AC-1 Places calls send X-Goog-Api-Key and the contracted masks, never a wildcard; start calls omit priceRange and the venue mask includes it", async () => {
    const { cookie } = await register(track(uniqueEmail("places")));
    const plan = await openPlan(cookie, { steps: [{ name: "Dinner", options: ["Koshary", "Grills"] }] });
    const guest = await joinAnonymously(plan.join_path);
    const params = { params: Promise.resolve({ planId: plan.id }) };

    const searchCalls: Recorded[] = [];
    setPlaceSearchGoogle({
      apiKey: "test-places-key",
      fetch: recordingFetch(searchCalls, (url, body) =>
        url === PLACES_SEARCH_TEXT_URL ? { places: [startCafe] } : googleAnswer(url, body),
      ),
    });
    const searched = await searchPlaces(
      getRequest(`/api/v1/plans/${plan.id}/place-searches?q=Maadi`, guest.cookie),
      params,
    );
    expect(searched.status).toBe(200);
    expect(searchCalls).toHaveLength(1);

    const detailCalls: Recorded[] = [];
    setResponseGoogle({ apiKey: "test-places-key", fetch: recordingFetch(detailCalls, googleAnswer) });
    const saved = await putResponse(
      jsonRequest(`/api/v1/plans/${plan.id}/response`, "PUT", { start_place_id: startCafe.id }, {
        cookie: guest.cookie,
      }),
      params,
    );
    expect(saved.status).toBe(200);
    expect(detailCalls).toHaveLength(1);
    expect(detailCalls[0]!.url).toContain(`/v1/places/${startCafe.id}`);

    for (const [call, mask] of [
      [searchCalls[0]!, START_MASK],
      [detailCalls[0]!, DETAILS_MASK],
    ] as const) {
      expect(call.headers["X-Goog-Api-Key"]).toBe("test-places-key");
      expect(call.headers["X-Goog-FieldMask"]).toBe(mask);
      expect(call.headers["X-Goog-FieldMask"]).not.toContain("*");
      expect(call.headers["X-Goog-FieldMask"]).not.toContain("priceRange");
    }

    const shape = await sql<{ id: string; step_id: string; label: string }[]>`
      SELECT o.id, o.step_id, o.label FROM plan_options o
      JOIN plan_steps s ON s.id = o.step_id WHERE s.plan_id = ${plan.id}
    `;
    const windows = await sql<{ id: string }[]>`SELECT id FROM plan_windows WHERE plan_id = ${plan.id}`;
    const koshary = shape.find((row) => row.label === "Koshary")!;
    const venueCalls: Recorded[] = [];
    setProposalAttemptGoogleOptions({
      apiKey: "test-places-key",
      fetch: recordingFetch(venueCalls, googleAnswer),
    });
    const completed = await putResponse(
      jsonRequest(
        `/api/v1/plans/${plan.id}/response`,
        "PUT",
        {
          windows: [
            { window_id: windows[0]!.id, kind: "free", earliest_local: "18:00", latest_local: "19:00" },
          ],
          start_place_id: startCafe.id,
          picks: [{ step_id: koshary.step_id, option_id: koshary.id }],
        },
        { cookie: guest.cookie },
      ),
      params,
    );
    expect(completed.status).toBe(200);
    expect(((await completed.json()) as { first_completion: boolean }).first_completion).toBe(true);

    const venueSearch = venueCalls.find((call) => call.url === PLACES_SEARCH_TEXT_URL);
    expect(venueSearch, "no venue search ran").toBeDefined();
    expect(venueSearch!.headers["X-Goog-Api-Key"]).toBe("test-places-key");
    expect(venueSearch!.headers["X-Goog-FieldMask"]).toBe(VENUE_MASK);
    expect(venueSearch!.headers["X-Goog-FieldMask"]).toContain("places.priceRange");
    expect(venueSearch!.headers["X-Goog-FieldMask"]).not.toContain("*");
  });
});
