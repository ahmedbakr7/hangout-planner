/**
 * T-001-29 — authz e2e
 * Covers: second account cannot read another organizer's plan;
 * participant cannot lock; locked write fails;
 * unknown invite email adds no inbox row.
 */
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import postgres from "postgres";
import { resetClock } from "@/server/clock";
import { generateId } from "@/server/ids";
import { closeDatabase as closeAttempt } from "@/server/proposal/attempt";
import {
  POST as createAccount,
  closeDatabase as closeAccounts,
} from "@/app/api/v1/accounts/route";
import {
  POST as createPlan,
  closeDatabase as closePlans,
} from "@/app/api/v1/plans/route";
import {
  GET as getPlan,
  PATCH as patchPlan,
} from "@/app/api/v1/plans/[planId]/route";
import { POST as lockPost } from "@/app/api/v1/plans/[planId]/lock/route";
import { POST as invitePost } from "@/app/api/v1/plans/[planId]/invitations/route";
import {
  GET as inboxGet,
  closeDatabase as closeInbox,
} from "@/app/api/v1/invitations/route";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const migrationPath = resolve(process.cwd(), "drizzle/0001_init.sql");
const LOCK_KEY = 60130;

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
  const guestRows = await sql<{ id: string }[]>`
    SELECT DISTINCT guest_session_id AS id
    FROM participants
    WHERE plan_id = ${planId} AND guest_session_id IS NOT NULL
  `;
  await sql`DELETE FROM step_signals WHERE proposal_id IN (SELECT id FROM proposals WHERE plan_id = ${planId})`;
  await sql`DELETE FROM proposal_alternatives WHERE proposal_id IN (SELECT id FROM proposals WHERE plan_id = ${planId})`;
  await sql`DELETE FROM proposal_candidates WHERE proposal_id IN (SELECT id FROM proposals WHERE plan_id = ${planId})`;
  await sql`DELETE FROM proposal_legs WHERE proposal_id IN (SELECT id FROM proposals WHERE plan_id = ${planId})`;
  await sql`DELETE FROM proposal_steps WHERE proposal_id IN (SELECT id FROM proposals WHERE plan_id = ${planId})`;
  await sql`DELETE FROM proposal_cohort WHERE proposal_id IN (SELECT id FROM proposals WHERE plan_id = ${planId})`;
  await sql`DELETE FROM proposals WHERE plan_id = ${planId}`;
  await sql`DELETE FROM proposal_runs WHERE plan_id = ${planId}`;
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
  for (const row of guestRows) {
    await sql`DELETE FROM guest_sessions WHERE id = ${row.id}`;
  }
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

function setCookieLines(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function cookieValue(response: Response, name: string): string {
  const line =
    setCookieLines(response).find((entry) => entry.startsWith(`${name}=`)) ?? "";
  const pair = line.split(";", 1)[0] ?? "";
  return decodeURIComponent(pair.slice(`${name}=`.length));
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
    body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(body),
  });
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

async function register(email: string, displayName = "Omar") {
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
  return { account: body.account, token: cookieValue(response, "hp_session") };
}

async function openPlan(sessionToken: string, overrides: Record<string, unknown> = {}) {
  const response = await createPlan(
    jsonRequest("/v1/plans", "POST", validPlan(overrides), {
      cookie: `hp_session=${sessionToken}`,
    }),
  );
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; title: string };
}

async function seedAccountParticipant(
  planId: string,
  accountId: string,
  displayName: string,
  distinguisher = "a3k9",
): Promise<string> {
  const participantId = generateId("prt_");
  await sql`
    INSERT INTO participants (
      id, plan_id, account_id, guest_session_id, display_name, distinguisher
    ) VALUES (
      ${participantId}, ${planId}, ${accountId}, NULL, ${displayName}, ${distinguisher}
    )
  `;
  return participantId;
}

async function seedProposedWithCohort(planId: string, nourId: string): Promise<void> {
  const dinner = await sql<{ id: string }[]>`
    SELECT id FROM plan_steps WHERE plan_id = ${planId} ORDER BY position LIMIT 1
  `;
  const dinnerId = dinner[0]!.id;
  const option = await sql<{ id: string }[]>`
    SELECT id FROM plan_options WHERE step_id = ${dinnerId} ORDER BY position LIMIT 1
  `;
  const proposalId = `prp_${randomBytes(16).toString("hex")}`;
  await sql`
    INSERT INTO proposals (id, plan_id, local_date, local_time, fairness_warning)
    VALUES (${proposalId}, ${planId}, '2026-10-02', '18:30', false)
  `;
  await sql`
    INSERT INTO proposal_cohort (proposal_id, participant_id, attending)
    VALUES (${proposalId}, ${nourId}, true)
  `;
  await sql`
    INSERT INTO proposal_steps (
      proposal_id, step_id, option_id, google_place_id, place_name, amount_minor
    ) VALUES (
      ${proposalId}, ${dinnerId}, ${option[0]!.id}, 'ChIJ-dinner-a', 'Abu Tarek', 12000
    )
  `;
  await sql`
    UPDATE plans SET state = 'proposed', answered_count = 1 WHERE id = ${planId}
  `;
}

