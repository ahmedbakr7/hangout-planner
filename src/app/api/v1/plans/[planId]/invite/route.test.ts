import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  generateCookieToken,
  hashCookieToken,
} from "@/server/auth/session";
import { resetClock } from "@/server/clock";
import { generateId, isDistinguisher } from "@/server/ids";
import { POST as createAccount } from "../../../accounts/route";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { POST as createPlan } from "../../route";
import { closeDatabase as closePlans } from "@/server/plans/http";
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
  };
}

function inviteGet(planId: string, cookie?: string) {
  const headers: Record<string, string> = {};
  if (cookie) {
    headers.cookie = cookie;
  }
  return GET(new Request(`http://localhost/v1/plans/${planId}/invite`, { headers }), {
    params: Promise.resolve({ planId }),
  });
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

type InviteBody = {
  join_path: string;
  invitations: {
    display_name: string;
    distinguisher: string;
    status: string;
  }[];
};

describe("GET /v1/plans/{planId}/invite", () => {
  it("returns a join_path that stays the same for the life of the plan, and one row per account in created_at order with display_name, distinguisher, and status invited, joined, or answered", async () => {
    const orgEmail = track(uniqueEmail("org"));
    const invitedEmail = track(uniqueEmail("invited"));
    const joinedEmail = track(uniqueEmail("joined"));
    const answeredEmail = track(uniqueEmail("answered"));
    const organizer = await register(orgEmail, "Omar");
    const invited = await register(invitedEmail, "Hana");
    const joined = await register(joinedEmail, "Nour");
    const answered = await register(answeredEmail, "Ziad");
    const plan = await openPlan(organizer.token);

    const laterId = generateId("inv_");
    const earlierId = generateId("inv_");
    const middleId = generateId("inv_");
    await sql`
      INSERT INTO invitations (id, plan_id, account_id, distinguisher, created_at)
      VALUES
        (${laterId}, ${plan.id}, ${invited.account.id}, 'k7m2', ${new Date("2026-09-03T10:00:00.000Z")}),
        (${earlierId}, ${plan.id}, ${joined.account.id}, 'xxxx', ${new Date("2026-09-01T10:00:00.000Z")}),
        (${middleId}, ${plan.id}, ${answered.account.id}, 'p3q5', ${new Date("2026-09-02T10:00:00.000Z")})
    `;
    await sql`
      INSERT INTO participants (
        id, plan_id, account_id, guest_session_id, display_name, distinguisher
      ) VALUES
        (${generateId("prt_")}, ${plan.id}, ${joined.account.id}, NULL, 'Nour', 'a3k9'),
        (${generateId("prt_")}, ${plan.id}, ${answered.account.id}, NULL, 'Ziad', 'm2n4')
    `;
    const answeredParticipant = await sql<{ id: string }[]>`
      SELECT id FROM participants
      WHERE plan_id = ${plan.id} AND account_id = ${answered.account.id}
    `;
    await sql`
      INSERT INTO responses (
        participant_id, start_google_place_id, start_name, start_lat, start_lng, complete
      ) VALUES (
        ${answeredParticipant[0]!.id}, 'ChIJ-start', 'Maadi, Cairo', 29.96, 31.25, true
      )
    `;
    await seedGuestParticipant(plan.id, "Guest", "g2h4");

    const first = await inviteGet(plan.id, `hp_session=${organizer.token}`);
    expect(first.status).toBe(200);
    const body = (await first.json()) as InviteBody;
    expect(body.join_path).toBe(plan.join_path);
    expect(body.join_path).toMatch(/^\/join\/jt_/);
    expect(Object.keys(body).sort()).toEqual(["invitations", "join_path"].sort());
    expect(body.invitations).toEqual([
      { display_name: "Nour", distinguisher: "a3k9", status: "joined" },
      { display_name: "Ziad", distinguisher: "m2n4", status: "answered" },
      { display_name: "Hana", distinguisher: "k7m2", status: "invited" },
    ]);
    expect(isDistinguisher(body.invitations[0]!.distinguisher)).toBe(true);
    expect(body.invitations.map((row) => row.display_name)).toEqual([
      "Nour",
      "Ziad",
      "Hana",
    ]);
    expect(Object.keys(body.invitations[0]!).sort()).toEqual(
      ["display_name", "distinguisher", "status"].sort(),
    );
    const json = JSON.stringify(body);
    expect(json).not.toContain(orgEmail);
    expect(json).not.toContain(invitedEmail);
    expect(json).not.toContain("Guest");
    expect(json).not.toContain("ChIJ-start");
    expect(json).not.toContain("Maadi, Cairo");

    const second = await inviteGet(plan.id, `hp_session=${organizer.token}`);
    expect(second.status).toBe(200);
    const again = (await second.json()) as InviteBody;
    expect(again.join_path).toBe(body.join_path);
    expect(again.invitations).toEqual(body.invitations);
  });

  it("returns 403 organizer_only for a participant, invited account, or link reader, 404 for a stranger, and 409 plan_locked when locked", async () => {
    const orgEmail = track(uniqueEmail("lock"));
    const memberEmail = track(uniqueEmail("member"));
    const invitedEmail = track(uniqueEmail("invited"));
    const strangerEmail = track(uniqueEmail("stranger"));
    const organizer = await register(orgEmail, "Omar");
    const member = await register(memberEmail, "Nour");
    const invited = await register(invitedEmail, "Hana");
    const stranger = await register(strangerEmail, "Ziad");
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

    const organizerOnly = {
      error: {
        code: "forbidden",
        reason: "organizer_only",
        message: "organizer only",
        fields: [],
      },
    };

    const asMember = await inviteGet(plan.id, `hp_session=${member.token}`);
    expect(asMember.status).toBe(403);
    expect(await asMember.json()).toEqual(organizerOnly);

    const asInvited = await inviteGet(plan.id, `hp_session=${invited.token}`);
    expect(asInvited.status).toBe(403);
    expect(await asInvited.json()).toEqual(organizerOnly);

    const asLink = await inviteGet(plan.id, `hp_link=${link.token}`);
    expect(asLink.status).toBe(403);
    expect(await asLink.json()).toEqual(organizerOnly);

    const asGuest = await inviteGet(plan.id, `hp_guest=${guest.token}`);
    expect(asGuest.status).toBe(403);
    expect(await asGuest.json()).toEqual(organizerOnly);

    const asStranger = await inviteGet(plan.id, `hp_session=${stranger.token}`);
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
    expect(JSON.stringify(strangerBody)).not.toContain("Hana");

    const missing = await inviteGet(plan.id);
    expect(missing.status).toBe(404);
    expect(Object.keys(await missing.json())).toEqual(["error"]);

    await sql`UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${plan.id}`;
    const locked = await inviteGet(plan.id, `hp_session=${organizer.token}`);
    expect(locked.status).toBe(409);
    expect(await locked.json()).toEqual({
      error: {
        code: "conflict",
        reason: "plan_locked",
        message: "plan is locked",
        fields: [],
      },
    });
  });
});
