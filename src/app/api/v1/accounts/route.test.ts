import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { verifyPassword } from "@/server/auth/password";
import { hashCookieToken, SESSION_MAX_AGE_SECONDS } from "@/server/auth/session";
import { resetClock } from "@/server/clock";
import { isId } from "@/server/ids";
import { POST } from "./route";
import { closeDatabase } from "@/server/auth/http";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const migrationPath = resolve(process.cwd(), "drizzle/0001_init.sql");
const originalSecure = process.env.HP_COOKIE_SECURE;

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

function emailOfLength(length: number): string {
  const domain = `b.${"c".repeat(length - 4)}`;
  return `a@${domain}`;
}

async function forget(email: string): Promise<void> {
  await sql`
    DELETE FROM sessions
    WHERE account_id IN (SELECT id FROM accounts WHERE email = ${email})
  `;
  await sql`DELETE FROM accounts WHERE email = ${email}`;
}

async function accountCount(email: string): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM accounts WHERE email = ${email}
  `;
  return Number(rows[0]?.count ?? 0);
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
  if (originalSecure === undefined) {
    delete process.env.HP_COOKIE_SECURE;
  } else {
    process.env.HP_COOKIE_SECURE = originalSecure;
  }
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

function postAccounts(
  body: unknown,
  init?: { csrf?: boolean; headers?: Record<string, string>; raw?: string },
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(init?.headers ?? {}),
  };
  if (init?.csrf !== false && !headers["x-hp-request"]) {
    headers["x-hp-request"] = "1";
  }
  return POST(
    new Request("http://localhost/v1/accounts", {
      method: "POST",
      headers,
      body: init?.raw ?? JSON.stringify(body),
    }),
  );
}

describe("POST /v1/accounts", () => {
  it("returns 201 with the account and sets hp_session", async () => {
    const email = track(uniqueEmail("nour"));
    const password = "  a-secret";
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((message) => {
      logs.push(String(message));
    });

    const response = await postAccounts({
      email: `  ${email.toUpperCase()}  `,
      password,
      display_name: "  Nour  ",
      extra: true,
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      account: { id: string; email: string; display_name: string };
    };
    expect(Object.keys(body)).toEqual(["account"]);
    expect(Object.keys(body.account).sort()).toEqual(["display_name", "email", "id"]);
    expect(isId(body.account.id, "acc_")).toBe(true);
    expect(body.account.email).toBe(email);
    expect(body.account.display_name).toBe("Nour");

    const line = sessionSetCookie(response);
    expect(line).not.toBeNull();
    expect(line).toContain("HttpOnly");
    expect(line).toContain("SameSite=lax");
    expect(line).toContain("Path=/");
    expect(line).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`);
    expect(line).not.toContain("Secure");
    const token = cookieValue(line!);
    expect(token.length).toBeGreaterThan(0);

    const rows = await sql<
      { email: string; display_name: string; password_hash: string; token_hash: string }[]
    >`
      SELECT a.email, a.display_name, a.password_hash, s.token_hash
      FROM accounts a
      JOIN sessions s ON s.account_id = a.id
      WHERE a.email = ${email}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe(email);
    expect(rows[0]?.display_name).toBe("Nour");
    expect(rows[0]?.password_hash.startsWith("$argon2id$")).toBe(true);
    expect(rows[0]?.password_hash).not.toContain(password);
    expect(await verifyPassword(rows[0]!.password_hash, password)).toBe(true);
    expect(await verifyPassword(rows[0]!.password_hash, password.trim())).toBe(false);
    expect(rows[0]?.token_hash).toBe(hashCookieToken(token));
    expect(rows[0]?.token_hash).not.toBe(token);

    const logged = logs.map((line) => line).join("\n");
    expect(logged).not.toContain(password);
    expect(logged).not.toContain(token);
    const entry = JSON.parse(logs.at(-1) ?? "{}") as {
      request_id?: string;
      status?: number;
      path?: string;
    };
    expect(entry.request_id).toBe(response.headers.get("x-request-id"));
    expect(entry.status).toBe(201);
    expect(entry.path).toBe("/v1/accounts");
    spy.mockRestore();
  });

  it("accepts a display name of 1 and 40 characters and a password of 8 and 72", async () => {
    const shortEmail = track(uniqueEmail("short"));
    const longEmail = track(uniqueEmail("long"));
    const shortName = await postAccounts({
      email: shortEmail,
      password: "12345678",
      display_name: " ن ",
    });
    expect(shortName.status).toBe(201);
    const shortBody = (await shortName.json()) as { account: { display_name: string } };
    expect(shortBody.account.display_name).toBe("ن");

    const password = "p".repeat(72);
    const name = "n".repeat(40);
    const long = await postAccounts({
      email: `  ${longEmail.toUpperCase()} `,
      password,
      display_name: ` ${name} `,
    });
    expect(long.status).toBe(201);
    const longBody = (await long.json()) as {
      account: { email: string; display_name: string };
    };
    expect(longBody.account.email).toBe(longEmail);
    expect(longBody.account.display_name).toBe(name);
    const stored = await sql<{ password_hash: string }[]>`
      SELECT password_hash FROM accounts WHERE email = ${longEmail}
    `;
    expect(await verifyPassword(stored[0]!.password_hash, password)).toBe(true);
  });

  it("accepts an email of 254 characters and rejects 255", async () => {
    const okEmail = track(emailOfLength(254));
    const created = await postAccounts({
      email: ` ${okEmail.toUpperCase()} `,
      password: "password1",
      display_name: "Nour",
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { account: { email: string } };
    expect(body.account.email).toBe(okEmail);
    expect(await accountCount(okEmail)).toBe(1);

    const tooLong = track(emailOfLength(255));
    const rejected = await postAccounts({
      email: tooLong,
      password: "password1",
      display_name: "Nour",
    });
    expect(rejected.status).toBe(400);
    expect(sessionSetCookie(rejected)).toBeNull();
    expect(await rejected.json()).toEqual({
      error: {
        code: "validation_failed",
        message: "email is too long",
        fields: [{ path: "email", code: "too_long" }],
      },
    });
    expect(await accountCount(tooLong)).toBe(0);
  });

  it("returns 409 email_taken and does not create another account or set a cookie", async () => {
    const email = track(uniqueEmail("taken"));
    const first = await postAccounts({
      email,
      password: "password1",
      display_name: "Nour",
    });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { account: { id: string } };

    const second = await postAccounts({
      email: ` ${email.toUpperCase()} `,
      password: "other-password",
      display_name: "Hana",
    });
    expect(second.status).toBe(409);
    expect(sessionSetCookie(second)).toBeNull();
    const body = await second.json();
    expect(body).toEqual({
      error: {
        code: "conflict",
        reason: "email_taken",
        message: "email is already registered",
        fields: [],
      },
    });
    expect(JSON.stringify(body)).not.toContain(email);

    const rows = await sql<{ id: string; display_name: string; password_hash: string }[]>`
      SELECT id, display_name, password_hash FROM accounts WHERE email = ${email}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(firstBody.account.id);
    expect(rows[0]?.display_name).toBe("Nour");
    expect(await verifyPassword(rows[0]!.password_hash, "password1")).toBe(true);
    expect(await verifyPassword(rows[0]!.password_hash, "other-password")).toBe(false);
  });

  it("returns 400 for invalid fields and creates no account and no cookie", async () => {
    const cases: { body: Record<string, unknown>; fields: { path: string; code: string }[]; message: string }[] = [
      {
        body: { password: "password1", display_name: "Nour" },
        fields: [{ path: "email", code: "required" }],
        message: "email is required",
      },
      {
        body: { email: "   ", password: "password1", display_name: "Nour" },
        fields: [{ path: "email", code: "required" }],
        message: "email is required",
      },
      {
        body: { email: "nour.example.com", password: "password1", display_name: "Nour" },
        fields: [{ path: "email", code: "bad_email" }],
        message: "email is not an email",
      },
      {
        body: { email: "nour@example", password: "password1", display_name: "Nour" },
        fields: [{ path: "email", code: "bad_email" }],
        message: "email is not an email",
      },
      {
        body: { email: "nour@@example.com", password: "password1", display_name: "Nour" },
        fields: [{ path: "email", code: "bad_email" }],
        message: "email is not an email",
      },
      {
        body: { email: "nour@example.com.", password: "password1", display_name: "Nour" },
        fields: [{ path: "email", code: "bad_email" }],
        message: "email is not an email",
      },
      {
        body: { email: uniqueEmail("space"), password: "short", display_name: "Nour" },
        fields: [{ path: "password", code: "below_min" }],
        message: "password is below the minimum length",
      },
      {
        body: { email: uniqueEmail("longpw"), password: "p".repeat(73), display_name: "Nour" },
        fields: [{ path: "password", code: "above_max" }],
        message: "password is above the maximum length",
      },
      {
        body: { email: uniqueEmail("blank"), password: "password1", display_name: "   " },
        fields: [{ path: "display_name", code: "required" }],
        message: "display name is required",
      },
      {
        body: { email: uniqueEmail("name"), password: "password1", display_name: "n".repeat(41) },
        fields: [{ path: "display_name", code: "too_long" }],
        message: "display name is too long",
      },
    ];

    for (const item of cases) {
      const email = typeof item.body.email === "string" ? item.body.email.trim().toLowerCase() : "";
      if (email.includes("@")) {
        track(email);
      }
      const response = await postAccounts(item.body);
      expect(response.status).toBe(400);
      expect(sessionSetCookie(response)).toBeNull();
      const body = await response.json();
      expect(body).toEqual({
        error: {
          code: "validation_failed",
          message: item.message,
          fields: item.fields,
        },
      });
      expect(Object.keys(body)).toEqual(["error"]);
      if (email.includes("@")) {
        expect(await accountCount(email)).toBe(0);
      }
    }

    const email = track(uniqueEmail("many"));
    const many = await postAccounts({
      email: "",
      password: "short",
      display_name: "",
    });
    expect(many.status).toBe(400);
    expect(sessionSetCookie(many)).toBeNull();
    expect(await many.json()).toEqual({
      error: {
        code: "validation_failed",
        message: "invalid fields",
        fields: [
          { path: "email", code: "required" },
          { path: "password", code: "below_min" },
          { path: "display_name", code: "required" },
        ],
      },
    });
    expect(await accountCount(email)).toBe(0);

    const raw = await postAccounts(null, { raw: "not-json" });
    expect(raw.status).toBe(400);
    expect(sessionSetCookie(raw)).toBeNull();
    expect(await raw.json()).toEqual({
      error: {
        code: "validation_failed",
        message: "invalid fields",
        fields: [
          { path: "email", code: "required" },
          { path: "password", code: "required" },
          { path: "display_name", code: "required" },
        ],
      },
    });
  });

  it("returns 403 csrf and writes nothing when X-HP-Request is missing", async () => {
    const email = track(uniqueEmail("csrf"));
    const response = await postAccounts(
      { email, password: "password1", display_name: "Nour" },
      { csrf: false },
    );
    expect(response.status).toBe(403);
    expect(sessionSetCookie(response)).toBeNull();
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: "forbidden",
        reason: "csrf",
        message: "missing X-HP-Request",
        fields: [],
      },
    });
    expect(JSON.stringify(body)).not.toContain(email);
    expect(await accountCount(email)).toBe(0);

    const wrong = await postAccounts(
      { email, password: "password1", display_name: "Nour" },
      { headers: { "x-hp-request": "0" } },
    );
    expect(wrong.status).toBe(403);
    expect(await accountCount(email)).toBe(0);
  });

  it("keeps one account when two creates race on the same email", async () => {
    const email = track(uniqueEmail("race"));
    const [left, right] = await Promise.all([
      postAccounts({ email, password: "password1", display_name: "Nour" }),
      postAccounts({
        email: email.toUpperCase(),
        password: "password2",
        display_name: "Hana",
      }),
    ]);
    const statuses = [left.status, right.status].sort();
    expect(statuses).toEqual([201, 409]);
    const failure = left.status === 409 ? left : right;
    expect(sessionSetCookie(failure)).toBeNull();
    expect(await failure.json()).toMatchObject({
      error: { code: "conflict", reason: "email_taken", fields: [] },
    });
    expect(await accountCount(email)).toBe(1);
  });
});
