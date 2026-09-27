import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { resetClock } from "@/server/clock";
import {
  generateDistinguisher,
  generateId,
  isDistinguisher,
  isId,
} from "@/server/ids";
import { PARTICIPANT_CAP } from "@/server/join/open";
import { POST as createAccount } from "../../../accounts/route";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { POST as createPlan } from "../../route";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { POST } from "./route";

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
const extraGuestIds: string[] = [];

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
  const guests = extraGuestIds.splice(0, extraGuestIds.length);
  for (const id of guests) {
    await sql`DELETE FROM participants WHERE guest_session_id = ${id}`;
    await sql`DELETE FROM guest_sessions WHERE id = ${id}`;
  }
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
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

function cookieLine(response: Response, name: string): string | null {
  return setCookieLines(response).find((line) => line.startsWith(`${name}=`)) ?? null;
}

function sessionSetCookie(response: Response): string | null {
  return cookieLine(response, "hp_session");
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
  };
}

function joinPost(
  planId: string,
  body: unknown,
  init?: { csrf?: boolean; cookie?: string; raw?: string },
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
  return POST(
    new Request(`http://localhost/v1/plans/${planId}/join`, {
      method: "POST",
      headers,
      body: init?.raw ?? JSON.stringify(body),
    }),
    { params: Promise.resolve({ planId }) },
  );
}

