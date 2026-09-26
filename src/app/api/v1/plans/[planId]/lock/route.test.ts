import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import {
  generateCookieToken,
  hashCookieToken,
} from "@/server/auth/session";
import { resetClock, setClock } from "@/server/clock";
import { generateId } from "@/server/ids";
import {
  POST as createAccount,
  closeDatabase as closeAccounts,
} from "../../../accounts/route";
import { POST as createPlan, closeDatabase as closePlans } from "../../route";
import { GET as getConfirmed } from "../confirmed/route";
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
const extraLinkIds: string[] = [];

const START_A = { id: "ChIJ-start-a", name: "Maadi, Cairo", lat: 29.96, lng: 31.25 };
const START_B = { id: "ChIJ-start-b", name: "Zamalek Garden", lat: 30.06, lng: 31.22 };
const DINNER_A = {
  id: "ChIJ-dinner-a",
  name: "Abu Tarek",
  lat: 30.01,
  lng: 31.235,
  amount: 12_000,
};
const COFFEE_A = {
  id: "ChIJ-coffee-a",
  name: "Cilantro",
  lat: 30.02,
  lng: 31.24,
  amount: 4_000,
};

const NOT_FOUND_ENVELOPE = {
  error: { code: "not_found", message: "plan not found", fields: [] },
};

const ORGANIZER_ONLY = {
  error: {
    code: "forbidden",
    reason: "organizer_only",
    message: "organizer only",
    fields: [],
  },
};

const CSRF = {
  error: {
    code: "forbidden",
    reason: "csrf",
    message: "missing X-HP-Request",
    fields: [],
  },
};

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
  await sql`SELECT pg_advisory_lock(60128)`;
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
    await sql`SELECT pg_advisory_unlock(60128)`;
  }
});

