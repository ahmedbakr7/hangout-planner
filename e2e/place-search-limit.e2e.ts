/**
 * T-001-57 — the place-search limit (30 per participant per rolling hour, ADR-0005) is counted in
 * the place_searches table, so it holds across server instances. Each request goes to the real
 * route handlers over the real database; Google is faked at the server's client options.
 */
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { resetClock, setClock } from "@/server/clock";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { PLACES_SEARCH_TEXT_URL, type FetchFn } from "@/server/google/places";
import { setGoogleClientOptions } from "@/server/response/place-search";
import { cleanupThenClose } from "./db-cleanup";
import { createRouteServer, type RouteServer } from "./route-server";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}
const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

const NOW = new Date("2026-04-10T12:00:00.000Z");
const emails: string[] = [];

const fakeGoogle: FetchFn = async (request) => {
  const url = typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
  if (url !== PLACES_SEARCH_TEXT_URL) {
    throw new Error(`unexpected Google call ${url}`);
  }
  return new Response(
    JSON.stringify({
      places: [{ id: "ChIJ-start", displayName: { text: "Maadi, Cairo" }, location: { latitude: 29.96, longitude: 31.25 } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};

let server: RouteServer;

beforeEach(() => {
  process.env.HP_HASH_TEST = "1";
  setGoogleClientOptions({ apiKey: "test-places-key", fetch: fakeGoogle });
  setClock(NOW);
  server = createRouteServer();
});

afterEach(async () => {
  resetClock();
  setGoogleClientOptions(undefined);
  delete process.env.HP_HASH_TEST;
  const toForget = emails.splice(0, emails.length);
  for (const email of toForget) {
    const accounts = await sql<{ id: string }[]>`SELECT id FROM accounts WHERE email = ${email}`;
    for (const account of accounts) {
      const plans = await sql<{ id: string }[]>`SELECT id FROM plans WHERE organizer_account_id = ${account.id}`;
      for (const plan of plans) {
        await sql`DELETE FROM place_searches WHERE participant_id IN (SELECT id FROM participants WHERE plan_id = ${plan.id})`;
        await sql`DELETE FROM participants WHERE plan_id = ${plan.id}`;
        await sql`DELETE FROM plan_options WHERE step_id IN (SELECT id FROM plan_steps WHERE plan_id = ${plan.id})`;
        await sql`DELETE FROM plan_steps WHERE plan_id = ${plan.id}`;
        await sql`DELETE FROM plan_windows WHERE plan_id = ${plan.id}`;
        await sql`DELETE FROM plans WHERE id = ${plan.id}`;
      }
      await sql`DELETE FROM place_searches WHERE participant_id IN (SELECT id FROM participants WHERE account_id = ${account.id})`;
      await sql`DELETE FROM participants WHERE account_id = ${account.id}`;
      await sql`DELETE FROM sessions WHERE account_id = ${account.id}`;
      await sql`DELETE FROM accounts WHERE id = ${account.id}`;
    }
  }
});

afterAll(async () => {
  await cleanupThenClose(async () => {}, () => sql.end({ timeout: 5 }), closePlans, closeAccounts);
});

function opaque(prefix: string): string {
  return `${prefix}${randomBytes(8).toString("hex")}`;
}

async function post(path: string, body: unknown): Promise<Response> {
  return server.serve(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hp-request": "1" },
    body: JSON.stringify(body),
  });
}

/** An organizer opens a plan; a second account becomes its participant. Returns the member's cookies. */
async function seedPlanWithMember(): Promise<{ planId: string; participantId: string; memberCookies: string }> {
  const organizerEmail = `org.${randomBytes(8).toString("hex")}@example.com`;
  const memberEmail = `member.${randomBytes(8).toString("hex")}@example.com`;
  emails.push(organizerEmail, memberEmail);

  expect((await post("/api/v1/accounts", { email: organizerEmail, password: "password1", display_name: "Omar" })).status).toBe(201);
  const created = await post("/api/v1/plans", {
    title: "Thursday in Maadi",
    timezone: "Africa/Cairo",
    windows: [{ local_date: "2026-10-02", start_local: "18:00", end_local: "23:00" }],
    budget: { amount_minor: 50_000, currency: "EGP" },
    steps: [{ name: "Dinner", options: ["Koshary", "Grills"] }],
    threshold: 3,
  });
  expect(created.status).toBe(201);
  const planId = ((await created.json()) as { id: string }).id;

  server.useCookies("");
  const member = await post("/api/v1/accounts", { email: memberEmail, password: "password1", display_name: "Nour" });
  expect(member.status).toBe(201);
  const accountId = ((await member.json()) as { account: { id: string } }).account.id;
  const memberCookies = server.cookies();

  const participantId = opaque("prt_");
  await sql`
    INSERT INTO participants (id, plan_id, account_id, guest_session_id, display_name, distinguisher)
    VALUES (${participantId}, ${planId}, ${accountId}, NULL, 'Nour', 'a3k9')
  `;
  return { planId, participantId, memberCookies };
}

async function seedRows(participantId: string, total: number, searchedAt: Date): Promise<void> {
  for (let i = 0; i < total; i += 1) {
    await sql`
      INSERT INTO place_searches (id, participant_id, searched_at)
      VALUES (${`pse_${randomBytes(16).toString("hex")}`}, ${participantId}, ${searchedAt})
    `;
  }
}

async function rowCount(participantId: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM place_searches WHERE participant_id = ${participantId}
  `;
  return rows[0]?.n ?? 0;
}

async function search(planId: string, cookies: string): Promise<Response> {
  server.useCookies(cookies);
  return server.serve(`/api/v1/plans/${planId}/place-searches?q=${encodeURIComponent("Maadi")}`);
}

describe("GET /api/v1/plans/{planId}/place-searches limit in Postgres", () => {
  it("T-001-57/AC-1 returns 429 when 30 rows newer than one hour exist, in an instance that served none of them", async () => {
    const { planId, participantId, memberCookies } = await seedPlanWithMember();
    await seedRows(participantId, 30, new Date(NOW.getTime() - 30 * 60 * 1000));

    const limited = await search(planId, memberCookies);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: { code: "rate_limited", fields: [] } });
  });

  it("T-001-57/AC-2 an allowed search inserts one row stamped with now, and a refused search inserts none", async () => {
    const { planId, participantId, memberCookies } = await seedPlanWithMember();

    const allowed = await search(planId, memberCookies);
    expect(allowed.status).toBe(200);
    await allowed.json();
    const rows = await sql<{ searched_at: Date }[]>`
      SELECT searched_at FROM place_searches WHERE participant_id = ${participantId}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.searched_at.getTime()).toBe(NOW.getTime());

    await seedRows(participantId, 29, new Date(NOW.getTime() - 15 * 60 * 1000));
    const refused = await search(planId, memberCookies);
    expect(refused.status).toBe(429);
    await refused.json();
    expect(await rowCount(participantId)).toBe(30);
  });

  it("T-001-57/AC-3 rows older than one hour do not count, and a search deletes the caller's old rows", async () => {
    const { planId, participantId, memberCookies } = await seedPlanWithMember();
    await seedRows(participantId, 30, new Date(NOW.getTime() - 61 * 60 * 1000));
    await seedRows(participantId, 3, new Date(NOW.getTime() - 60 * 60 * 1000));

    const allowed = await search(planId, memberCookies);
    expect(allowed.status).toBe(200);
    await allowed.json();

    const left = await sql<{ searched_at: Date }[]>`
      SELECT searched_at FROM place_searches WHERE participant_id = ${participantId}
    `;
    expect(left).toHaveLength(1);
    expect(left[0]?.searched_at.getTime()).toBe(NOW.getTime());
  });

  it("T-001-57/AC-4 with 29 rows newer than one hour, two concurrent searches allow exactly one", async () => {
    const { planId, participantId, memberCookies } = await seedPlanWithMember();
    await seedRows(participantId, 29, new Date(NOW.getTime() - 10 * 60 * 1000));

    // Separate route servers so the two calls do not share a cookie jar.
    const other = createRouteServer();
    other.useCookies(memberCookies);
    const url = `/api/v1/plans/${planId}/place-searches?q=${encodeURIComponent("Maadi")}`;
    server.useCookies(memberCookies);
    const responses = await Promise.all([server.serve(url), other.serve(url)]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 429]);
    for (const response of responses) {
      await response.json();
    }
    expect(await rowCount(participantId)).toBe(30);
  });
});
