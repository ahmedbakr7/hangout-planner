import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  generateCookieToken,
  hashCookieToken,
} from "@/server/auth/session";
import { resetClock } from "@/server/clock";
import { generateId, isDistinguisher, isId } from "@/server/ids";
import {
  POST as createAccount,
  closeDatabase as closeAccounts,
} from "../../../accounts/route";
import { POST as createPlan, closeDatabase as closePlans } from "../../route";
import { GET as inviteGet } from "../invite/route";
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
const extraLinkIds: string[] = [];

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
  const linkRows = await sql<{ id: string }[]>`
    SELECT link_session_id AS id FROM link_session_plans WHERE plan_id = ${planId}
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
  for (const row of linkRows) {
    await sql`DELETE FROM link_sessions WHERE id = ${row.id}`;
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
  const links = extraLinkIds.splice(0, extraLinkIds.length);
  for (const id of links) {
    await sql`DELETE FROM link_session_plans WHERE link_session_id = ${id}`;
    await sql`DELETE FROM link_sessions WHERE id = ${id}`;
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
    new Request(`http://localhost/v1/plans/${planId}/invitations`, {
      method: "POST",
      headers,
      body: init?.raw ?? JSON.stringify(body),
    }),
    { params: Promise.resolve({ planId }) },
  );
}

