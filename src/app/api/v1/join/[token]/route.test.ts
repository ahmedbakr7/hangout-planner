import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import {
  generateCookieToken,
  hashCookieToken,
  SESSION_MAX_AGE_SECONDS,
} from "@/server/auth/session";
import { resetClock } from "@/server/clock";
import {
  generateDistinguisher,
  generateId,
  generateJoinToken,
  isDistinguisher,
  isId,
  isJoinToken,
} from "@/server/ids";
import { PARTICIPANT_CAP } from "@/server/join/open";
import {
  POST as createAccount,
  closeDatabase as closeAccounts,
} from "../../accounts/route";
import { POST as createPlan, closeDatabase as closePlans } from "../../plans/route";
import { GET, POST, closeDatabase } from "./route";

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

function cookieLine(response: Response, name: string): string | null {
  return setCookieLines(response).find((line) => line.startsWith(`${name}=`)) ?? null;
}

function cookieValue(line: string, name: string): string {
  const pair = line.split(";", 1)[0] ?? "";
  return decodeURIComponent(pair.slice(`${name}=`.length));
}

function sessionSetCookie(response: Response): string | null {
  return cookieLine(response, "hp_session");
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
  const body = (await response.json()) as {
    id: string;
    title: string;
    join_path: string;
  };
  const token = body.join_path.slice("/join/".length);
  expect(isJoinToken(token)).toBe(true);
  return { id: body.id, title: body.title, token };
}

function joinGet(token: string, cookie?: string) {
  const headers: Record<string, string> = {};
  if (cookie) {
    headers.cookie = cookie;
  }
  return GET(new Request(`http://localhost/v1/join/${token}`, { headers }), {
    params: Promise.resolve({ token }),
  });
}

function joinPost(
  token: string,
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
    new Request(`http://localhost/v1/join/${token}`, {
      method: "POST",
      headers,
      body: init?.raw ?? JSON.stringify(body),
    }),
    { params: Promise.resolve({ token }) },
  );
}

