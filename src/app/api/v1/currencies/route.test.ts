import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { resetClock } from "@/server/clock";
import { POST as createAccount } from "../accounts/route";
import { closeDatabase } from "@/server/auth/http";
import { GET } from "./route";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const migrationPath = resolve(process.cwd(), "drizzle/0001_init.sql");

const sql = postgres(databaseUrl, {
  max: 1,
  idle_timeout: 0,
  connect_timeout: 10,
  onnotice: () => {},
});

const createdEmails: string[] = [];

function uniqueEmail(label = "user"): string {
  return `${label}.${randomBytes(8).toString("hex")}@example.com`;
}

function track(email: string): string {
  createdEmails.push(email);
  return email;
}

async function forget(email: string): Promise<void> {
  await sql`
    DELETE FROM sessions
    WHERE account_id IN (SELECT id FROM accounts WHERE email = ${email})
  `;
  await sql`DELETE FROM accounts WHERE email = ${email}`;
}

beforeAll(async () => {
  await sql`SELECT pg_advisory_lock(60106)`;
  try {
    const rows = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'accounts'
      ) AS exists
    `;
    if (!rows[0]?.exists) {
      await sql.file(migrationPath);
    }
  } finally {
    await sql`SELECT pg_advisory_unlock(60106)`;
  }
});

beforeEach(() => {
  process.env.HP_HASH_TEST = "1";
});

afterEach(async () => {
  resetClock();
  delete process.env.HP_HASH_TEST;
  const emails = createdEmails.splice(0, createdEmails.length);
  for (const email of emails) {
    await forget(email);
  }
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
  await closeDatabase();
});

function setCookieLines(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function sessionSetCookie(response: Response): string | null {
  return setCookieLines(response).find((line) => line.startsWith("hp_session=")) ?? null;
}

function cookieValue(line: string): string {
  const pair = line.split(";", 1)[0] ?? "";
  return decodeURIComponent(pair.slice("hp_session=".length));
}

async function register(email: string) {
  const response = await createAccount(
    new Request("http://localhost/v1/accounts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hp-request": "1",
      },
      body: JSON.stringify({
        email,
        password: "password1",
        display_name: "Nour",
      }),
    }),
  );
  expect(response.status).toBe(201);
  const line = sessionSetCookie(response);
  expect(line).not.toBeNull();
  return { token: cookieValue(line!) };
}

function currenciesRequest(cookie?: string) {
  const headers: Record<string, string> = {};
  if (cookie) {
    headers.cookie = cookie;
  }
  return new Request("http://localhost/v1/currencies", { headers });
}

describe("GET /v1/currencies", () => {
  it("returns EGP, USD, SAR, and AED, each exponent 2, for an account", async () => {
    const email = track(uniqueEmail("fx"));
    const created = await register(email);
    const response = await GET(
      currenciesRequest(`hp_session=${created.token}`),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      currencies: [
        { code: "EGP", exponent: 2 },
        { code: "USD", exponent: 2 },
        { code: "SAR", exponent: 2 },
        { code: "AED", exponent: 2 },
      ],
    });
    expect(Object.keys(body)).toEqual(["currencies"]);
    expect(JSON.stringify(body)).not.toContain(email);
  });

  it("returns 401 missing_session without an account session", async () => {
    const cases = [
      currenciesRequest(),
      currenciesRequest("hp_guest=guest-only"),
      currenciesRequest("hp_session=not-a-session"),
    ];
    for (const request of cases) {
      const response = await GET(request);
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body).toEqual({
        error: {
          code: "unauthenticated",
          reason: "missing_session",
          message: "missing session",
          fields: [],
        },
      });
      expect(Object.keys(body)).toEqual(["error"]);
    }
  });

  it("does not require X-HP-Request", async () => {
    const email = track(uniqueEmail("get"));
    const created = await register(email);
    const response = await GET(
      new Request("http://localhost/v1/currencies", {
        headers: { cookie: `hp_session=${created.token}` },
      }),
    );
    expect(response.status).toBe(200);
  });
});
