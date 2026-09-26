import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { resetClock } from "@/server/clock";
import { generateId, generateJoinToken } from "@/server/ids";
import {
  POST as createAccount,
  closeDatabase as closeAccounts,
} from "../accounts/route";
import { POST as createPlan, closeDatabase as closePlans } from "../plans/route";
import { POST as sendInvite } from "../plans/[planId]/invitations/route";
import { GET, closeDatabase } from "./route";

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

async function wipePlan(planId: string): Promise<void> {
  await sql`DELETE FROM response_picks WHERE participant_id IN (SELECT id FROM participants WHERE plan_id = ${planId})`;
  await sql`DELETE FROM response_windows WHERE participant_id IN (SELECT id FROM participants WHERE plan_id = ${planId})`;
  await sql`DELETE FROM responses WHERE participant_id IN (SELECT id FROM participants WHERE plan_id = ${planId})`;
  await sql`DELETE FROM participants WHERE plan_id = ${planId}`;
  await sql`DELETE FROM invitations WHERE plan_id = ${planId}`;
  await sql`DELETE FROM link_session_plans WHERE plan_id = ${planId}`;
  await sql`DELETE FROM plan_options WHERE step_id IN (SELECT id FROM plan_steps WHERE plan_id = ${planId})`;
  await sql`DELETE FROM plan_steps WHERE plan_id = ${planId}`;
  await sql`DELETE FROM plan_windows WHERE plan_id = ${planId}`;
  await sql`DELETE FROM plans WHERE id = ${planId}`;
}

async function forget(email: string): Promise<void> {
  const accountsRows = await sql<{ id: string }[]>`
    SELECT id FROM accounts WHERE email = ${email}
  `;
  for (const account of accountsRows) {
    const planRows = await sql<{ id: string }[]>`
      SELECT id FROM plans WHERE organizer_account_id = ${account.id}
    `;
    for (const plan of planRows) {
      await wipePlan(plan.id);
    }
    await sql`DELETE FROM invitations WHERE account_id = ${account.id}`;
    await sql`DELETE FROM participants WHERE account_id = ${account.id}`;
    await sql`DELETE FROM sessions WHERE account_id = ${account.id}`;
    await sql`DELETE FROM accounts WHERE id = ${account.id}`;
  }
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
  await closePlans();
  await closeAccounts();
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
  return (
    setCookieLines(response).find((line) => line.startsWith("hp_session=")) ??
    null
  );
}

function cookieValue(line: string, name: string): string {
  const pair = line.split(";", 1)[0] ?? "";
  return decodeURIComponent(pair.slice(`${name}=`.length));
}

function validPlan(overrides: Record<string, unknown> = {}) {
  return {
    title: "Thursday in Maadi",
    timezone: "Africa/Cairo",
    windows: [
      { local_date: "2026-10-02", start_local: "18:00", end_local: "23:00" },
    ],
    budget: { amount_minor: 50_000, currency: "EGP" },
    steps: [{ name: "Dinner", options: ["Koshary", "Grills"] }],
    threshold: 3,
    ...overrides,
  };
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

async function register(email: string, displayName = "Nour") {
  const response = await createAccount(
    jsonRequest("/v1/accounts", "POST", {
      email,
      password: "password1",
      display_name: displayName,
    }),
  );
  expect(response.status).toBe(201);
  const body = (await response.json()) as {
    account: { id: string; email: string; display_name: string };
  };
  const line = sessionSetCookie(response);
  expect(line).not.toBeNull();
  return { account: body.account, token: cookieValue(line!, "hp_session") };
}

async function openPlan(sessionToken: string, overrides: Record<string, unknown> = {}) {
  const response = await createPlan(
    jsonRequest("/v1/plans", "POST", validPlan(overrides), {
      cookie: `hp_session=${sessionToken}`,
    }),
  );
  expect(response.status).toBe(201);
  return (await response.json()) as {
    id: string;
    title: string;
    join_path: string;
    answered_count: number;
  };
}

function invitePost(
  planId: string,
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
  return sendInvite(
    new Request(`http://localhost/v1/plans/${planId}/invitations`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ planId }) },
  );
}

function inboxRequest(cookie?: string) {
  const headers: Record<string, string> = {};
  if (cookie) {
    headers.cookie = cookie;
  }
  return GET(new Request("http://localhost/v1/invitations", { headers }));
}

