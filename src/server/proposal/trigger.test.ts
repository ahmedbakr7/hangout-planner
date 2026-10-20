import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { POST as createAccount } from "@/app/api/v1/accounts/route";
import { POST as createPlan } from "@/app/api/v1/plans/route";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { closeDatabase as closeAttempt } from "./attempt";
import { applyHourFullVenueData } from "./trigger";

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

function uniqueEmail(label = "user"): string {
  const email = `${label}.${randomBytes(8).toString("hex")}@example.com`;
  createdEmails.push(email);
  return email;
}

function jsonRequest(path: string, body: unknown, cookie?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-hp-request": "1",
  };
  if (cookie) {
    headers.cookie = cookie;
  }
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function register(email: string): Promise<string> {
  const response = await createAccount(
    jsonRequest("/v1/accounts", {
      email,
      password: "password1",
      display_name: "Omar",
    }),
  );
  expect(response.status).toBe(201);
  const line =
    response.headers.getSetCookie().find((entry) => entry.startsWith("hp_session=")) ?? "";
  const pair = line.split(";", 1)[0] ?? "";
  return decodeURIComponent(pair.slice("hp_session=".length));
}

async function openPlan(sessionToken: string): Promise<string> {
  const response = await createPlan(
    jsonRequest(
      "/v1/plans",
      {
        title: "Thursday in Maadi",
        timezone: "Africa/Cairo",
        windows: [{ local_date: "2026-10-02", start_local: "18:00", end_local: "19:00" }],
        budget: { amount_minor: 50_000, currency: "EGP" },
        steps: [{ name: "Dinner", options: ["Koshary", "Grills"] }],
        threshold: 2,
      },
      `hp_session=${sessionToken}`,
    ),
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function forget(email: string): Promise<void> {
  const rows = await sql<{ id: string }[]>`SELECT id FROM accounts WHERE email = ${email}`;
  for (const account of rows) {
    const planRows = await sql<{ id: string }[]>`
      SELECT id FROM plans WHERE organizer_account_id = ${account.id}
    `;
    for (const plan of planRows) {
      await sql`DELETE FROM proposal_runs WHERE plan_id = ${plan.id}`;
      await sql`DELETE FROM plan_options WHERE step_id IN (SELECT id FROM plan_steps WHERE plan_id = ${plan.id})`;
      await sql`DELETE FROM plan_steps WHERE plan_id = ${plan.id}`;
      await sql`DELETE FROM plan_windows WHERE plan_id = ${plan.id}`;
      await sql`DELETE FROM plans WHERE id = ${plan.id}`;
    }
    await sql`DELETE FROM sessions WHERE account_id = ${account.id}`;
    await sql`DELETE FROM accounts WHERE id = ${account.id}`;
  }
}

beforeAll(async () => {
  await sql`SELECT pg_advisory_lock(60168)`;
  try {
    const rows = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'accounts'
      ) AS exists
    `;
    if (!rows[0]?.exists) {
      await sql.file(resolve(process.cwd(), "drizzle/0001_init.sql"));
    }
  } finally {
    await sql`SELECT pg_advisory_unlock(60168)`;
  }
});

beforeEach(() => {
  process.env.HP_HASH_TEST = "1";
});

afterEach(async () => {
  delete process.env.HP_HASH_TEST;
  for (const email of createdEmails.splice(0, createdEmails.length)) {
    await forget(email);
  }
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
  await closeAttempt();
  await closePlans();
  await closeAccounts();
});

describe("applyHourFullVenueData", () => {
  it("T-001-68/AC-6 stores a blocked venue_data run with a prn_ id, and a second call stores another with a different id", async () => {
    const planId = await openPlan(await register(uniqueEmail("org")));

    await applyHourFullVenueData(planId);
    const first = await sql<
      {
        id: string;
        outcome: string;
        block_time: boolean;
        block_budget: boolean;
        block_venue_data: boolean;
      }[]
    >`
      SELECT id, outcome, block_time, block_budget, block_venue_data
      FROM proposal_runs WHERE plan_id = ${planId}
    `;
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      outcome: "blocked",
      block_time: false,
      block_budget: false,
      block_venue_data: true,
    });
    expect(first[0]?.id).toMatch(/^prn_[0-9a-f]{32}$/);

    await applyHourFullVenueData(planId);
    const both = await sql<{ id: string }[]>`
      SELECT id FROM proposal_runs WHERE plan_id = ${planId}
    `;
    expect(both).toHaveLength(2);
    expect(both[0]?.id).toMatch(/^prn_[0-9a-f]{32}$/);
    expect(both[1]?.id).toMatch(/^prn_[0-9a-f]{32}$/);
    expect(both[0]?.id).not.toBe(both[1]?.id);
  });
});