async function participantCount(planId: string): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM participants WHERE plan_id = ${planId}
  `;
  return Number(rows[0]?.count ?? 0);
}

async function seedGuestParticipant(
  planId: string,
  displayName: string,
  distinguisher: string,
): Promise<{ guestId: string; token: string; participantId: string }> {
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
  const participantId = generateId("prt_");
  await sql`
    INSERT INTO participants (
      id, plan_id, account_id, guest_session_id, display_name, distinguisher
    ) VALUES (
      ${participantId}, ${planId}, NULL, ${guestId}, ${displayName}, ${distinguisher}
    )
  `;
  return { guestId, token, participantId };
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

type JoinBody = {
  participant: { id: string; display_name: string; distinguisher: string };
  next: string;
};

describe("GET /v1/join/{token}", () => {
  it("returns 404 for an unknown token and on success attaches the plan to hp_link and uses the opening body shape", async () => {
    const email = track(uniqueEmail("org"));
    const organizer = await register(email, "Omar");
    const plan = await openPlan(organizer.token);

    const unknownToken = generateJoinToken();
    const unknown = await joinGet(unknownToken);
    expect(unknown.status).toBe(404);
    const unknownBody = await unknown.json();
    expect(unknownBody).toEqual({
      error: {
        code: "not_found",
        message: "unknown join token",
        fields: [],
      },
    });
    expect(Object.keys(unknownBody)).toEqual(["error"]);
    expect(JSON.stringify(unknownBody)).not.toContain(plan.title);
    expect(JSON.stringify(unknownBody)).not.toContain(plan.id);
    expect(JSON.stringify(unknownBody)).not.toContain("Omar");
    expect(cookieLine(unknown, "hp_link")).toBeNull();

    const malformed = await joinGet("not-a-token");
    expect(malformed.status).toBe(404);
    expect(cookieLine(malformed, "hp_link")).toBeNull();

    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((message) => {
      logs.push(String(message));
    });
    const response = await joinGet(plan.token);
    spy.mockRestore();
    expect(response.status).toBe(200);
    const body = (await response.json()) as OpeningBody;
    expect(Object.keys(body).sort()).toEqual(["next", "plan_id", "preview"].sort());
    expect(body.plan_id).toBe(plan.id);
    expect(body.next).toBe("join");
    expect(body.preview).not.toBeNull();

    const line = cookieLine(response, "hp_link");
    expect(line).not.toBeNull();
    expect(line).toContain("HttpOnly");
    expect(line).toContain("SameSite=lax");
    expect(line).toContain("Path=/");
    expect(line).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`);
    const linkToken = cookieValue(line!, "hp_link");
    const attached = await sql<{ plan_id: string }[]>`
      SELECT lsp.plan_id
      FROM link_sessions ls
      JOIN link_session_plans lsp ON lsp.link_session_id = ls.id
      WHERE ls.token_hash = ${hashCookieToken(linkToken)}
    `;
    expect(attached.map((row) => row.plan_id)).toEqual([plan.id]);
    expect(logs.join("\n")).not.toContain(plan.token);
    expect(logs.join("\n")).not.toContain(linkToken);
  });

  it("when next is join, preview has title, organizer display name, timezone, windows, budget, and step names, and omits option labels, counts, threshold, statuses, starting points, and any itinerary", async () => {
    const email = track(uniqueEmail("preview"));
    const organizer = await register(email, "Omar");
    const plan = await openPlan(organizer.token, {
      title: "Thursday in Maadi",
      steps: [
        { name: "Dinner", options: ["Koshary", "Grills"] },
        { name: "Coffee", options: ["Turkish", "Filter"] },
      ],
      threshold: 3,
    });

    const response = await joinGet(plan.token);
    expect(response.status).toBe(200);
    const body = (await response.json()) as OpeningBody;
    expect(body.next).toBe("join");
    expect(body.preview).toEqual({
      title: "Thursday in Maadi",
      organizer_display_name: "Omar",
      timezone: "Africa/Cairo",
      windows: [
        { local_date: "2026-10-02", start_local: "18:00", end_local: "23:00" },
      ],
      budget: { amount_minor: 50_000, currency: "EGP" },
      step_names: ["Dinner", "Coffee"],
    });
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
    expect(Object.keys(body.preview!.windows[0]!).sort()).toEqual(
      ["end_local", "local_date", "start_local"].sort(),
    );
    const json = JSON.stringify(body);
    expect(json).not.toContain("Koshary");
    expect(json).not.toContain("Grills");
    expect(json).not.toContain("Turkish");
    expect(json).not.toContain("threshold");
    expect(json).not.toContain("answered_count");
    expect(json).not.toContain("in_progress");
    expect(json).not.toContain("status");
    expect(json).not.toContain("starting");
    expect(json).not.toContain("itinerary");
    expect(json).not.toContain("distinguisher");
    expect(json).not.toContain(email);
  });

  it("gives the organizer next organizer or confirmed and does not insert a participant; an existing account or guest participant is returned without a second participant", async () => {
    const orgEmail = track(uniqueEmail("host"));
    const memberEmail = track(uniqueEmail("member"));
    const organizer = await register(orgEmail, "Omar");
    const member = await register(memberEmail, "Nour");
    const plan = await openPlan(organizer.token);
    await sql`
      INSERT INTO participants (
        id, plan_id, account_id, guest_session_id, display_name, distinguisher
      ) VALUES (
        ${generateId("prt_")}, ${plan.id}, ${member.account.id}, NULL, 'Nour', 'a3k9'
      )
    `;
    const guest = await seedGuestParticipant(plan.id, "Hana", "k7m2");
    expect(await participantCount(plan.id)).toBe(2);

    const asOrganizer = await joinGet(plan.token, `hp_session=${organizer.token}`);
    expect(asOrganizer.status).toBe(200);
    expect(await asOrganizer.json()).toMatchObject({
      plan_id: plan.id,
      next: "organizer",
      preview: null,
    });
    expect(await participantCount(plan.id)).toBe(2);

    const asMember = await joinGet(plan.token, `hp_session=${member.token}`);
    expect(asMember.status).toBe(200);
    expect(await asMember.json()).toMatchObject({
      plan_id: plan.id,
      next: "respond",
      preview: null,
    });
    expect(await participantCount(plan.id)).toBe(2);

    const asGuest = await joinGet(plan.token, `hp_guest=${guest.token}`);
    expect(asGuest.status).toBe(200);
    expect(await asGuest.json()).toMatchObject({
      plan_id: plan.id,
      next: "respond",
      preview: null,
    });
    expect(await participantCount(plan.id)).toBe(2);

    await sql`UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${plan.id}`;
    const lockedOrganizer = await joinGet(
      plan.token,
      `hp_session=${organizer.token}`,
    );
    expect(lockedOrganizer.status).toBe(200);
    expect(await lockedOrganizer.json()).toMatchObject({
      next: "confirmed",
      preview: null,
    });
    expect(await participantCount(plan.id)).toBe(2);

    const lockedStranger = await joinGet(plan.token);
    expect(lockedStranger.status).toBe(200);
    expect(await lockedStranger.json()).toMatchObject({
      next: "confirmed",
      preview: null,
    });
  });
});

