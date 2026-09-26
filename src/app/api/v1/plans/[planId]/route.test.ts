import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { generateCookieToken, hashCookieToken } from "@/server/auth/session";
import { resetClock } from "@/server/clock";
import { generateId, generateJoinToken, isId } from "@/server/ids";
import { editableFor } from "@/server/plans/edit-rules";
import {
  POST as createAccount,
  closeDatabase as closeAccounts,
} from "../../accounts/route";
import { POST as createPlan, closeDatabase } from "../route";
import { GET, PATCH } from "./route";

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
  await closeDatabase();
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
  return setCookieLines(response).find((line) => line.startsWith("hp_session=")) ?? null;
}

function cookieValue(line: string): string {
  const pair = line.split(";", 1)[0] ?? "";
  return decodeURIComponent(pair.slice("hp_session=".length));
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
  return { account: body.account, token: cookieValue(line!) };
}

async function openPlan(token: string, overrides: Record<string, unknown> = {}) {
  const response = await createPlan(
    jsonRequest("/v1/plans", "POST", validPlan(overrides), {
      cookie: `hp_session=${token}`,
    }),
  );
  expect(response.status).toBe(201);
  return (await response.json()) as {
    id: string;
    title: string;
    join_path: string;
    windows: { id: string }[];
    steps: { id: string; options: { id: string; label: string }[] }[];
  };
}

function getPlan(planId: string, cookie?: string) {
  const headers: Record<string, string> = {};
  if (cookie) {
    headers.cookie = cookie;
  }
  return GET(new Request(`http://localhost/v1/plans/${planId}`, { headers }), {
    params: Promise.resolve({ planId }),
  });
}

function patchPlan(
  planId: string,
  body: unknown,
  init: { cookie: string; csrf?: boolean },
) {
  return PATCH(
    jsonRequest(`/v1/plans/${planId}`, "PATCH", body, {
      cookie: init.cookie,
      csrf: init.csrf,
    }),
    { params: Promise.resolve({ planId }) },
  );
}

type OrganizerPlanBody = {
  id: string;
  title: string;
  state: string;
  timezone: string;
  windows: { id: string; local_date: string; start_local: string; end_local: string }[];
  budget: { amount_minor: number; currency: string };
  steps: { id: string; name: string; options: { id: string; label: string }[] }[];
  threshold: number;
  answered_count: number;
  in_progress_count: number;
  participants: {
    id: string;
    display_name: string;
    distinguisher: string;
    status: string;
  }[];
  editable: {
    title: boolean;
    timezone: boolean;
    windows: boolean;
    budget: string;
    currency: boolean;
    threshold: string;
    steps: boolean;
  };
  join_path?: string;
};

