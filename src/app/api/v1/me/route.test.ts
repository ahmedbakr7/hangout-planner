import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { hashCookieToken } from "@/server/auth/session";
import { resetClock, setClock } from "@/server/clock";
import { POST as createAccount, closeDatabase } from "../accounts/route";
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
  const body = (await response.json()) as {
    account: { id: string; email: string; display_name: string };
  };
  const line = sessionSetCookie(response);
  expect(line).not.toBeNull();
  return { account: body.account, token: cookieValue(line!) };
}

function meRequest(cookie?: string) {
  const headers: Record<string, string> = {};
  if (cookie) {
    headers.cookie = cookie;
  }
  return new Request("http://localhost/v1/me", { headers });
}

describe("GET /v1/me", () => {
  it("returns 200 with the account for a session", async () => {
    const email = track(uniqueEmail("me"));
    const created = await register(email);
    const response = await GET(
      meRequest(`hp_guest=guest-token; hp_session=${created.token}`),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ account: created.account });
    expect(body.account.email).toBe(email);
    expect(Object.keys(body)).toEqual(["account"]);
    expect(Object.keys(body.account).sort()).toEqual(["display_name", "email", "id"]);
    const line = sessionSetCookie(response);
    expect(line).not.toBeNull();
    expect(cookieValue(line!)).toBe(created.token);
  });

  it("returns 401 missing_session with no cookie, a guest-only browser, or an unknown token", async () => {
    const email = track(uniqueEmail("hidden"));
    await register(email);

    const cases = [
      meRequest(),
      meRequest("hp_guest=guest-only"),
      meRequest("hp_session=not-a-session"),
      meRequest("hp_guest=guest-only; hp_session="),
    ];

    for (const request of cases) {
      const response = await GET(request);
      expect(response.status).toBe(401);
      expect(sessionSetCookie(response)).toBeNull();
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
      expect(JSON.stringify(body)).not.toContain(email);
      expect(JSON.stringify(body)).not.toContain("Nour");
    }
  });

  it("returns 401 missing_session when the session is expired and does not include the email", async () => {
    const email = track(uniqueEmail("old"));
    const created = await register(email);
    setClock(Date.now() + 31 * 24 * 60 * 60 * 1000);

    const response = await GET(meRequest(`hp_session=${created.token}`));
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
    expect(JSON.stringify(body)).not.toContain(email);
    expect(sessionSetCookie(response)).toBeNull();
  });

  it("slides the session expiry on a signed-in read", async () => {
    setClock(new Date("2026-04-01T00:00:00.000Z"));
    const email = track(uniqueEmail("slide"));
    const created = await register(email);

    setClock(new Date("2026-04-10T00:00:00.000Z"));
    const response = await GET(meRequest(`hp_session=${created.token}`));
    expect(response.status).toBe(200);
    expect(cookieValue(sessionSetCookie(response)!)).toBe(created.token);

    const rows = await sql<{ token_hash: string; expires_at: Date | string }[]>`
      SELECT token_hash, expires_at
      FROM sessions
      WHERE token_hash = ${hashCookieToken(created.token)}
    `;
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0]!.expires_at).toISOString()).toBe("2026-05-10T00:00:00.000Z");
  });

  it("does not require X-HP-Request", async () => {
    const email = track(uniqueEmail("get"));
    const created = await register(email);
    const response = await GET(
      new Request("http://localhost/v1/me", {
        headers: {
          cookie: `hp_session=${created.token}`,
        },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { account: { email: string } };
    expect(body.account.email).toBe(email);
  });
});