describe("POST /v1/join/{token}", () => {
  it("anonymous join requires a display name of 1–40 characters after trim, asks for no password, and 201 sets or extends hp_guest; the same guest and plan return the existing participant; a new guest session creates a new participant even when the display name matches", async () => {
    const email = track(uniqueEmail("anon"));
    const organizer = await register(email, "Omar");
    const plan = await openPlan(organizer.token);

    const missingName = await joinPost(plan.token, { kind: "anonymous" });
    expect(missingName.status).toBe(400);
    expect(await missingName.json()).toMatchObject({
      error: {
        code: "validation_failed",
        fields: [{ path: "display_name", code: "required" }],
      },
    });
    expect(await participantCount(plan.id)).toBe(0);

    const tooLong = await joinPost(plan.token, {
      kind: "anonymous",
      display_name: "a".repeat(41),
    });
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toMatchObject({
      error: {
        fields: [{ path: "display_name", code: "too_long" }],
      },
    });

    const created = await joinPost(plan.token, {
      kind: "anonymous",
      display_name: "  Nour  ",
      password: "should-not-be-used",
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as JoinBody;
    expect(Object.keys(createdBody).sort()).toEqual(["next", "participant"].sort());
    expect(Object.keys(createdBody.participant).sort()).toEqual(
      ["display_name", "distinguisher", "id"].sort(),
    );
    expect(isId(createdBody.participant.id, "prt_")).toBe(true);
    expect(createdBody.participant.display_name).toBe("Nour");
    expect(isDistinguisher(createdBody.participant.distinguisher)).toBe(true);
    expect(createdBody.next).toBe("respond");
    const guestLine = cookieLine(created, "hp_guest");
    expect(guestLine).not.toBeNull();
    expect(guestLine).toContain("HttpOnly");
    expect(guestLine).toContain("SameSite=lax");
    expect(guestLine).toContain("Path=/");
    expect(guestLine).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`);
    expect(cookieLine(created, "hp_session")).toBeNull();
    const guestToken = cookieValue(guestLine!, "hp_guest");
    const storedGuest = await sql<{ token_hash: string }[]>`
      SELECT token_hash FROM guest_sessions WHERE token_hash = ${hashCookieToken(guestToken)}
    `;
    expect(storedGuest).toHaveLength(1);
    expect(await participantCount(plan.id)).toBe(1);

    const again = await joinPost(
      plan.token,
      { kind: "anonymous", display_name: "Nour" },
      { cookie: `hp_guest=${guestToken}` },
    );
    expect(again.status).toBe(200);
    const againBody = (await again.json()) as JoinBody;
    expect(againBody.participant.id).toBe(createdBody.participant.id);
    expect(againBody.participant.display_name).toBe("Nour");
    expect(await participantCount(plan.id)).toBe(1);

    const other = await joinPost(plan.token, {
      kind: "anonymous",
      display_name: "Nour",
    });
    expect(other.status).toBe(201);
    const otherBody = (await other.json()) as JoinBody;
    expect(otherBody.participant.id).not.toBe(createdBody.participant.id);
    expect(otherBody.participant.display_name).toBe("Nour");
    expect(otherBody.participant.distinguisher).not.toBe(
      createdBody.participant.distinguisher,
    );
    expect(await participantCount(plan.id)).toBe(2);
    const otherGuest = cookieLine(other, "hp_guest");
    expect(otherGuest).not.toBeNull();
    expect(cookieValue(otherGuest!, "hp_guest")).not.toBe(guestToken);
  });

  it("account join requires hp_session, uses the account display name, returns 401 missing_session without a session, and returns an existing participant with 200 instead of creating another", async () => {
    const orgEmail = track(uniqueEmail("org"));
    const memberEmail = track(uniqueEmail("acc"));
    const organizer = await register(orgEmail, "Omar");
    const member = await register(memberEmail, "Nour El");
    const plan = await openPlan(organizer.token);

    const missing = await joinPost(plan.token, { kind: "account" });
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({
      error: {
        code: "unauthenticated",
        reason: "missing_session",
        message: "missing session",
        fields: [],
      },
    });
    expect(await participantCount(plan.id)).toBe(0);

    const created = await joinPost(
      plan.token,
      { kind: "account", display_name: "Ignored" },
      { cookie: `hp_session=${member.token}` },
    );
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as JoinBody;
    expect(createdBody.participant.display_name).toBe("Nour El");
    expect(createdBody.next).toBe("respond");
    expect(cookieLine(created, "hp_guest")).toBeNull();
    expect(await participantCount(plan.id)).toBe(1);

    const again = await joinPost(
      plan.token,
      { kind: "account" },
      { cookie: `hp_session=${member.token}` },
    );
    expect(again.status).toBe(200);
    const againBody = (await again.json()) as JoinBody;
    expect(againBody.participant.id).toBe(createdBody.participant.id);
    expect(await participantCount(plan.id)).toBe(1);
  });

  it("locked, organizer, and full return 409 plan_locked, organizer_cannot_join, or plan_full and create no participant; POST without X-HP-Request: 1 returns 403 csrf and writes nothing", async () => {
    const orgEmail = track(uniqueEmail("lock"));
    const memberEmail = track(uniqueEmail("full"));
    const organizer = await register(orgEmail, "Omar");
    const member = await register(memberEmail, "Nour");
    const plan = await openPlan(organizer.token);

    const csrf = await joinPost(
      plan.token,
      { kind: "anonymous", display_name: "Nour" },
      { csrf: false },
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

    const asOrganizer = await joinPost(
      plan.token,
      { kind: "account" },
      { cookie: `hp_session=${organizer.token}` },
    );
    expect(asOrganizer.status).toBe(409);
    expect(await asOrganizer.json()).toMatchObject({
      error: { code: "conflict", reason: "organizer_cannot_join", fields: [] },
    });
    expect(await participantCount(plan.id)).toBe(0);

    await sql`UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${plan.id}`;
    const locked = await joinPost(plan.token, {
      kind: "anonymous",
      display_name: "Nour",
    });
    expect(locked.status).toBe(409);
    expect(await locked.json()).toMatchObject({
      error: { code: "conflict", reason: "plan_locked", fields: [] },
    });
    expect(await participantCount(plan.id)).toBe(0);

    await sql`UPDATE plans SET state = 'collecting', locked_at = NULL WHERE id = ${plan.id}`;
    const taken = new Set<string>();
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

    const fullAnon = await joinPost(plan.token, {
      kind: "anonymous",
      display_name: "Nour",
    });
    expect(fullAnon.status).toBe(409);
    expect(await fullAnon.json()).toMatchObject({
      error: { code: "conflict", reason: "plan_full", fields: [] },
    });
    const fullAccount = await joinPost(
      plan.token,
      { kind: "account" },
      { cookie: `hp_session=${member.token}` },
    );
    expect(fullAccount.status).toBe(409);
    expect(await fullAccount.json()).toMatchObject({
      error: { code: "conflict", reason: "plan_full", fields: [] },
    });
    expect(await participantCount(plan.id)).toBe(PARTICIPANT_CAP);
  });

  it("a new participant receives a distinguisher from the contract alphabet, unique among participants and pending invitations on that plan", async () => {
    const orgEmail = track(uniqueEmail("dist"));
    const invitedEmail = track(uniqueEmail("inv"));
    const organizer = await register(orgEmail, "Omar");
    const invited = await register(invitedEmail, "Hana");
    const plan = await openPlan(organizer.token);

    await sql`
      INSERT INTO invitations (id, plan_id, account_id, distinguisher)
      VALUES (${generateId("inv_")}, ${plan.id}, ${invited.account.id}, 'a3k9')
    `;
    await seedGuestParticipant(plan.id, "Ziad", "k7m2");

    const response = await joinPost(plan.token, {
      kind: "anonymous",
      display_name: "Nour",
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as JoinBody;
    expect(isDistinguisher(body.participant.distinguisher)).toBe(true);
    expect(body.participant.distinguisher).not.toBe("a3k9");
    expect(body.participant.distinguisher).not.toBe("k7m2");

    const stored = await sql<{ distinguisher: string }[]>`
      SELECT distinguisher FROM participants WHERE plan_id = ${plan.id}
    `;
    const pending = await sql<{ distinguisher: string }[]>`
      SELECT distinguisher FROM invitations WHERE plan_id = ${plan.id}
    `;
    const values = stored.map((row) => row.distinguisher);
    expect(new Set(values).size).toBe(values.length);
    expect(values).not.toContain("a3k9");
    expect(pending.map((row) => row.distinguisher)).toEqual(["a3k9"]);
  });
});