type InboxRow = {
  plan_id: string;
  title: string;
  organizer_display_name: string;
};

type InboxBody = {
  invitations: InboxRow[];
  truncated: boolean;
};

async function invitationCountFor(accountId: string): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM invitations WHERE account_id = ${accountId}
  `;
  return Number(rows[0]?.count ?? 0);
}

describe("GET /v1/invitations", () => {
  it("returns this account's invitations, created_at descending, at most 100, one row per plan with plan_id, title, and organizer_display_name", async () => {
    const orgEmail = track(uniqueEmail("org"));
    const otherOrgEmail = track(uniqueEmail("org2"));
    const hanaEmail = track(uniqueEmail("hana"));
    const organizer = await register(orgEmail, "Omar");
    const otherOrg = await register(otherOrgEmail, "Ziad");
    const hana = await register(hanaEmail, "Hana");
    const older = await openPlan(organizer.token, { title: "Thursday in Maadi" });
    const newer = await openPlan(otherOrg.token, { title: "Friday in Zamalek" });

    const first = await invitePost(
      older.id,
      { email: hanaEmail },
      { cookie: `hp_session=${organizer.token}` },
    );
    expect(first.status).toBe(200);
    const second = await invitePost(
      newer.id,
      { email: hanaEmail },
      { cookie: `hp_session=${otherOrg.token}` },
    );
    expect(second.status).toBe(200);

    await sql`
      UPDATE invitations SET created_at = ${new Date("2026-01-01T00:00:00.000Z")}
      WHERE plan_id = ${older.id} AND account_id = ${hana.account.id}
    `;
    await sql`
      UPDATE invitations SET created_at = ${new Date("2026-01-02T00:00:00.000Z")}
      WHERE plan_id = ${newer.id} AND account_id = ${hana.account.id}
    `;

    await sql`
      INSERT INTO participants (
        id, plan_id, account_id, guest_session_id, display_name, distinguisher
      ) VALUES (
        ${generateId("prt_")}, ${older.id}, ${otherOrg.account.id}, NULL, 'Nour', 'a3k9'
      )
    `;

    const response = await inboxRequest(`hp_session=${hana.token}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as InboxBody;
    expect(body.truncated).toBe(false);
    expect(body.invitations).toEqual([
      {
        plan_id: newer.id,
        title: "Friday in Zamalek",
        organizer_display_name: "Ziad",
      },
      {
        plan_id: older.id,
        title: "Thursday in Maadi",
        organizer_display_name: "Omar",
      },
    ]);
    expect(Object.keys(body)).toEqual(["invitations", "truncated"]);
    expect(Object.keys(body.invitations[0]!).sort()).toEqual(
      ["organizer_display_name", "plan_id", "title"].sort(),
    );
    expect(JSON.stringify(body)).not.toContain(hanaEmail);
    expect(JSON.stringify(body)).not.toContain("Nour");
    expect(JSON.stringify(body)).not.toContain("Koshary");
    expect(body.invitations).toHaveLength(2);
  });

  it("a second invite of the same account to the same plan does not add a second row", async () => {
    const orgEmail = track(uniqueEmail("org"));
    const hanaEmail = track(uniqueEmail("hana"));
    const organizer = await register(orgEmail, "Omar");
    const hana = await register(hanaEmail, "Hana");
    const plan = await openPlan(organizer.token);

    const first = await invitePost(
      plan.id,
      { email: hanaEmail },
      { cookie: `hp_session=${organizer.token}` },
    );
    expect(first.status).toBe(200);
    expect(await invitationCountFor(hana.account.id)).toBe(1);

    const again = await invitePost(
      plan.id,
      { email: ` ${hanaEmail.toUpperCase()} ` },
      { cookie: `hp_session=${organizer.token}` },
    );
    expect(again.status).toBe(200);
    expect(await invitationCountFor(hana.account.id)).toBe(1);

    const response = await inboxRequest(`hp_session=${hana.token}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as InboxBody;
    expect(body).toEqual({
      invitations: [
        {
          plan_id: plan.id,
          title: "Thursday in Maadi",
          organizer_display_name: "Omar",
        },
      ],
      truncated: false,
    });
  });

  it("empty is invitations [] and truncated false, and another account's invitation is absent", async () => {
    const orgEmail = track(uniqueEmail("org"));
    const hanaEmail = track(uniqueEmail("hana"));
    const emptyEmail = track(uniqueEmail("empty"));
    const organizer = await register(orgEmail, "Omar");
    await register(hanaEmail, "Hana");
    const empty = await register(emptyEmail, "Sam");
    const plan = await openPlan(organizer.token);

    const invited = await invitePost(
      plan.id,
      { email: hanaEmail },
      { cookie: `hp_session=${organizer.token}` },
    );
    expect(invited.status).toBe(200);

    const response = await inboxRequest(`hp_session=${empty.token}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as InboxBody;
    expect(body).toEqual({ invitations: [], truncated: false });
    expect(body.invitations.find((row) => row.plan_id === plan.id)).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(plan.id);
    expect(JSON.stringify(body)).not.toContain("Thursday");
  });

  it("no account session returns 401 missing_session", async () => {
    const orgEmail = track(uniqueEmail("org"));
    const hanaEmail = track(uniqueEmail("hana"));
    const organizer = await register(orgEmail, "Omar");
    await register(hanaEmail, "Hana");
    const plan = await openPlan(organizer.token);
    await invitePost(
      plan.id,
      { email: hanaEmail },
      { cookie: `hp_session=${organizer.token}` },
    );

    const cases = [
      inboxRequest(),
      inboxRequest("hp_guest=guest-only"),
      inboxRequest("hp_session=not-a-session"),
      inboxRequest("hp_guest=guest-only; hp_session="),
    ];

    for (const pending of cases) {
      const response = await pending;
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

  it("a failed read does not include another plan's people or places", async () => {
    const orgEmail = track(uniqueEmail("org"));
    const hanaEmail = track(uniqueEmail("hana"));
    const organizer = await register(orgEmail, "Omar");
    const hana = await register(hanaEmail, "Hana");
    const plan = await openPlan(organizer.token, { title: "Thursday in Maadi" });
    await invitePost(
      plan.id,
      { email: hanaEmail },
      { cookie: `hp_session=${organizer.token}` },
    );
    await sql`
      INSERT INTO participants (
        id, plan_id, account_id, guest_session_id, display_name, distinguisher
      ) VALUES (
        ${generateId("prt_")}, ${plan.id}, ${hana.account.id}, NULL, 'Nour', 'a3k9'
      )
    `;

    const response = await inboxRequest();
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
    const leaked = JSON.stringify(body);
    expect(leaked).not.toContain(plan.id);
    expect(leaked).not.toContain("Thursday");
    expect(leaked).not.toContain("Nour");
    expect(leaked).not.toContain("Koshary");
    expect(leaked).not.toContain("Grills");
    expect(leaked).not.toContain(hanaEmail);
    expect(leaked).not.toContain(organizer.account.id);
  });

  it("caps the inbox at 100 and sets truncated when more exist", async () => {
    const orgEmail = track(uniqueEmail("cap-org"));
    const hanaEmail = track(uniqueEmail("cap-hana"));
    const organizer = await register(orgEmail, "Omar");
    const hana = await register(hanaEmail, "Hana");
    const rows = [];
    for (let index = 0; index < 101; index += 1) {
      rows.push({
        id: generateId("pln_"),
        title: `Plan ${index}`,
        join_token: generateJoinToken(),
        created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
      });
    }
    for (const row of rows) {
      await sql`
        INSERT INTO plans (
          id, organizer_account_id, title, timezone, budget_amount_minor,
          currency, threshold, answered_count, state, join_token
        ) VALUES (
          ${row.id}, ${organizer.account.id}, ${row.title}, ${"Africa/Cairo"},
          ${50_000}, ${"EGP"}, ${3}, ${0}, ${"collecting"}, ${row.join_token}
        )
      `;
      await sql`
        INSERT INTO invitations (id, plan_id, account_id, distinguisher, created_at)
        VALUES (
          ${generateId("inv_")}, ${row.id}, ${hana.account.id}, ${"a3k9"},
          ${row.created_at}
        )
      `;
    }

    const response = await inboxRequest(`hp_session=${hana.token}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as InboxBody;
    expect(body.truncated).toBe(true);
    expect(body.invitations).toHaveLength(100);
    expect(body.invitations[0]).toEqual({
      plan_id: rows[100]!.id,
      title: "Plan 100",
      organizer_display_name: "Omar",
    });
    expect(body.invitations[99]?.title).toBe("Plan 1");
    expect(body.invitations.find((row) => row.title === "Plan 0")).toBeUndefined();
  });
});
