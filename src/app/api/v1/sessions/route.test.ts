import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { verifyPassword } from "@/server/auth/password";
import { SESSION_MAX_AGE_SECONDS } from "@/server/auth/session";
import { resetClock } from "@/server/clock";
import { POST as createAccount } from "../accounts/route";
import { closeDatabase } from "@/server/auth/http";
import { GET } from "../me/route";
import { DELETE, POST } from "./route";

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

async function sessionCount(email: string): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count
    FROM sessions s
    JOIN accounts a ON a.id = s.account_id
    WHERE a.email = ${email}
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

function jsonRequest(
  path: string,
  method: string,
  body: unknown,
  init?: { csrf?: boolean; cookie?: string },
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (init?.csrf !== false) {
    headers["x-hp-request"] = "1";
  }
  if (init?.cookie) {
    headers.cookie = init.cookie;
  }
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: JSON.stringify(body),
  });
}

async function register(email: string, password: string, displayName = "Nour") {
  const response = await createAccount(
    jsonRequest("/v1/accounts", "POST", {
      email,
      password,
      display_name: displayName,
    }),
  );
  expect(response.status).toBe(201);
  const body = (await response.json()) as {
    account: { id: string; email: string; display_name: string };
  };
  const line = sessionSetCookie(response);
  expect(line).not.toBeNull();
  return { body, token: cookieValue(line!) };
}