beforeAll(async () => {
  await sql`SELECT pg_advisory_lock(${LOCK_KEY})`;
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
    await sql`SELECT pg_advisory_unlock(${LOCK_KEY})`;
  }
});

beforeEach(() => {
  process.env.HP_HASH_TEST = "1";
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    throw new Error(`e2e must not call the network: ${String(input)}`);
  });
});

afterEach(async () => {
  resetClock();
  delete process.env.HP_HASH_TEST;
  vi.unstubAllGlobals();
  const emails = createdEmails.splice(0, createdEmails.length);
  for (const email of emails) {
    await forget(email);
  }
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
  await closeAttempt();
  await closeInbox();
  await closePlans();
  await closeAccounts();
});

describe("e2e authz", () => {
  it("a second account cannot read another organizer's plan", async () => {
    const organizer = await register(track(uniqueEmail("org")), "Omar");
    const stranger = await register(track(uniqueEmail("stranger")), "Samy");
    const plan = await openPlan(organizer.token);

    const asStranger = await getPlan(
      new Request(`http://localhost/v1/plans/${plan.id}`, {
        headers: { cookie: `hp_session=${stranger.token}` },
      }),
      { params: Promise.resolve({ planId: plan.id }) },
    );
    expect(asStranger.status).toBe(404);
    const body = await asStranger.json();
    expect(body).toEqual({
      error: {
        code: "not_found",
        message: "plan not found",
        fields: [],
      },
    });
    expect(Object.keys(body)).toEqual(["error"]);
    expect(JSON.stringify(body)).not.toContain("Thursday");
    expect(JSON.stringify(body)).not.toContain(plan.id);
    expect(JSON.stringify(body)).not.toContain("Omar");
  });

  it("a participant cannot lock", async () => {
    const organizer = await register(track(uniqueEmail("org")), "Omar");
    const member = await register(track(uniqueEmail("member")), "Nour");
    const plan = await openPlan(organizer.token);
    const nourId = await seedAccountParticipant(
      plan.id,
      member.account.id,
      "Nour",
    );
    await seedProposedWithCohort(plan.id, nourId);

    const asParticipant = await lockPost(
      jsonRequest(`/v1/plans/${plan.id}/lock`, "POST", {}, {
        cookie: `hp_session=${member.token}`,
      }),
      { params: Promise.resolve({ planId: plan.id }) },
    );
    expect(asParticipant.status).toBe(403);
    expect(await asParticipant.json()).toEqual({
      error: {
        code: "forbidden",
        reason: "organizer_only",
        message: "organizer only",
        fields: [],
      },
    });
    const state = await sql<{ state: string }[]>`
      SELECT state FROM plans WHERE id = ${plan.id}
    `;
    expect(state[0]?.state).toBe("proposed");
  });

  it("a locked write fails", async () => {
    const organizer = await register(track(uniqueEmail("org")), "Omar");
    const plan = await openPlan(organizer.token);
    await sql`
      UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${plan.id}
    `;

    const patched = await patchPlan(
      jsonRequest(
        `/v1/plans/${plan.id}`,
        "PATCH",
        { title: "Hijacked title" },
        { cookie: `hp_session=${organizer.token}` },
      ),
      { params: Promise.resolve({ planId: plan.id }) },
    );
    expect(patched.status).toBe(409);
    expect(await patched.json()).toMatchObject({
      error: { code: "conflict", reason: "plan_locked", fields: [] },
    });
    const stored = await sql<{ title: string; state: string }[]>`
      SELECT title, state FROM plans WHERE id = ${plan.id}
    `;
    expect(stored[0]).toEqual({ title: "Thursday in Maadi", state: "locked" });
  });

  it("an unknown invite email adds no inbox row", async () => {
    const organizer = await register(track(uniqueEmail("org")), "Omar");
    const plan = await openPlan(organizer.token);
    const unknownEmail = `nobody.${randomBytes(6).toString("hex")}@example.com`;

    const beforeInvites = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM invitations WHERE plan_id = ${plan.id}
    `;
    expect(Number(beforeInvites[0]?.count ?? 0)).toBe(0);

    const invite = await invitePost(
      jsonRequest(
        `/v1/plans/${plan.id}/invitations`,
        "POST",
        { email: unknownEmail },
        { cookie: `hp_session=${organizer.token}` },
      ),
      { params: Promise.resolve({ planId: plan.id }) },
    );
    expect(invite.status).toBe(404);
    expect(await invite.json()).toMatchObject({
      error: { code: "not_found", reason: "account_not_found", fields: [] },
    });

    const afterInvites = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM invitations WHERE plan_id = ${plan.id}
    `;
    expect(Number(afterInvites[0]?.count ?? 0)).toBe(0);

    // No account exists for the unknown email, so no inbox could gain a row.
    const accounts = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM accounts WHERE email = ${unknownEmail}
    `;
    expect(Number(accounts[0]?.count ?? 0)).toBe(0);

    const inbox = await inboxGet(
      new Request("http://localhost/v1/invitations", {
        headers: { cookie: `hp_session=${organizer.token}` },
      }),
    );
    expect(inbox.status).toBe(200);
    const inboxBody = (await inbox.json()) as {
      invitations: { plan_id: string }[];
    };
    expect(
      inboxBody.invitations.filter((row) => row.plan_id === plan.id),
    ).toEqual([]);
  });
});