async function participantCount(planId: string): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM participants WHERE plan_id = ${planId}
  `;
  return Number(rows[0]?.count ?? 0);
}

async function invite(planId: string, accountId: string, distinguisher = "k7m2") {
  await sql`
    INSERT INTO invitations (id, plan_id, account_id, distinguisher)
    VALUES (${generateId("inv_")}, ${planId}, ${accountId}, ${distinguisher})
  `;
}

type JoinBody = {
  participant: { id: string; display_name: string; distinguisher: string };
  next: string;
  join_path?: string;
};

describe("POST /v1/plans/{planId}/join", () => {
  it("accepts kind account only, uses the account display name, and does not return the join token", async () => {
    const orgEmail = track(uniqueEmail("org"));
    const invitedEmail = track(uniqueEmail("inv"));
    const organizer = await register(orgEmail, "Omar");
    const invited = await register(invitedEmail, "Nour El");
    const plan = await openPlan(organizer.token);
    await invite(plan.id, invited.account.id, "a3k9");

    const missingSession = await joinPost(plan.id, { kind: "account" });
    expect(missingSession.status).toBe(401);
    expect(await missingSession.json()).toEqual({
      error: {
        code: "unauthenticated",
        reason: "missing_session",
        message: "missing session",
        fields: [],
      },
    });
    expect(await participantCount(plan.id)).toBe(0);

    const anonymous = await joinPost(
      plan.id,
      { kind: "anonymous", display_name: "Nour" },
      { cookie: `hp_session=${invited.token}` },
    );
    expect(anonymous.status).toBe(400);
    expect(await anonymous.json()).toMatchObject({
      error: {
        code: "validation_failed",
        fields: [{ path: "kind", code: "not_one" }],
      },
    });
    expect(await participantCount(plan.id)).toBe(0);

    const missingKind = await joinPost(
      plan.id,
      {},
      { cookie: `hp_session=${invited.token}` },
    );
    expect(missingKind.status).toBe(400);
    expect(await missingKind.json()).toMatchObject({
      error: {
        fields: [{ path: "kind", code: "required" }],
      },
    });

    const created = await joinPost(
      plan.id,
      { kind: "account", display_name: "Ignored" },
      { cookie: `hp_session=${invited.token}` },
    );
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as JoinBody;
    expect(Object.keys(createdBody).sort()).toEqual(["next", "participant"].sort());
    expect(Object.keys(createdBody.participant).sort()).toEqual(
      ["display_name", "distinguisher", "id"].sort(),
    );
    expect(isId(createdBody.participant.id, "prt_")).toBe(true);
    expect(createdBody.participant.display_name).toBe("Nour El");
    expect(createdBody.participant.distinguisher).toBe("a3k9");
    expect(isDistinguisher(createdBody.participant.distinguisher)).toBe(true);
    expect(createdBody.next).toBe("respond");
    expect(createdBody).not.toHaveProperty("join_path");
    expect(createdBody).not.toHaveProperty("join_token");
    const json = JSON.stringify(createdBody);
    expect(json).not.toContain(plan.join_path);
    expect(json).not.toContain("jt_");
    expect(cookieLine(created, "hp_guest")).toBeNull();
    expect(cookieLine(created, "hp_link")).toBeNull();
    expect(await participantCount(plan.id)).toBe(1);
  });

  it("an invited account who is not yet a participant gets 201; an account that is already a participant gets 200 and that same participant", async () => {
    const orgEmail = track(uniqueEmail("host"));
    const invitedEmail = track(uniqueEmail("member"));
    const organizer = await register(orgEmail, "Omar");
    const invited = await register(invitedEmail, "Nour");
    const plan = await openPlan(organizer.token);
    await invite(plan.id, invited.account.id, "k7m2");

    const created = await joinPost(
      plan.id,
      { kind: "account" },
      { cookie: `hp_session=${invited.token}` },
    );
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as JoinBody;
    expect(createdBody.participant.display_name).toBe("Nour");
    expect(createdBody.participant.distinguisher).toBe("k7m2");
    expect(createdBody.next).toBe("respond");
    expect(await participantCount(plan.id)).toBe(1);

    const again = await joinPost(
      plan.id,
      { kind: "account" },
      { cookie: `hp_session=${invited.token}` },
    );
    expect(again.status).toBe(200);
    const againBody = (await again.json()) as JoinBody;
    expect(againBody.participant).toEqual(createdBody.participant);
    expect(againBody.next).toBe("respond");
    expect(await participantCount(plan.id)).toBe(1);

    const stored = await sql<{ id: string; display_name: string }[]>`
      SELECT id, display_name FROM participants WHERE plan_id = ${plan.id}
    `;
    expect(stored).toEqual([
      { id: createdBody.participant.id, display_name: "Nour" },
    ]);

    const priorEmail = track(uniqueEmail("prior"));
    const prior = await register(priorEmail, "Ziad");
    const priorId = generateId("prt_");
    await sql`
      INSERT INTO participants (
        id, plan_id, account_id, guest_session_id, display_name, distinguisher
      ) VALUES (
        ${priorId}, ${plan.id}, ${prior.account.id}, NULL, 'Ziad', 'm2n4'
      )
    `;
    const existing = await joinPost(
      plan.id,
      { kind: "account" },
      { cookie: `hp_session=${prior.token}` },
    );
    expect(existing.status).toBe(200);
    const existingBody = (await existing.json()) as JoinBody;
    expect(existingBody.participant).toEqual({
      id: priorId,
      display_name: "Ziad",
      distinguisher: "m2n4",
    });
    expect(await participantCount(plan.id)).toBe(2);
  });

  it("locked, organizer, and full use the same 409s as token join and create no participant", async () => {
    const orgEmail = track(uniqueEmail("lock"));
    const invitedEmail = track(uniqueEmail("full"));
    const organizer = await register(orgEmail, "Omar");
    const invited = await register(invitedEmail, "Nour");
    const plan = await openPlan(organizer.token);
    await invite(plan.id, invited.account.id);

    const asOrganizer = await joinPost(
      plan.id,
      { kind: "account" },
      { cookie: `hp_session=${organizer.token}` },
    );
    expect(asOrganizer.status).toBe(409);
    expect(await asOrganizer.json()).toMatchObject({
      error: { code: "conflict", reason: "organizer_cannot_join", fields: [] },
    });
    expect(await participantCount(plan.id)).toBe(0);

    await sql`UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${plan.id}`;
    const locked = await joinPost(
      plan.id,
      { kind: "account" },
      { cookie: `hp_session=${invited.token}` },
    );
    expect(locked.status).toBe(409);
    expect(await locked.json()).toMatchObject({
      error: { code: "conflict", reason: "plan_locked", fields: [] },
    });
    expect(await participantCount(plan.id)).toBe(0);

    await sql`UPDATE plans SET state = 'collecting', locked_at = NULL WHERE id = ${plan.id}`;
    const taken = new Set<string>(["k7m2"]);
    const expires = new Date("2027-01-01T00:00:00.000Z");
    for (let index = 0; index < PARTICIPANT_CAP; index += 1) {
      const guestId = `gst_${randomBytes(8).toString("hex")}`;
      extraGuestIds.push(guestId);
      let distinguisher = generateDistinguisher();
      while (taken.has(distinguisher)) {
        distinguisher = generateDistinguisher();
      }
      taken.add(distinguisher);
      await sql`
        INSERT INTO guest_sessions (id, token_hash, expires_at)
        VALUES (${guestId}, ${`hash-${guestId}`}, ${expires})
      `;
      await sql`
        INSERT INTO participants (
          id, plan_id, account_id, guest_session_id, display_name, distinguisher
        ) VALUES (
          ${generateId("prt_")}, ${plan.id}, NULL, ${guestId}, ${`P${index}`}, ${distinguisher}
        )
      `;
    }
    expect(await participantCount(plan.id)).toBe(PARTICIPANT_CAP);

    const full = await joinPost(
      plan.id,
      { kind: "account" },
      { cookie: `hp_session=${invited.token}` },
    );
    expect(full.status).toBe(409);
    expect(await full.json()).toMatchObject({
      error: { code: "conflict", reason: "plan_full", fields: [] },
    });
    expect(await participantCount(plan.id)).toBe(PARTICIPANT_CAP);
  });

  it("a stranger gets 404 with the envelope only; missing X-HP-Request: 1 on POST returns 403 csrf and writes nothing", async () => {
    const orgEmail = track(uniqueEmail("org"));
    const strangerEmail = track(uniqueEmail("stranger"));
    const invitedEmail = track(uniqueEmail("inv"));
    const organizer = await register(orgEmail, "Omar");
    const stranger = await register(strangerEmail, "Sam");
    const invited = await register(invitedEmail, "Hana");
    const plan = await openPlan(organizer.token);
    await invite(plan.id, invited.account.id);

    const csrf = await joinPost(
      plan.id,
      { kind: "account" },
      { csrf: false, cookie: `hp_session=${invited.token}` },
    );
    expect(csrf.status).toBe(403);
    expect(await csrf.json()).toEqual({
      error: {
        code: "forbidden",
        reason: "csrf",
        message: "missing X-HP-Request",
        fields: [],
      },
    });
    expect(await participantCount(plan.id)).toBe(0);

    const envelope = {
      error: {
        code: "not_found",
        message: "plan not found",
        fields: [],
      },
    };

    const asStranger = await joinPost(
      plan.id,
      { kind: "account" },
      { cookie: `hp_session=${stranger.token}` },
    );
    expect(asStranger.status).toBe(404);
    const strangerBody = await asStranger.json();
    expect(strangerBody).toEqual(envelope);
    expect(Object.keys(strangerBody)).toEqual(["error"]);
    expect(JSON.stringify(strangerBody)).not.toContain(plan.title);
    expect(JSON.stringify(strangerBody)).not.toContain("Omar");
    expect(JSON.stringify(strangerBody)).not.toContain(plan.id);
    expect(await participantCount(plan.id)).toBe(0);

    const unknown = await joinPost(
      generateId("pln_"),
      { kind: "account" },
      { cookie: `hp_session=${invited.token}` },
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual(envelope);
    expect(await participantCount(plan.id)).toBe(0);
  });
});