describe("POST /v1/sessions", () => {
  it("returns 200 with the same account object and sets hp_session", async () => {
    const email = track(uniqueEmail("sign"));
    const password = "  password1";
    const created = await register(email, password, "Nour El");

    const response = await POST(
      jsonRequest("/v1/sessions", "POST", {
        email: ` ${email.toUpperCase()} `,
        password,
        display_name: "",
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      account: { id: string; email: string; display_name: string };
    };
    expect(body).toEqual({ account: created.body.account });
    const line = sessionSetCookie(response);
    expect(line).not.toBeNull();
    expect(line).toContain("HttpOnly");
    expect(line).toContain("SameSite=lax");
    expect(line).toContain("Path=/");
    expect(line).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`);
    expect(line).not.toContain("Secure");
    const token = cookieValue(line!);
    expect(token).not.toBe(created.token);
    expect(await sessionCount(email)).toBe(2);

    const me = await GET(
      new Request("http://localhost/v1/me", {
        headers: { cookie: `hp_session=${token}` },
      }),
    );
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ account: created.body.account });

    const stored = await sql<{ password_hash: string }[]>`
      SELECT password_hash FROM accounts WHERE email = ${email}
    `;
    expect(await verifyPassword(stored[0]!.password_hash, password)).toBe(true);
    expect(await verifyPassword(stored[0]!.password_hash, password.trim())).toBe(false);
  });

  it("returns the same 401 bad_credentials envelope for an unknown email and a wrong password", async () => {
    const email = track(uniqueEmail("known"));
    const password = "password1";
    await register(email, password);
    const before = await sessionCount(email);

    const unknown = await POST(
      jsonRequest("/v1/sessions", "POST", {
        email: track(uniqueEmail("missing")),
        password: "password1",
      }),
    );
    const wrong = await POST(
      jsonRequest("/v1/sessions", "POST", {
        email: ` ${email.toUpperCase()} `,
        password: "password2",
      }),
    );

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(sessionSetCookie(unknown)).toBeNull();
    expect(sessionSetCookie(wrong)).toBeNull();
    const unknownBody = await unknown.json();
    const wrongBody = await wrong.json();
    expect(unknownBody).toEqual(wrongBody);
    expect(unknownBody).toEqual({
      error: {
        code: "unauthenticated",
        reason: "bad_credentials",
        message: "sign-in rejected",
        fields: [],
      },
    });
    expect(JSON.stringify(unknownBody)).not.toContain(email);
    expect(JSON.stringify(wrongBody)).not.toContain(email);
    expect(await sessionCount(email)).toBe(before);
    expect(await accountCount(email)).toBe(1);
  });

  it("returns 400 for invalid sign-in fields and sets no cookie", async () => {
    const email = track(uniqueEmail("invalid"));
    await register(email, "password1");
    const before = await sessionCount(email);

    const missing = await POST(jsonRequest("/v1/sessions", "POST", {}));
    expect(missing.status).toBe(400);
    expect(sessionSetCookie(missing)).toBeNull();
    expect(await missing.json()).toEqual({
      error: {
        code: "validation_failed",
        message: "invalid fields",
        fields: [
          { path: "email", code: "required" },
          { path: "password", code: "required" },
        ],
      },
    });

    const badEmail = await POST(
      jsonRequest("/v1/sessions", "POST", {
        email: "not-an-email",
        password: "password1",
      }),
    );
    expect(badEmail.status).toBe(400);
    expect(await badEmail.json()).toEqual({
      error: {
        code: "validation_failed",
        message: "email is not an email",
        fields: [{ path: "email", code: "bad_email" }],
      },
    });

    const short = await POST(
      jsonRequest("/v1/sessions", "POST", {
        email,
        password: "short",
      }),
    );
    expect(short.status).toBe(400);
    expect(sessionSetCookie(short)).toBeNull();
    expect(await short.json()).toEqual({
      error: {
        code: "validation_failed",
        message: "password is below the minimum length",
        fields: [{ path: "password", code: "below_min" }],
      },
    });
    expect(await sessionCount(email)).toBe(before);
  });

  it("returns 403 csrf and writes nothing without X-HP-Request", async () => {
    const email = track(uniqueEmail("csrf"));
    const created = await register(email, "password1");
    const before = await sessionCount(email);

    const response = await POST(
      jsonRequest(
        "/v1/sessions",
        "POST",
        { email, password: "password1" },
        { csrf: false },
      ),
    );
    expect(response.status).toBe(403);
    expect(sessionSetCookie(response)).toBeNull();
    expect(await response.json()).toEqual({
      error: {
        code: "forbidden",
        reason: "csrf",
        message: "missing X-HP-Request",
        fields: [],
      },
    });
    expect(await sessionCount(email)).toBe(before);

    const me = await GET(
      new Request("http://localhost/v1/me", {
        headers: { cookie: `hp_session=${created.token}` },
      }),
    );
    expect(me.status).toBe(200);
  });
});

describe("DELETE /v1/sessions", () => {
  it("returns 204, clears hp_session, and is idempotent when already signed out", async () => {
    const email = track(uniqueEmail("out"));
    const created = await register(email, "password1");

    const signedOut = await DELETE(
      new Request("http://localhost/v1/sessions", {
        method: "DELETE",
        headers: {
          "x-hp-request": "1",
          cookie: `hp_session=${created.token}; hp_guest=guest-token`,
        },
      }),
    );
    expect(signedOut.status).toBe(204);
    expect(await signedOut.text()).toBe("");
    const cleared = sessionSetCookie(signedOut);
    expect(cleared).not.toBeNull();
    expect(cookieValue(cleared!)).toBe("");
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("HttpOnly");
    expect(cleared).toContain("Path=/");
    expect(cleared).toContain("SameSite=lax");
    expect(setCookieLines(signedOut).some((line) => line.startsWith("hp_guest="))).toBe(false);
    expect(await sessionCount(email)).toBe(0);

    const me = await GET(
      new Request("http://localhost/v1/me", {
        headers: { cookie: `hp_session=${created.token}` },
      }),
    );
    expect(me.status).toBe(401);
    expect(await me.json()).toEqual({
      error: {
        code: "unauthenticated",
        reason: "missing_session",
        message: "missing session",
        fields: [],
      },
    });

    const again = await DELETE(
      new Request("http://localhost/v1/sessions", {
        method: "DELETE",
        headers: {
          "x-hp-request": "1",
          cookie: `hp_session=${created.token}`,
        },
      }),
    );
    expect(again.status).toBe(204);

    const guestOnly = await DELETE(
      new Request("http://localhost/v1/sessions", {
        method: "DELETE",
        headers: { "x-hp-request": "1", cookie: "hp_guest=guest-token" },
      }),
    );
    expect(guestOnly.status).toBe(204);
    expect(sessionSetCookie(guestOnly)).not.toBeNull();
  });

  it("returns 403 csrf and leaves the session in place", async () => {
    const email = track(uniqueEmail("keep"));
    const created = await register(email, "password1");

    const response = await DELETE(
      new Request("http://localhost/v1/sessions", {
        method: "DELETE",
        headers: { cookie: `hp_session=${created.token}` },
      }),
    );
    expect(response.status).toBe(403);
    expect(sessionSetCookie(response)).toBeNull();
    expect(await response.json()).toEqual({
      error: {
        code: "forbidden",
        reason: "csrf",
        message: "missing X-HP-Request",
        fields: [],
      },
    });
    expect(await sessionCount(email)).toBe(1);

    const me = await GET(
      new Request("http://localhost/v1/me", {
        headers: { cookie: `hp_session=${created.token}` },
      }),
    );
    expect(me.status).toBe(200);
    const body = (await me.json()) as { account: { email: string } };
    expect(body.account.email).toBe(email);
  });

  it("sets Secure on the cleared cookie only when HP_COOKIE_SECURE is 1", async () => {
    process.env.HP_COOKIE_SECURE = "1";
    const response = await DELETE(
      new Request("http://localhost/v1/sessions", {
        method: "DELETE",
        headers: { "x-hp-request": "1" },
      }),
    );
    expect(response.status).toBe(204);
    expect(sessionSetCookie(response)).toContain("Secure");
  });
});