describe("GET /v1/plans/{planId}", () => {
  it("returns the organizer document with editable, counts, and participants in created_at then id order, and includes no starting points, step picks, or itinerary", async () => {
    const email = track(uniqueEmail("org"));
    const organizer = await register(email, "Omar");
    const plan = await openPlan(organizer.token, { title: "Thursday in Maadi" });

    const earlier = generateId("prt_");
    const later = generateId("prt_");
    const sameTimeA = generateId("prt_");
    const sameTimeB = generateId("prt_");
    await sql`
      INSERT INTO participants (
        id, plan_id, account_id, guest_session_id, display_name, distinguisher, created_at
      ) VALUES
        (${later}, ${plan.id}, NULL, NULL, 'later-placeholder', 'zzzz', ${new Date("2026-09-03T10:00:00.000Z")})
    `.catch(() => undefined);

    const guestId = `gst_${randomBytes(8).toString("hex")}`;
    extraGuestIds.push(guestId);
    await sql`
      INSERT INTO guest_sessions (id, token_hash, expires_at)
      VALUES (${guestId}, ${`hash-${guestId}`}, ${new Date("2026-12-01T00:00:00.000Z")})
    `;
    const guest2 = `gst_${randomBytes(8).toString("hex")}`;
    extraGuestIds.push(guest2);
    await sql`
      INSERT INTO guest_sessions (id, token_hash, expires_at)
      VALUES (${guest2}, ${`hash-${guest2}`}, ${new Date("2026-12-01T00:00:00.000Z")})
    `;
    const guest3 = `gst_${randomBytes(8).toString("hex")}`;
    extraGuestIds.push(guest3);
    await sql`
      INSERT INTO guest_sessions (id, token_hash, expires_at)
      VALUES (${guest3}, ${`hash-${guest3}`}, ${new Date("2026-12-01T00:00:00.000Z")})
    `;
    const guest4 = `gst_${randomBytes(8).toString("hex")}`;
    extraGuestIds.push(guest4);
    await sql`
      INSERT INTO guest_sessions (id, token_hash, expires_at)
      VALUES (${guest4}, ${`hash-${guest4}`}, ${new Date("2026-12-01T00:00:00.000Z")})
    `;

    const [firstId, secondId] =
      sameTimeA < sameTimeB ? [sameTimeA, sameTimeB] : [sameTimeB, sameTimeA];

    await sql`
      INSERT INTO participants (
        id, plan_id, account_id, guest_session_id, display_name, distinguisher, created_at
      ) VALUES
        (${earlier}, ${plan.id}, NULL, ${guestId}, 'Nour El', 'a3k9', ${new Date("2026-09-01T10:00:00.000Z")}),
        (${later}, ${plan.id}, NULL, ${guest2}, 'Hana', 'k7m2', ${new Date("2026-09-03T10:00:00.000Z")}),
        (${firstId}, ${plan.id}, NULL, ${guest3}, 'Omar', 'm2n4', ${new Date("2026-09-02T10:00:00.000Z")}),
        (${secondId}, ${plan.id}, NULL, ${guest4}, 'Ziad', 'p3q5', ${new Date("2026-09-02T10:00:00.000Z")})
    `;
    await sql`
      INSERT INTO responses (
        participant_id, start_google_place_id, start_name, start_lat, start_lng, complete
      ) VALUES
        (${earlier}, 'ChIJ-start', 'Maadi, Cairo', 29.96, 31.25, true),
        (${later}, NULL, NULL, NULL, NULL, false)
    `;
    await sql`
      INSERT INTO response_picks (participant_id, step_id, option_id)
      VALUES (${earlier}, ${plan.steps[0]!.id}, ${plan.steps[0]!.options[0]!.id})
    `;
    await sql`UPDATE plans SET answered_count = 1 WHERE id = ${plan.id}`;

    const response = await getPlan(plan.id, `hp_session=${organizer.token}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as OrganizerPlanBody;
    expect(body.id).toBe(plan.id);
    expect(body.title).toBe("Thursday in Maadi");
    expect(body.state).toBe("collecting");
    expect(body.answered_count).toBe(1);
    expect(body.in_progress_count).toBe(3);
    expect(body.editable).toEqual(editableFor("collecting", 1));
    expect(body.participants.map((participant) => participant.id)).toEqual([
      earlier,
      firstId,
      secondId,
      later,
    ]);
    expect(body.participants[0]).toEqual({
      id: earlier,
      display_name: "Nour El",
      distinguisher: "a3k9",
      status: "answered",
    });
    expect(body.participants[3]).toMatchObject({
      id: later,
      display_name: "Hana",
      status: "in_progress",
    });
    expect(body).not.toHaveProperty("join_path");
    expect(body).not.toHaveProperty("join_token");
    expect(body).not.toHaveProperty("starting_points");
    expect(body).not.toHaveProperty("itinerary");
    expect(body).not.toHaveProperty("proposal");
    expect(body).not.toHaveProperty("legs");
    const json = JSON.stringify(body);
    expect(json).not.toContain("ChIJ-start");
    expect(json).not.toContain("Maadi, Cairo");
    expect(json).not.toContain("google_place_id");
    expect(json).not.toContain("29.96");
    expect(json).not.toContain("31.25");
    expect(json).not.toMatch(/"picks"/);
    expect(json).not.toContain("itinerary");
    expect(json).not.toContain(email);
    expect(Object.keys(body).sort()).toEqual(
      [
        "answered_count",
        "budget",
        "editable",
        "id",
        "in_progress_count",
        "participants",
        "state",
        "steps",
        "threshold",
        "timezone",
        "title",
        "windows",
      ].sort(),
    );
    expect(Object.keys(body.participants[0]!).sort()).toEqual(
      ["display_name", "distinguisher", "id", "status"].sort(),
    );
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

    const linkToken = generateCookieToken();
    const linkId = `lnk_${randomBytes(8).toString("hex")}`;
    extraLinkIds.push(linkId);
    await sql`
      INSERT INTO link_sessions (id, token_hash, expires_at)
      VALUES (
        ${linkId},
        ${hashCookieToken(linkToken)},
        ${new Date("2026-12-01T00:00:00.000Z")}
      )
    `;
    await sql`
      INSERT INTO link_session_plans (link_session_id, plan_id)
      VALUES (${linkId}, ${plan.id})
    `;

    const guestToken = generateCookieToken();
    const guestId = `gst_${randomBytes(8).toString("hex")}`;
    extraGuestIds.push(guestId);
    await sql`
      INSERT INTO guest_sessions (id, token_hash, expires_at)
      VALUES (
        ${guestId},
        ${hashCookieToken(guestToken)},
        ${new Date("2026-12-01T00:00:00.000Z")}
      )
    `;
    await sql`
      INSERT INTO participants (
        id, plan_id, account_id, guest_session_id, display_name, distinguisher
      ) VALUES (
        ${generateId("prt_")}, ${plan.id}, NULL, ${guestId}, 'Guest', 'g2h4'
      )
    `;

    const organizerOnly = {
      error: {
        code: "forbidden",
        reason: "organizer_only",
        message: "organizer only",
        fields: [],
      },
    };

    const asMember = await getPlan(plan.id, `hp_session=${member.token}`);
    expect(asMember.status).toBe(403);
    expect(await asMember.json()).toEqual(organizerOnly);

    const asInvited = await getPlan(plan.id, `hp_session=${invited.token}`);
    expect(asInvited.status).toBe(403);
    expect(await asInvited.json()).toEqual(organizerOnly);

    const asLink = await getPlan(plan.id, `hp_link=${linkToken}`);
    expect(asLink.status).toBe(403);
    expect(await asLink.json()).toEqual(organizerOnly);

    const asGuest = await getPlan(plan.id, `hp_guest=${guestToken}`);
    expect(asGuest.status).toBe(403);
    expect(await asGuest.json()).toEqual(organizerOnly);

    const asStranger = await getPlan(plan.id, `hp_session=${stranger.token}`);
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
    expect(JSON.stringify(strangerBody)).not.toContain("Koshary");

    const missing = await getPlan(plan.id);
    expect(missing.status).toBe(404);
    expect(Object.keys(await missing.json())).toEqual(["error"]);

    const unknownId = generateId("pln_");
    const unknown = await getPlan(unknownId, `hp_session=${organizer.token}`);
    expect(unknown.status).toBe(404);
    const unknownBody = await unknown.json();
    expect(Object.keys(unknownBody)).toEqual(["error"]);
    expect(JSON.stringify(unknownBody)).not.toContain(unknownId);

    await sql`UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${plan.id}`;
    const locked = await getPlan(plan.id, `hp_session=${organizer.token}`);
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

describe("PATCH /v1/plans/{planId}", () => {
  it("applies a legal subset and returns the organizer plan with stored title, step names, option labels, and display names as entered", async () => {
    const email = track(uniqueEmail("edit"));
    const organizer = await register(email, "Omar");
    const plan = await openPlan(organizer.token);
    const guestId = `gst_${randomBytes(8).toString("hex")}`;
    extraGuestIds.push(guestId);
    await sql`
      INSERT INTO guest_sessions (id, token_hash, expires_at)
      VALUES (${guestId}, ${`hash-${guestId}`}, ${new Date("2026-12-01T00:00:00.000Z")})
    `;
    await sql`
      INSERT INTO participants (
        id, plan_id, account_id, guest_session_id, display_name, distinguisher
      ) VALUES (
        ${generateId("prt_")}, ${plan.id}, NULL, ${guestId}, 'Nour El', 'a3k9'
      )
    `;

    const title = "خميس في المعادي";
    const response = await patchPlan(
      plan.id,
      {
        title: ` ${title} `,
        timezone: "Asia/Riyadh",
        windows: [
          { local_date: "2026-11-01", start_local: "17:00", end_local: "22:30" },
        ],
        budget: { amount_minor: 80_000, currency: "SAR" },
        steps: [
          { name: "  قهوة  ", options: ["  تركي  ", "فلتر"] },
        ],
        threshold: 5,
        extra: true,
      },
      { cookie: `hp_session=${organizer.token}` },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as OrganizerPlanBody;
    expect(body.title).toBe(title);
    expect(body.timezone).toBe("Asia/Riyadh");
    expect(body.windows[0]).toMatchObject({
      local_date: "2026-11-01",
      start_local: "17:00",
      end_local: "22:30",
    });
    expect(isId(body.windows[0]!.id, "win_")).toBe(true);
    expect(body.windows[0]!.id).not.toBe(plan.windows[0]!.id);
    expect(body.budget).toEqual({ amount_minor: 80_000, currency: "SAR" });
    expect(body.steps[0]?.name).toBe("قهوة");
    expect(body.steps[0]?.options.map((option) => option.label)).toEqual([
      "تركي",
      "فلتر",
    ]);
    expect(body.steps[0]?.id).not.toBe(plan.steps[0]!.id);
    expect(body.threshold).toBe(5);
    expect(body.participants[0]?.display_name).toBe("Nour El");
    expect(body).not.toHaveProperty("join_path");
    expect(body.state).toBe("collecting");

    const stored = await sql<{ title: string; timezone: string; threshold: number }[]>`
      SELECT title, timezone, threshold FROM plans WHERE id = ${plan.id}
    `;
    expect(stored[0]?.title).toBe(title);
    expect(stored[0]?.timezone).toBe("Asia/Riyadh");
    expect(stored[0]?.threshold).toBe(5);
  });

  it("returns 409 field_frozen for a frozen or illegal edit and writes nothing", async () => {
    const email = track(uniqueEmail("frozen"));
    const organizer = await register(email);
    const plan = await openPlan(organizer.token);
    await sql`UPDATE plans SET answered_count = 1 WHERE id = ${plan.id}`;
    const before = await sql<
      { title: string; timezone: string; budget_amount_minor: number; threshold: number; updated_at: Date | string }[]
    >`
      SELECT title, timezone, budget_amount_minor, threshold, updated_at
      FROM plans WHERE id = ${plan.id}
    `;

    const frozen = await patchPlan(
      plan.id,
      { timezone: "Asia/Dubai", windows: [], steps: [] },
      { cookie: `hp_session=${organizer.token}` },
    );
    expect(frozen.status).toBe(409);
    expect(await frozen.json()).toEqual({
      error: {
        code: "conflict",
        reason: "field_frozen",
        message: "plan patch rejected as field_frozen",
        fields: [
          { path: "timezone", code: "frozen" },
          { path: "windows", code: "frozen" },
          { path: "steps", code: "frozen" },
        ],
      },
    });

    const illegalBudget = await patchPlan(
      plan.id,
      { budget: { amount_minor: 40_000, currency: "EGP" } },
      { cookie: `hp_session=${organizer.token}` },
    );
    expect(illegalBudget.status).toBe(409);
    expect(await illegalBudget.json()).toMatchObject({
      error: {
        code: "conflict",
        reason: "field_frozen",
        fields: [{ path: "budget", code: "frozen" }],
      },
    });

    const currencyChange = await patchPlan(
      plan.id,
      { budget: { amount_minor: 90_000, currency: "USD" } },
      { cookie: `hp_session=${organizer.token}` },
    );
    expect(currencyChange.status).toBe(409);

    const after = await sql<
      { title: string; timezone: string; budget_amount_minor: number; threshold: number; updated_at: Date | string }[]
    >`
      SELECT title, timezone, budget_amount_minor, threshold, updated_at
      FROM plans WHERE id = ${plan.id}
    `;
    expect(after[0]?.timezone).toBe(before[0]?.timezone);
    expect(after[0]?.budget_amount_minor).toBe(before[0]?.budget_amount_minor);
    expect(after[0]?.threshold).toBe(before[0]?.threshold);
    expect(new Date(after[0]!.updated_at).toISOString()).toBe(
      new Date(before[0]!.updated_at).toISOString(),
    );

    const raised = await patchPlan(
      plan.id,
      {
        title: "Updated title",
        budget: { amount_minor: 50_001, currency: "EGP" },
        threshold: 1,
      },
      { cookie: `hp_session=${organizer.token}` },
    );
    expect(raised.status).toBe(200);
    const raisedBody = (await raised.json()) as OrganizerPlanBody;
    expect(raisedBody.title).toBe("Updated title");
    expect(raisedBody.budget.amount_minor).toBe(50_001);
    expect(raisedBody.threshold).toBe(1);
    expect(raisedBody.state).toBe("collecting");
  });

  it("returns 409 plan_locked while locked and writes nothing", async () => {
    const email = track(uniqueEmail("locked"));
    const organizer = await register(email);
    const plan = await openPlan(organizer.token);
    await sql`UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${plan.id}`;
    const before = await sql<{ title: string }[]>`
      SELECT title FROM plans WHERE id = ${plan.id}
    `;
    const response = await patchPlan(
      plan.id,
      { title: "Should not stick" },
      { cookie: `hp_session=${organizer.token}` },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "conflict",
        reason: "plan_locked",
        message: "plan is locked",
        fields: [],
      },
    });
    const after = await sql<{ title: string }[]>`
      SELECT title FROM plans WHERE id = ${plan.id}
    `;
    expect(after[0]?.title).toBe(before[0]?.title);
  });

  it("returns 403 csrf and writes nothing when X-HP-Request is missing", async () => {
    const email = track(uniqueEmail("csrf"));
    const organizer = await register(email);
    const plan = await openPlan(organizer.token);
    const response = await patchPlan(
      plan.id,
      { title: "No csrf" },
      { cookie: `hp_session=${organizer.token}`, csrf: false },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "forbidden",
        reason: "csrf",
        message: "missing X-HP-Request",
        fields: [],
      },
    });
    const stored = await sql<{ title: string }[]>`
      SELECT title FROM plans WHERE id = ${plan.id}
    `;
    expect(stored[0]?.title).toBe("Thursday in Maadi");
  });

  it("does not call a proposal attempt when the threshold meets answered_count or the budget is raised while blocked", async () => {
    const email = track(uniqueEmail("attempt"));
    const organizer = await register(email);
    const plan = await openPlan(organizer.token);
    await sql`UPDATE plans SET answered_count = 2 WHERE id = ${plan.id}`;
    const lowered = await patchPlan(
      plan.id,
      { threshold: 2 },
      { cookie: `hp_session=${organizer.token}` },
    );
    expect(lowered.status).toBe(200);
    const loweredBody = (await lowered.json()) as OrganizerPlanBody;
    expect(loweredBody.threshold).toBe(2);
    expect(loweredBody.state).toBe("collecting");
    expect(loweredBody).not.toHaveProperty("proposal");

    await sql`UPDATE plans SET state = 'blocked' WHERE id = ${plan.id}`;
    const raised = await patchPlan(
      plan.id,
      { budget: { amount_minor: 90_000, currency: "EGP" } },
      { cookie: `hp_session=${organizer.token}` },
    );
    expect(raised.status).toBe(200);
    const raisedBody = (await raised.json()) as OrganizerPlanBody;
    expect(raisedBody.budget.amount_minor).toBe(90_000);
    expect(raisedBody.state).toBe("blocked");
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(
        resolve(process.cwd(), "src/app/api/v1/plans/[planId]/route.ts"),
        "utf8",
      ),
    );
    expect(source).not.toContain("runProposalAttempt");
  });

  it("returns 404 envelope only for a stranger PATCH", async () => {
    const orgEmail = track(uniqueEmail("hide"));
    const strangerEmail = track(uniqueEmail("nosy"));
    const organizer = await register(orgEmail);
    const stranger = await register(strangerEmail);
    const plan = await openPlan(organizer.token);
    const response = await patchPlan(
      plan.id,
      { title: "Stolen" },
      { cookie: `hp_session=${stranger.token}` },
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: "not_found",
        message: "plan not found",
        fields: [],
      },
    });
    expect(Object.keys(body)).toEqual(["error"]);
    expect(JSON.stringify(body)).not.toContain("Thursday");
    const stored = await sql<{ title: string }[]>`
      SELECT title FROM plans WHERE id = ${plan.id}
    `;
    expect(stored[0]?.title).toBe("Thursday in Maadi");
  });
});