async function invitationCount(planId: string): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM invitations WHERE plan_id = ${planId}
  `;
  return Number(rows[0]?.count ?? 0);
}

async function answeredCount(planId: string): Promise<number> {
  const rows = await sql<{ answered_count: number }[]>`
    SELECT answered_count FROM plans WHERE id = ${planId}
  `;
  return Number(rows[0]?.answered_count ?? 0);
}

async function seedLink(planId: string): Promise<{ token: string }> {
  const token = generateCookieToken();
  const linkId = `lnk_${randomBytes(8).toString("hex")}`;
  extraLinkIds.push(linkId);
  await sql`
    INSERT INTO link_sessions (id, token_hash, expires_at)
    VALUES (
      ${linkId},
      ${hashCookieToken(token)},
      ${new Date("2027-01-01T00:00:00.000Z")}
    )
  `;
  await sql`
    INSERT INTO link_session_plans (link_session_id, plan_id)
    VALUES (${linkId}, ${planId})
  `;
  return { token };
}

async function seedGuestParticipant(
  planId: string,
  displayName: string,
  distinguisher: string,
): Promise<{ token: string }> {
  const token = generateCookieToken();
  const guestId = `gst_${randomBytes(8).toString("hex")}`;
  extraGuestIds.push(guestId);
  await sql`
    INSERT INTO guest_sessions (id, token_hash, expires_at)
    VALUES (
      ${guestId},
      ${hashCookieToken(token)},
      ${new Date("2027-01-01T00:00:00.000Z")}
    )
  `;
  await sql`
    INSERT INTO participants (
      id, plan_id, account_id, guest_session_id, display_name, distinguisher
    ) VALUES (
      ${generateId("prt_")}, ${planId}, NULL, ${guestId}, ${displayName}, ${distinguisher}
    )
  `;
  return { token };
}

type SentRow = {
  display_name: string;
  distinguisher: string;
  status: string;
};

describe("POST /v1/plans/{planId}/invitations", () => {
  it("matches an existing account email after trim and lowercase, creates the invitation when missing, reuses the participant distinguisher when that account already joined, and does not change answered_count", async () => {
    const orgEmail = track(uniqueEmail("org"));
    const hanaEmail = track(uniqueEmail("hana"));
    const nourEmail = track(uniqueEmail("nour"));
    const organizer = await register(orgEmail, "Omar");
    const hana = await register(hanaEmail, "Hana");
    const nour = await register(nourEmail, "Nour");
    const plan = await openPlan(organizer.token);
    await sql`UPDATE plans SET answered_count = 1 WHERE id = ${plan.id}`;
    expect(await answeredCount(plan.id)).toBe(1);

    await sql`
      INSERT INTO participants (
        id, plan_id, account_id, guest_session_id, display_name, distinguisher
      ) VALUES (
        ${generateId("prt_")}, ${plan.id}, ${nour.account.id}, NULL, 'Nour', 'a3k9'
      )
    `;
    const nourParticipant = await sql<{ id: string }[]>`
      SELECT id FROM participants
      WHERE plan_id = ${plan.id} AND account_id = ${nour.account.id}
    `;
    await sql`
      INSERT INTO responses (
        participant_id, complete
      ) VALUES (
        ${nourParticipant[0]!.id}, true
      )
    `;

    const created = await invitePost(
      plan.id,
      { email: `  ${hanaEmail.toUpperCase()}  `, extra: true },
      { cookie: `hp_session=${organizer.token}` },
    );
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as SentRow;
    expect(Object.keys(createdBody).sort()).toEqual(
      ["display_name", "distinguisher", "status"].sort(),
    );
    expect(createdBody.display_name).toBe("Hana");
    expect(createdBody.status).toBe("invited");
    expect(isDistinguisher(createdBody.distinguisher)).toBe(true);
    expect(createdBody).not.toHaveProperty("email");
    expect(createdBody).not.toHaveProperty("join_path");
    expect(JSON.stringify(createdBody)).not.toContain(hanaEmail);
    expect(await invitationCount(plan.id)).toBe(1);
    expect(await answeredCount(plan.id)).toBe(1);

    const stored = await sql<{ id: string; distinguisher: string }[]>`
      SELECT id, distinguisher FROM invitations
      WHERE plan_id = ${plan.id} AND account_id = ${hana.account.id}
    `;
    expect(stored).toHaveLength(1);
    expect(isId(stored[0]!.id, "inv_")).toBe(true);
    expect(stored[0]!.distinguisher).toBe(createdBody.distinguisher);

    const reused = await invitePost(
      plan.id,
      { email: nourEmail },
      { cookie: `hp_session=${organizer.token}` },
    );
    expect(reused.status).toBe(200);
    expect(await reused.json()).toEqual({
      display_name: "Nour",
      distinguisher: "a3k9",
      status: "answered",
    });
    const nourInvite = await sql<{ distinguisher: string }[]>`
      SELECT distinguisher FROM invitations
      WHERE plan_id = ${plan.id} AND account_id = ${nour.account.id}
    `;
    expect(nourInvite).toEqual([{ distinguisher: "a3k9" }]);
    expect(await invitationCount(plan.id)).toBe(2);
    expect(await answeredCount(plan.id)).toBe(1);
  });

  it("unknown email returns 404 account_not_found and adds no row; an invalid email returns 400 and adds no row; the organizer email returns 409 cannot_invite_self and adds no row", async () => {
    const orgEmail = track(uniqueEmail("org"));
    const organizer = await register(orgEmail, "Omar");
    const plan = await openPlan(organizer.token);

    const unknown = await invitePost(
      plan.id,
      { email: uniqueEmail("missing") },
      { cookie: `hp_session=${organizer.token}` },
    );
    expect(unknown.status).toBe(404);
    const unknownBody = await unknown.json();
    expect(unknownBody).toEqual({
      error: {
        code: "not_found",
        reason: "account_not_found",
        message: "invite email is not registered",
        fields: [],
      },
    });
    expect(Object.keys(unknownBody)).toEqual(["error"]);
    expect(await invitationCount(plan.id)).toBe(0);

    const invalid = await invitePost(
      plan.id,
      { email: "not-an-email" },
      { cookie: `hp_session=${organizer.token}` },
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      error: {
        code: "validation_failed",
        fields: [{ path: "email", code: "bad_email" }],
      },
    });
    expect(await invitationCount(plan.id)).toBe(0);

    const missingEmail = await invitePost(
      plan.id,
      {},
      { cookie: `hp_session=${organizer.token}` },
    );
    expect(missingEmail.status).toBe(400);
    expect(await missingEmail.json()).toMatchObject({
      error: {
        fields: [{ path: "email", code: "required" }],
      },
    });
    expect(await invitationCount(plan.id)).toBe(0);

    const self = await invitePost(
      plan.id,
      { email: `  ${orgEmail.toUpperCase()}  ` },
      { cookie: `hp_session=${organizer.token}` },
    );
    expect(self.status).toBe(409);
    expect(await self.json()).toEqual({
      error: {
        code: "conflict",
        reason: "cannot_invite_self",
        message: "cannot invite the organizer",
        fields: [],
      },
    });
    expect(await invitationCount(plan.id)).toBe(0);
    expect(await answeredCount(plan.id)).toBe(0);
  });

  it("sending again does not add a second row", async () => {
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
    const firstBody = (await first.json()) as SentRow;
    expect(firstBody.status).toBe("invited");
    expect(await invitationCount(plan.id)).toBe(1);

    const second = await invitePost(
      plan.id,
      { email: ` ${hanaEmail.toUpperCase()} ` },
      { cookie: `hp_session=${organizer.token}` },
    );
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(firstBody);
    expect(await invitationCount(plan.id)).toBe(1);

    const list = await inviteGet(
      new Request(`http://localhost/v1/plans/${plan.id}/invite`, {
        headers: { cookie: `hp_session=${organizer.token}` },
      }),
      { params: Promise.resolve({ planId: plan.id }) },
    );
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      invitations: SentRow[];
      join_path: string;
    };
    expect(listBody.invitations).toEqual([firstBody]);
    expect(listBody.join_path).toBe(plan.join_path);

    const stored = await sql<{ account_id: string }[]>`
      SELECT account_id FROM invitations WHERE plan_id = ${plan.id}
    `;
    expect(stored).toEqual([{ account_id: hana.account.id }]);
  });

  it("locked returns 409 plan_locked and adds no row", async () => {
    const orgEmail = track(uniqueEmail("lock"));
    const hanaEmail = track(uniqueEmail("hana"));
    const organizer = await register(orgEmail, "Omar");
    await register(hanaEmail, "Hana");
    const plan = await openPlan(organizer.token);
    await sql`UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${plan.id}`;

    const locked = await invitePost(
      plan.id,
      { email: hanaEmail },
      { cookie: `hp_session=${organizer.token}` },
    );
    expect(locked.status).toBe(409);
    expect(await locked.json()).toEqual({
      error: {
        code: "conflict",
        reason: "plan_locked",
        message: "plan is locked",
        fields: [],
      },
    });
    expect(await invitationCount(plan.id)).toBe(0);
  });

  it("a stranger gets 404 with the envelope only; a participant, invited account, or link reader gets 403 organizer_only; missing X-HP-Request: 1 returns 403 csrf and writes nothing", async () => {
    const orgEmail = track(uniqueEmail("org"));
    const memberEmail = track(uniqueEmail("member"));
    const invitedEmail = track(uniqueEmail("invited"));
    const strangerEmail = track(uniqueEmail("stranger"));
    const targetEmail = track(uniqueEmail("target"));
    const organizer = await register(orgEmail, "Omar");
    const member = await register(memberEmail, "Nour");
    const invited = await register(invitedEmail, "Hana");
    const stranger = await register(strangerEmail, "Sam");
    await register(targetEmail, "Ziad");
    const plan = await openPlan(organizer.token);

    await sql`
      INSERT INTO participants (
        id, plan_id, account_id, guest_session_id, display_name, distinguisher
      ) VALUES (
        ${generateId("prt_")}, ${plan.id}, ${member.account.id}, NULL, 'Nour', 'a3k9'
      )
    `;
    await sql`
      INSERT INTO invitations (id, plan_id, account_id, distinguisher)
      VALUES (${generateId("inv_")}, ${plan.id}, ${invited.account.id}, 'k7m2')
    `;
    const link = await seedLink(plan.id);
    const guest = await seedGuestParticipant(plan.id, "Guest", "g2h4");
    const before = await invitationCount(plan.id);

    const csrf = await invitePost(
      plan.id,
      { email: targetEmail },
      { csrf: false, cookie: `hp_session=${organizer.token}` },
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
    expect(await invitationCount(plan.id)).toBe(before);

    const organizerOnly = {
      error: {
        code: "forbidden",
        reason: "organizer_only",
        message: "organizer only",
        fields: [],
      },
    };

    const asMember = await invitePost(
      plan.id,
      { email: targetEmail },
      { cookie: `hp_session=${member.token}` },
    );
    expect(asMember.status).toBe(403);
    expect(await asMember.json()).toEqual(organizerOnly);
    expect(await invitationCount(plan.id)).toBe(before);

    const asInvited = await invitePost(
      plan.id,
      { email: targetEmail },
      { cookie: `hp_session=${invited.token}` },
    );
    expect(asInvited.status).toBe(403);
    expect(await asInvited.json()).toEqual(organizerOnly);

    const asLink = await invitePost(
      plan.id,
      { email: targetEmail },
      { cookie: `hp_link=${link.token}` },
    );
    expect(asLink.status).toBe(403);
    expect(await asLink.json()).toEqual(organizerOnly);

    const asGuest = await invitePost(
      plan.id,
      { email: targetEmail },
      { cookie: `hp_guest=${guest.token}` },
    );
    expect(asGuest.status).toBe(403);
    expect(await asGuest.json()).toEqual(organizerOnly);

    const asStranger = await invitePost(
      plan.id,
      { email: targetEmail },
      { cookie: `hp_session=${stranger.token}` },
    );
    expect(asStranger.status).toBe(404);
    const strangerBody = await asStranger.json();
    expect(strangerBody).toEqual({
      error: {
        code: "not_found",
        message: "plan not found",
        fields: [],
      },
    });
    expect(Object.keys(strangerBody)).toEqual(["error"]);
    expect(JSON.stringify(strangerBody)).not.toContain("Thursday");
    expect(JSON.stringify(strangerBody)).not.toContain(plan.id);
    expect(JSON.stringify(strangerBody)).not.toContain("Nour");
    expect(JSON.stringify(strangerBody)).not.toContain(targetEmail);
    expect(await invitationCount(plan.id)).toBe(before);
  });
});
