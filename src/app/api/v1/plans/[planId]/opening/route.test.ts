import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  generateCookieToken,
  hashCookieToken,
} from "@/server/auth/session";
import { resetClock } from "@/server/clock";
import { generateId } from "@/server/ids";
import {
  POST as createAccount,
  closeDatabase as closeAccounts,
} from "../../../accounts/route";
import { POST as createPlan, closeDatabase as closePlans } from "../../route";
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
    steps: [
      { name: "Dinner", options: ["Koshary", "Grills"] },
      { name: "Coffee", options: ["Turkish", "Filter"] },
    ],
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

function openingGet(planId: string, cookie?: string) {
  const headers: Record<string, string> = {};
  if (cookie) {
    headers.cookie = cookie;
  }
  return GET(new Request(`http://localhost/v1/plans/${planId}/opening`, { headers }), {
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

type OpeningBody = {
  plan_id: string;
  next: string;
  preview: {
    title: string;
    organizer_display_name: string;
    timezone: string;
    windows: { local_date: string; start_local: string; end_local: string }[];
    budget: { amount_minor: number; currency: string };
    step_names: string[];
  } | null;
};

const JOIN_PREVIEW = {
  title: "Thursday in Maadi",
  organizer_display_name: "Omar",
  timezone: "Africa/Cairo",
  windows: [
    { local_date: "2026-10-02", start_local: "18:00", end_local: "23:00" },
  ],
  budget: { amount_minor: 50_000, currency: "EGP" },
  step_names: ["Dinner", "Coffee"],
};

describe("GET /v1/plans/{planId}/opening", () => {
  it("returns next organizer, respond, proposal, confirmed, or join according to the caller and state table, and preview is the join preview only when next is join", async () => {
    const orgEmail = track(uniqueEmail("org"));
    const memberEmail = track(uniqueEmail("member"));
    const invitedEmail = track(uniqueEmail("invited"));
    const organizer = await register(orgEmail, "Omar");
    const member = await register(memberEmail, "Nour");
    const invited = await register(invitedEmail, "Hana");
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
    const guest = await seedGuestParticipant(plan.id, "Ziad", "m2n4");

    const cases: {
      state: "collecting" | "blocked" | "proposed" | "locked";
      cookie: string;
      next: string;
      preview: typeof JOIN_PREVIEW | null;
    }[] = [
      {
        state: "collecting",
        cookie: `hp_session=${organizer.token}`,
        next: "organizer",
        preview: null,
      },
      {
        state: "blocked",
        cookie: `hp_session=${organizer.token}`,
        next: "organizer",
        preview: null,
      },
      {
        state: "proposed",
        cookie: `hp_session=${organizer.token}`,
        next: "organizer",
        preview: null,
      },
      {
        state: "locked",
        cookie: `hp_session=${organizer.token}`,
        next: "confirmed",
        preview: null,
      },
      {
        state: "collecting",
        cookie: `hp_session=${member.token}`,
        next: "respond",
        preview: null,
      },
      {
        state: "blocked",
        cookie: `hp_session=${member.token}`,
        next: "respond",
        preview: null,
      },
      {
        state: "proposed",
        cookie: `hp_session=${member.token}`,
        next: "proposal",
        preview: null,
      },
      {
        state: "locked",
        cookie: `hp_session=${member.token}`,
        next: "confirmed",
        preview: null,
      },
      {
        state: "collecting",
        cookie: `hp_guest=${guest.token}`,
        next: "respond",
        preview: null,
      },
      {
        state: "collecting",
        cookie: `hp_session=${invited.token}`,
        next: "join",
        preview: JOIN_PREVIEW,
      },
      {
        state: "blocked",
        cookie: `hp_session=${invited.token}`,
        next: "join",
        preview: JOIN_PREVIEW,
      },
      {
        state: "proposed",
        cookie: `hp_session=${invited.token}`,
        next: "join",
        preview: JOIN_PREVIEW,
      },
      {
        state: "locked",
        cookie: `hp_session=${invited.token}`,
        next: "confirmed",
        preview: null,
      },
    ];

    for (const row of cases) {
      await sql`UPDATE plans SET state = ${row.state} WHERE id = ${plan.id}`;
      const response = await openingGet(plan.id, row.cookie);
      expect(response.status).toBe(200);
      const body = (await response.json()) as OpeningBody;
      expect(Object.keys(body).sort()).toEqual(["next", "plan_id", "preview"].sort());
      expect(body.plan_id).toBe(plan.id);
      expect(body.next).toBe(row.next);
      expect(body.preview).toEqual(row.preview);
      const json = JSON.stringify(body);
      expect(json).not.toContain(plan.join_path);
      expect(json).not.toContain("jt_");
      if (row.next === "join") {
        expect(Object.keys(body.preview!).sort()).toEqual(
          [
            "budget",
            "organizer_display_name",
            "step_names",
            "timezone",
            "title",
            "windows",
          ].sort(),
        );
        expect(json).not.toContain("Koshary");
        expect(json).not.toContain("threshold");
        expect(json).not.toContain(orgEmail);
      }
    }
  });

  it("an invited account who is not a participant gets next join while the plan is not locked and next confirmed while locked", async () => {
    const orgEmail = track(uniqueEmail("host"));
    const invitedEmail = track(uniqueEmail("guestacc"));
    const organizer = await register(orgEmail, "Omar");
    const invited = await register(invitedEmail, "Hana");
    const plan = await openPlan(organizer.token);
    await sql`
      INSERT INTO invitations (id, plan_id, account_id, distinguisher)
      VALUES (${generateId("inv_")}, ${plan.id}, ${invited.account.id}, 'k7m2')
    `;

    for (const state of ["collecting", "blocked", "proposed"] as const) {
      await sql`UPDATE plans SET state = ${state} WHERE id = ${plan.id}`;
      const response = await openingGet(plan.id, `hp_session=${invited.token}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        plan_id: plan.id,
        next: "join",
        preview: JOIN_PREVIEW,
      });
    }

    await sql`UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${plan.id}`;
    const locked = await openingGet(plan.id, `hp_session=${invited.token}`);
    expect(locked.status).toBe(200);
    expect(await locked.json()).toEqual({
      plan_id: plan.id,
      next: "confirmed",
      preview: null,
    });
  });

  it("a stranger gets 404 with the envelope only", async () => {
    const orgEmail = track(uniqueEmail("org"));
    const strangerEmail = track(uniqueEmail("stranger"));
    const organizer = await register(orgEmail, "Omar");
    const stranger = await register(strangerEmail, "Sam");
    const plan = await openPlan(organizer.token);
    const link = await seedLink(plan.id);

    const envelope = {
      error: {
        code: "not_found",
        message: "plan not found",
        fields: [],
      },
    };

    const signedOut = await openingGet(plan.id);
    expect(signedOut.status).toBe(404);
    const signedOutBody = await signedOut.json();
    expect(signedOutBody).toEqual(envelope);
    expect(Object.keys(signedOutBody)).toEqual(["error"]);
    expect(JSON.stringify(signedOutBody)).not.toContain(plan.title);
    expect(JSON.stringify(signedOutBody)).not.toContain("Omar");
    expect(JSON.stringify(signedOutBody)).not.toContain(plan.id);

    const otherAccount = await openingGet(plan.id, `hp_session=${stranger.token}`);
    expect(otherAccount.status).toBe(404);
    const otherBody = await otherAccount.json();
    expect(otherBody).toEqual(envelope);
    expect(Object.keys(otherBody)).toEqual(["error"]);
    expect(JSON.stringify(otherBody)).not.toContain(plan.title);

    const asLink = await openingGet(plan.id, `hp_link=${link.token}`);
    expect(asLink.status).toBe(404);
    expect(await asLink.json()).toEqual(envelope);

    const unknown = await openingGet(generateId("pln_"), `hp_session=${organizer.token}`);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual(envelope);

    const malformed = await openingGet("not-a-plan", `hp_session=${organizer.token}`);
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toEqual(envelope);
  });
});
