import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { POST as createAccount } from "@/app/api/v1/accounts/route";
import { closeDatabase as closeAuth, readAccountSession } from "@/server/auth/http";
import { accounts } from "@/server/db/schema";
import { closeDatabase as closeInbox, db as inboxDb } from "@/server/invites/inbox";
import { closeDatabase as closeJoin, db as joinDb } from "@/server/join/db";
import { closeDatabase as closePlans, db as plansDb } from "@/server/plans/http";
import { closeDatabase as closeAttempt } from "@/server/proposal/attempt";

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

const closers = [closeAuth, closePlans, closeAttempt, closeInbox, closeJoin];

function uniqueEmail(label: string): string {
  const email = `${label}.${randomBytes(8).toString("hex")}@example.com`;
  createdEmails.push(email);
  return email;
}

async function register(
  email: string,
  displayName: string,
): Promise<{ id: string; token: string }> {
  const response = await createAccount(
    new Request("http://localhost/v1/accounts", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hp-request": "1" },
      body: JSON.stringify({ email, password: "password1", display_name: displayName }),
    }),
  );
  expect(response.status).toBe(201);
  const body = (await response.json()) as { account: { id: string } };
  const line = response.headers.getSetCookie().find((entry) => entry.startsWith("hp_session="));
  const pair = (line ?? "").split(";", 1)[0] ?? "";
  return { id: body.account.id, token: decodeURIComponent(pair.slice("hp_session=".length)) };
}

async function forget(email: string): Promise<void> {
  await sql`
    DELETE FROM sessions
    WHERE account_id IN (SELECT id FROM accounts WHERE email = ${email})
  `;
  await sql`DELETE FROM accounts WHERE email = ${email}`;
}

async function useEveryClient(accountId: string, token: string): Promise<void> {
  for (const db of [plansDb, inboxDb, joinDb]) {
    const rows = await db().select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId));
    expect(rows).toEqual([{ id: accountId }]);
  }
  const session = await readAccountSession(token);
  expect(session.ok).toBe(true);
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
  await Promise.allSettled(closers.map((close) => close()));
});

describe("closeDatabase", () => {
  it("T-001-68/AC-1 resolves for the five modules one after another, twice", async () => {
    const account = await register(uniqueEmail("nour"), "Nour");
    await useEveryClient(account.id, account.token);
    for (let round = 0; round < 2; round += 1) {
      for (const close of closers) {
        await expect(close()).resolves.toBeUndefined();
      }
    }
  });

  it("T-001-68/AC-2 fulfils all five when they run at the same time", async () => {
    const account = await register(uniqueEmail("nour"), "Nour");
    await useEveryClient(account.id, account.token);
    const results = await Promise.allSettled(closers.map((close) => close()));
    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "fulfilled",
      "fulfilled",
      "fulfilled",
    ]);
  });

  it.each([
    ["auth/http", closeAuth],
    ["plans/http", closePlans],
    ["proposal/attempt", closeAttempt],
    ["invites/inbox", closeInbox],
    ["join/db", closeJoin],
  ])("T-001-68/AC-3 queries still work after %s closeDatabase resolves", async (_name, close) => {
    const account = await register(uniqueEmail("nour"), "Nour");
    await useEveryClient(account.id, account.token);
    await close();
    await useEveryClient(account.id, account.token);
  });
});

describe("without DATABASE_URL", () => {
  const original = process.env.DATABASE_URL;

  afterEach(() => {
    process.env.DATABASE_URL = original;
    vi.resetModules();
  });

  it("T-001-68/AC-4 imports the five modules and throws naming DATABASE_URL on the first db() call", async () => {
    vi.resetModules();
    delete process.env.DATABASE_URL;
    await import("@/server/auth/http");
    await import("@/server/proposal/attempt");
    const plans = await import("@/server/plans/http");
    const inbox = await import("@/server/invites/inbox");
    const join = await import("@/server/join/db");
    for (const db of [plans.db, inbox.db, join.db]) {
      expect(() => db()).toThrow(Error);
      expect(() => db()).toThrow(/DATABASE_URL/);
    }
  });
});
