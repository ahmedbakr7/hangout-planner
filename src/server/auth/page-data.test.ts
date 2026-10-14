import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { POST as createAccount } from "@/app/api/v1/accounts/route";
import { GET as getMe } from "@/app/api/v1/me/route";
import { closeDatabase } from "@/server/auth/http";
import { loadAccountPage } from "@/server/auth/page-data";
import { hashCookieToken } from "@/server/auth/session";

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

function reader(cookies: Record<string, string>): (name: string) => string | null {
  return (name) => cookies[name] ?? null;
}

async function forget(email: string): Promise<void> {
  await sql`
    DELETE FROM sessions
    WHERE account_id IN (SELECT id FROM accounts WHERE email = ${email})
  `;
  await sql`DELETE FROM accounts WHERE email = ${email}`;
}

beforeAll(async () => {
  await sql`SELECT pg_advisory_lock(60148)`;
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
    await sql`SELECT pg_advisory_unlock(60148)`;
  }
});

beforeEach(() => {
  process.env.HP_HASH_TEST = "1";
});

afterEach(async () => {
  delete process.env.HP_HASH_TEST;
  vi.unstubAllGlobals();
  for (const email of createdEmails.splice(0, createdEmails.length)) {
    await forget(email);
  }
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
  await closeDatabase();
});

describe("loadAccountPage", () => {
  it("T-001-48/AC-2 answers ok with the account view and the session for a valid cookie", async () => {
    const email = uniqueEmail("nour");
    const created = await register(email, "Nour");
    const page = await loadAccountPage(reader({ hp_session: created.token }));
    expect(page.kind).toBe("ok");
    if (page.kind !== "ok") {
      return;
    }
    expect(page.view).toEqual({
      account: { id: created.id, email, display_name: "Nour" },
    });
    expect(page.session.token).toBe(created.token);
    expect(page.session.sessionId).toMatch(/^ses_/);
    expect(Object.keys(page.view)).toEqual(["account"]);
  });

  it("T-001-48/AC-4 answers signed_out for no cookie, a guest-only browser, and an unknown token", async () => {
    await register(uniqueEmail("hidden"), "Hidden");
    expect(await loadAccountPage(reader({}))).toEqual({ kind: "signed_out" });
    expect(await loadAccountPage(reader({ hp_guest: "guest-only" }))).toEqual({
      kind: "signed_out",
    });
    expect(await loadAccountPage(reader({ hp_session: "not-a-session" }))).toEqual({
      kind: "signed_out",
    });
  });

  it("T-001-48/AC-1 the loader keeps expires_at and GET /api/v1/me moves it later", async () => {
    const created = await register(uniqueEmail("slide"), "Slide");
    const shortExpiry = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const tokenHash = hashCookieToken(created.token);
    await sql`UPDATE sessions SET expires_at = ${shortExpiry} WHERE token_hash = ${tokenHash}`;
    const storedExpiry = async (): Promise<number> => {
      const rows = await sql<{ expires_at: Date }[]>`
        SELECT expires_at FROM sessions WHERE token_hash = ${tokenHash}
      `;
      return new Date(rows[0]?.expires_at ?? 0).getTime();
    };

    const page = await loadAccountPage(reader({ hp_session: created.token }));
    expect(page.kind).toBe("ok");
    expect(await storedExpiry()).toBe(shortExpiry.getTime());

    const answer = await getMe(
      new Request("http://localhost/v1/me", {
        headers: { cookie: `hp_session=${created.token}` },
      }),
    );
    expect(answer.status).toBe(200);
    expect(await storedExpiry()).toBeGreaterThan(shortExpiry.getTime());
  });
});