beforeEach(() => {
  process.env.HP_HASH_TEST = "1";
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    throw new Error(`unit tests must not call the network: ${String(input)}`);
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
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
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

function validPlan(overrides: Record<string, unknown> = {}) {
  return {
    title: "Thursday in Maadi",
    timezone: "Africa/Cairo",
    windows: [
      { local_date: "2026-10-02", start_local: "18:00", end_local: "19:00" },
    ],
    budget: { amount_minor: 50_000, currency: "EGP" },
    steps: [
      { name: "Dinner", options: ["Koshary", "Grills"] },
      { name: "Coffee", options: ["Turkish", "Filter"] },
    ],
    threshold: 2,
    ...overrides,
  };
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
  return { account: body.account, token: cookieValue(response, "hp_session") };
}

async function openPlan(sessionToken: string, overrides: Record<string, unknown> = {}) {
  const response = await createPlan(
    jsonRequest("/v1/plans", "POST", validPlan(overrides), {
      cookie: `hp_session=${sessionToken}`,
    }),
  );
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}

function lockPost(planId: string, init: { cookie?: string; csrf?: boolean }) {
  return POST(
    jsonRequest(`/v1/plans/${planId}/lock`, "POST", {}, init),
    { params: Promise.resolve({ planId }) },
  );
}

function confirmedGet(planId: string, cookie?: string) {
  const headers: Record<string, string> = {};
  if (cookie) {
    headers.cookie = cookie;
  }
  return getConfirmed(
    new Request(`http://localhost/v1/plans/${planId}/confirmed`, { headers }),
    { params: Promise.resolve({ planId }) },
  );
}

async function seedAccountParticipant(
  planId: string,
  accountId: string,
  displayName: string,
  distinguisher: string,
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

type PlanShape = {
  windows: { id: string }[];
  steps: { id: string; name: string }[];
  options: { id: string; step_id: string; label: string }[];
};

async function planShape(planId: string): Promise<PlanShape> {
  const windows = await sql<PlanShape["windows"]>`
    SELECT id FROM plan_windows WHERE plan_id = ${planId} ORDER BY position
  `;
  const steps = await sql<PlanShape["steps"]>`
    SELECT id, name FROM plan_steps WHERE plan_id = ${planId} ORDER BY position
  `;
  const options = await sql<PlanShape["options"]>`
    SELECT id, step_id, label
    FROM plan_options
    WHERE step_id IN (SELECT id FROM plan_steps WHERE plan_id = ${planId})
    ORDER BY step_id, position
  `;
  return { windows, steps, options };
}

function optionFor(shape: PlanShape, stepName: string, label: string): string {
  const step = shape.steps.find((row) => row.name === stepName);
  expect(step).toBeDefined();
  const option = shape.options.find(
    (row) => row.step_id === step!.id && row.label === label,
  );
  expect(option).toBeDefined();
  return option!.id;
}

async function seedComplete(
  planId: string,
  participantId: string,
  start: { id: string; name: string; lat: number; lng: number },
  shape: PlanShape,
): Promise<void> {
  await sql`
    INSERT INTO responses (
      participant_id, start_google_place_id, start_name, start_lat, start_lng,
      complete, first_completed_at
    ) VALUES (
      ${participantId}, ${start.id}, ${start.name}, ${start.lat}, ${start.lng},
      true, ${new Date("2026-09-01T00:00:00.000Z")}
    )
  `;
  await sql`
    INSERT INTO response_windows (
      participant_id, window_id, kind, earliest_local, latest_local
    ) VALUES (
      ${participantId}, ${shape.windows[0]!.id}, 'free', '18:00', '19:00'
    )
  `;
  await sql`
    INSERT INTO response_picks (participant_id, step_id, option_id) VALUES
      (${participantId}, ${shape.steps[0]!.id}, ${optionFor(shape, "Dinner", "Koshary")}),
      (${participantId}, ${shape.steps[1]!.id}, ${optionFor(shape, "Coffee", "Turkish")})
  `;
}

type Seeded = {
  planId: string;
  dinnerId: string;
  coffeeId: string;
  organizerToken: string;
  nour: { token: string };
  invited: { token: string };
  stranger: { token: string };
  link: { token: string };
};

async function seedProposedPlan(): Promise<Seeded> {
  const organizer = await register(track(uniqueEmail("org")), "Omar");
  const nour = await register(track(uniqueEmail("nour")), "Nour");
  const ziad = await register(track(uniqueEmail("ziad")), "Ziad");
  const invited = await register(track(uniqueEmail("invited")), "Hana");
  const stranger = await register(track(uniqueEmail("stranger")), "Samy");
  const plan = await openPlan(organizer.token);
  const nourId = await seedAccountParticipant(plan.id, nour.account.id, "Nour", "a3k9");
  const ziadId = await seedAccountParticipant(plan.id, ziad.account.id, "Ziad", "m2n4");
  await sql`
    INSERT INTO invitations (id, plan_id, account_id, distinguisher)
    VALUES (${generateId("inv_")}, ${plan.id}, ${invited.account.id}, 'k7m2')
  `;
  const link = await seedLink(plan.id);
  const shape = await planShape(plan.id);
  await seedComplete(plan.id, nourId, START_A, shape);
  await seedComplete(plan.id, ziadId, START_B, shape);
  const dinnerId = shape.steps[0]!.id;
  const coffeeId = shape.steps[1]!.id;
  const dinnerOption = optionFor(shape, "Dinner", "Koshary");
  const coffeeOption = optionFor(shape, "Coffee", "Turkish");
  const proposalId = `prp_${randomBytes(16).toString("hex")}`;
  await sql`
    INSERT INTO proposals (id, plan_id, local_date, local_time, fairness_warning)
    VALUES (${proposalId}, ${plan.id}, '2026-10-02', '18:30', false)
  `;
  await sql`
    INSERT INTO proposal_cohort (proposal_id, participant_id, attending) VALUES
      (${proposalId}, ${nourId}, true),
      (${proposalId}, ${ziadId}, true)
  `;
  await sql`
    INSERT INTO proposal_steps (
      proposal_id, step_id, option_id, google_place_id, place_name, amount_minor
    ) VALUES
      (${proposalId}, ${dinnerId}, ${dinnerOption}, ${DINNER_A.id}, ${DINNER_A.name}, ${DINNER_A.amount}),
      (${proposalId}, ${coffeeId}, ${coffeeOption}, ${COFFEE_A.id}, ${COFFEE_A.name}, ${COFFEE_A.amount})
  `;
  await sql`
    INSERT INTO proposal_legs (proposal_id, from_step_id, to_step_id, duration_seconds)
    VALUES (${proposalId}, ${dinnerId}, ${coffeeId}, 840)
  `;
  await sql`
    INSERT INTO step_signals (proposal_id, step_id, participant_id, signal) VALUES
      (${proposalId}, ${dinnerId}, ${nourId}, 'like')
  `;
  await sql`
    UPDATE plans SET answered_count = 2, state = 'proposed' WHERE id = ${plan.id}
  `;
  return {
    planId: plan.id,
    dinnerId,
    coffeeId,
    organizerToken: organizer.token,
    nour: { token: nour.token },
    invited: { token: invited.token },
    stranger: { token: stranger.token },
    link,
  };
}

async function planRow(planId: string) {
  const rows = await sql<{ state: string; locked_at: Date | null }[]>`
    SELECT state, locked_at FROM plans WHERE id = ${planId}
  `;
  return rows[0];
}

describe("POST /v1/plans/{planId}/lock", () => {
  it("from proposed returns 200 with the confirmed document and sets state locked", async () => {
    expect(databaseUrl.startsWith("postgres://")).toBe(true);
    const seeded = await seedProposedPlan();
    const frozen = new Date("2026-09-27T12:00:00.000Z");
    setClock(frozen);
    const cookie = `hp_session=${seeded.organizerToken}`;

    const response = await lockPost(seeded.planId, { cookie });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      plan_id: string;
      title: string;
      state: string;
      time: { local_date: string; local_time: string; timezone: string };
      steps: {
        step_id: string;
        place_name: string;
        amount_minor: number;
        currency: string;
      }[];
      legs: {
        from_step_id: string;
        to_step_id: string;
        duration_seconds: number;
      }[];
      cohort: { display_name: string; distinguisher: string }[];
    };
    expect(body).toEqual({
      plan_id: seeded.planId,
      title: "Thursday in Maadi",
      state: "locked",
      time: {
        local_date: "2026-10-02",
        local_time: "18:30",
        timezone: "Africa/Cairo",
      },
      steps: [
        {
          step_id: seeded.dinnerId,
          place_name: "Abu Tarek",
          amount_minor: 12_000,
          currency: "EGP",
        },
        {
          step_id: seeded.coffeeId,
          place_name: "Cilantro",
          amount_minor: 4_000,
          currency: "EGP",
        },
      ],
      legs: [
        {
          from_step_id: seeded.dinnerId,
          to_step_id: seeded.coffeeId,
          duration_seconds: 840,
        },
      ],
      cohort: [
        { display_name: "Nour", distinguisher: "a3k9" },
        { display_name: "Ziad", distinguisher: "m2n4" },
      ],
    });
    expect(Object.keys(body)).toEqual([
      "plan_id",
      "title",
      "state",
      "time",
      "steps",
      "legs",
      "cohort",
    ]);

    const stored = await planRow(seeded.planId);
    expect(stored?.state).toBe("locked");
    expect(stored?.locked_at).toEqual(frozen);

    const confirmed = await confirmedGet(seeded.planId, cookie);
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toEqual(body);
  });

  it("collecting and blocked return 409 not_proposed; already locked returns 409 plan_locked; there is no unlock route", async () => {
    const organizer = await register(track(uniqueEmail("org")), "Omar");
    const plan = await openPlan(organizer.token);
    const cookie = `hp_session=${organizer.token}`;

    const collecting = await lockPost(plan.id, { cookie });
    expect(collecting.status).toBe(409);
    expect(await collecting.json()).toEqual({
      error: {
        code: "conflict",
        reason: "not_proposed",
        message: "proposal is not available",
        fields: [],
      },
    });
    expect(await planRow(plan.id)).toMatchObject({
      state: "collecting",
      locked_at: null,
    });

    await sql`UPDATE plans SET state = 'blocked' WHERE id = ${plan.id}`;
    const blocked = await lockPost(plan.id, { cookie });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toEqual({
      error: {
        code: "conflict",
        reason: "not_proposed",
        message: "proposal is not available",
        fields: [],
      },
    });
    expect((await planRow(plan.id))?.state).toBe("blocked");
    expect((await planRow(plan.id))?.locked_at).toBeNull();

    const seeded = await seedProposedPlan();
    const first = await lockPost(seeded.planId, {
      cookie: `hp_session=${seeded.organizerToken}`,
    });
    expect(first.status).toBe(200);
    const before = await planRow(seeded.planId);
    const again = await lockPost(seeded.planId, {
      cookie: `hp_session=${seeded.organizerToken}`,
    });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({
      error: {
        code: "conflict",
        reason: "plan_locked",
        message: "plan is locked",
        fields: [],
      },
    });
    const after = await planRow(seeded.planId);
    expect(after?.state).toBe("locked");
    expect(after?.locked_at).toEqual(before?.locked_at);

    const planDir = resolve(process.cwd(), "src/app/api/v1/plans/[planId]");
    expect(existsSync(resolve(planDir, "unlock"))).toBe(false);
    expect(existsSync(resolve(planDir, "lock/unlock"))).toBe(false);
    expect(existsSync(resolve(planDir, "confirmed/unlock"))).toBe(false);
    expect(existsSync(resolve(__dirname, "../unlock"))).toBe(false);
  });

  it("a stranger gets 404 with the envelope only; a participant gets 403 organizer_only; missing X-HP-Request: 1 returns 403 csrf and writes nothing", async () => {
    const seeded = await seedProposedPlan();

    const stranger = await lockPost(seeded.planId, {
      cookie: `hp_session=${seeded.stranger.token}`,
    });
    expect(stranger.status).toBe(404);
    const strangerBody = await stranger.json();
    expect(strangerBody).toEqual(NOT_FOUND_ENVELOPE);
    expect(Object.keys(strangerBody)).toEqual(["error"]);
    expect(JSON.stringify(strangerBody)).not.toContain("Thursday");
    expect(JSON.stringify(strangerBody)).not.toContain(seeded.planId);
    expect(JSON.stringify(strangerBody)).not.toContain("Nour");
    expect(JSON.stringify(strangerBody)).not.toContain("Abu Tarek");

    const member = await lockPost(seeded.planId, {
      cookie: `hp_session=${seeded.nour.token}`,
    });
    expect(member.status).toBe(403);
    expect(await member.json()).toEqual(ORGANIZER_ONLY);

    const invited = await lockPost(seeded.planId, {
      cookie: `hp_session=${seeded.invited.token}`,
    });
    expect(invited.status).toBe(403);
    expect(await invited.json()).toEqual(ORGANIZER_ONLY);

    const asLink = await lockPost(seeded.planId, {
      cookie: `hp_link=${seeded.link.token}`,
    });
    expect(asLink.status).toBe(403);
    expect(await asLink.json()).toEqual(ORGANIZER_ONLY);

    const csrf = await lockPost(seeded.planId, {
      cookie: `hp_session=${seeded.organizerToken}`,
      csrf: false,
    });
    expect(csrf.status).toBe(403);
    expect(await csrf.json()).toEqual(CSRF);
    expect(await planRow(seeded.planId)).toMatchObject({
      state: "proposed",
      locked_at: null,
    });
  });
});
