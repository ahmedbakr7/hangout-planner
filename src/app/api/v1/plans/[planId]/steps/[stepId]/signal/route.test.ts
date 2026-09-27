import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { resetClock } from "@/server/clock";
import { generateId } from "@/server/ids";
import { PLACES_SEARCH_TEXT_URL } from "@/server/google/places";
import { ROUTES_MATRIX_URL } from "@/server/google/routes";
import { POST as createAccount } from "../../../../../accounts/route";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { POST as createPlan } from "../../../../route";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { PUT } from "./route";

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
const googleUrls: string[] = [];

const START_A = { id: "ChIJ-start-a", name: "Maadi, Cairo", lat: 29.96, lng: 31.25 };
const START_B = { id: "ChIJ-start-b", name: "Zamalek Garden", lat: 30.06, lng: 31.22 };
const DINNER_A = {
  id: "ChIJ-dinner-a",
  name: "Abu Tarek",
  lat: 30.01,
  lng: 31.235,
  amount: 12_000,
};
const DINNER_B = {
  id: "ChIJ-dinner-b",
  name: "Koshary El Tahrir",
  lat: 30.012,
  lng: 31.236,
  amount: 9_000,
};
const COFFEE_A = {
  id: "ChIJ-coffee-a",
  name: "Cilantro",
  lat: 30.02,
  lng: 31.24,
  amount: 4_000,
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
  await sql`SELECT pg_advisory_lock(60127)`;
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
    await sql`SELECT pg_advisory_unlock(60127)`;
  }
});

beforeEach(() => {
  process.env.HP_HASH_TEST = "1";
  googleUrls.length = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    googleUrls.push(url);
    throw new Error(`unit tests must not call the network: ${url}`);
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

function signalPut(
  planId: string,
  stepId: string,
  signal: unknown,
  init: { cookie?: string; csrf?: boolean },
) {
  return PUT(
    jsonRequest(
      `/v1/plans/${planId}/steps/${stepId}/signal`,
      "PUT",
      { signal },
      init,
    ),
    { params: Promise.resolve({ planId, stepId }) },
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
  proposalId: string;
  dinnerId: string;
  coffeeId: string;
  organizerToken: string;
  nour: { id: string; token: string };
  extra: { token: string };
  stranger: { token: string };
};

async function snapshot(planId: string) {
  const proposal = await sql<{
    id: string;
    local_date: string;
    local_time: string;
    fairness_warning: boolean;
  }[]>`
    SELECT id, local_date::text, local_time, fairness_warning
    FROM proposals WHERE plan_id = ${planId}
  `;
  const steps = await sql<
    { step_id: string; google_place_id: string; place_name: string; amount_minor: number }[]
  >`
    SELECT step_id, google_place_id, place_name, amount_minor
    FROM proposal_steps
    WHERE proposal_id IN (SELECT id FROM proposals WHERE plan_id = ${planId})
    ORDER BY step_id
  `;
  const cohort = await sql<{ participant_id: string; attending: boolean }[]>`
    SELECT participant_id, attending
    FROM proposal_cohort
    WHERE proposal_id IN (SELECT id FROM proposals WHERE plan_id = ${planId})
    ORDER BY participant_id
  `;
  const signals = await sql<
    { step_id: string; participant_id: string; signal: string }[]
  >`
    SELECT step_id, participant_id, signal
    FROM step_signals
    WHERE proposal_id IN (SELECT id FROM proposals WHERE plan_id = ${planId})
    ORDER BY step_id, participant_id
  `;
  return { proposal: proposal[0], steps, cohort, signals };
}

async function seedProposedPlan(): Promise<Seeded> {
  const organizer = await register(track(uniqueEmail("org")), "Omar");
  const nour = await register(track(uniqueEmail("nour")), "Nour");
  const ziad = await register(track(uniqueEmail("ziad")), "Ziad");
  const extra = await register(track(uniqueEmail("extra")), "Hana");
  const stranger = await register(track(uniqueEmail("stranger")), "Samy");
  const plan = await openPlan(organizer.token);
  const nourId = await seedAccountParticipant(plan.id, nour.account.id, "Nour", "a3k9");
  const ziadId = await seedAccountParticipant(plan.id, ziad.account.id, "Ziad", "m2n4");
  await seedAccountParticipant(plan.id, extra.account.id, "Hana", "k7m2");
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
    INSERT INTO proposal_candidates (
      proposal_id, step_id, google_place_id, place_name, amount_minor, latitude, longitude
    ) VALUES
      (${proposalId}, ${dinnerId}, ${DINNER_A.id}, ${DINNER_A.name}, ${DINNER_A.amount}, ${DINNER_A.lat}, ${DINNER_A.lng}),
      (${proposalId}, ${dinnerId}, ${DINNER_B.id}, ${DINNER_B.name}, ${DINNER_B.amount}, ${DINNER_B.lat}, ${DINNER_B.lng}),
      (${proposalId}, ${coffeeId}, ${COFFEE_A.id}, ${COFFEE_A.name}, ${COFFEE_A.amount}, ${COFFEE_A.lat}, ${COFFEE_A.lng})
  `;
  await sql`
    INSERT INTO proposal_alternatives (proposal_id, step_id, position, google_place_id)
    VALUES (${proposalId}, ${dinnerId}, 0, ${DINNER_B.id})
  `;
  await sql`
    UPDATE plans SET answered_count = 2, state = 'proposed' WHERE id = ${plan.id}
  `;
  return {
    planId: plan.id,
    proposalId,
    dinnerId,
    coffeeId,
    organizerToken: organizer.token,
    nour: { id: nourId, token: nour.token },
    extra: { token: extra.token },
    stranger: { token: stranger.token },
  };
}

function expectNoGoogle(): void {
  expect(googleUrls).toEqual([]);
  expect(
    googleUrls.some(
      (url) => url === ROUTES_MATRIX_URL || url === PLACES_SEARCH_TEXT_URL,
    ),
  ).toBe(false);
}

describe("PUT /v1/plans/{planId}/steps/{stepId}/signal", () => {
  it("accepts like, dislike, or unset for a cohort participant while proposed; unset deletes the row; time, places, and cohort do not change; the response has no counts", async () => {
    const seeded = await seedProposedPlan();
    const before = await snapshot(seeded.planId);
    const cookie = `hp_session=${seeded.nour.token}`;

    const liked = await signalPut(seeded.planId, seeded.dinnerId, "like", { cookie });
    expect(liked.status).toBe(200);
    const likedBody = await liked.json();
    expect(likedBody).toEqual({ signal: "like" });
    expect(likedBody).not.toHaveProperty("like_count");
    expect(likedBody).not.toHaveProperty("dislike_count");
    expect(likedBody).not.toHaveProperty("counts");
    expect(
      await sql<{ signal: string }[]>`
        SELECT signal FROM step_signals
        WHERE proposal_id = ${seeded.proposalId}
          AND step_id = ${seeded.dinnerId}
          AND participant_id = ${seeded.nour.id}
      `,
    ).toEqual([{ signal: "like" }]);

    const disliked = await signalPut(seeded.planId, seeded.dinnerId, "dislike", {
      cookie,
    });
    expect(disliked.status).toBe(200);
    expect(await disliked.json()).toEqual({ signal: "dislike" });
    expect(
      await sql<{ signal: string }[]>`
        SELECT signal FROM step_signals
        WHERE proposal_id = ${seeded.proposalId}
          AND step_id = ${seeded.dinnerId}
          AND participant_id = ${seeded.nour.id}
      `,
    ).toEqual([{ signal: "dislike" }]);

    const unset = await signalPut(seeded.planId, seeded.dinnerId, "unset", { cookie });
    expect(unset.status).toBe(200);
    expect(await unset.json()).toEqual({ signal: "unset" });
    expect(
      await sql<{ signal: string }[]>`
        SELECT signal FROM step_signals
        WHERE proposal_id = ${seeded.proposalId}
          AND step_id = ${seeded.dinnerId}
          AND participant_id = ${seeded.nour.id}
      `,
    ).toEqual([]);

    const after = await snapshot(seeded.planId);
    expect(after.proposal).toEqual(before.proposal);
    expect(after.steps).toEqual(before.steps);
    expect(after.cohort).toEqual(before.cohort);
    expectNoGoogle();
  });

  it("the organizer and a non-cohort participant get 403 not_cohort; a stranger gets 404 with the envelope only; missing X-HP-Request: 1 returns 403 csrf and writes nothing; a non-proposed or locked plan does not change", async () => {
    const seeded = await seedProposedPlan();
    const before = await snapshot(seeded.planId);

    const organizer = await signalPut(seeded.planId, seeded.dinnerId, "like", {
      cookie: `hp_session=${seeded.organizerToken}`,
    });
    expect(organizer.status).toBe(403);
    expect(await organizer.json()).toEqual({
      error: {
        code: "forbidden",
        reason: "not_cohort",
        message: "not a cohort member",
        fields: [],
      },
    });

    const extra = await signalPut(seeded.planId, seeded.dinnerId, "like", {
      cookie: `hp_session=${seeded.extra.token}`,
    });
    expect(extra.status).toBe(403);
    expect(await extra.json()).toEqual({
      error: {
        code: "forbidden",
        reason: "not_cohort",
        message: "not a cohort member",
        fields: [],
      },
    });

    const stranger = await signalPut(seeded.planId, seeded.dinnerId, "like", {
      cookie: `hp_session=${seeded.stranger.token}`,
    });
    expect(stranger.status).toBe(404);
    const strangerBody = await stranger.json();
    expect(strangerBody).toEqual({
      error: { code: "not_found", message: "plan not found", fields: [] },
    });
    expect(Object.keys(strangerBody)).toEqual(["error"]);
    expect(JSON.stringify(strangerBody)).not.toContain("Thursday");
    expect(JSON.stringify(strangerBody)).not.toContain(seeded.planId);

    const csrf = await signalPut(seeded.planId, seeded.dinnerId, "like", {
      cookie: `hp_session=${seeded.nour.token}`,
      csrf: false,
    });
    expect(csrf.status).toBe(403);
    expect(await csrf.json()).toEqual({
      error: {
        code: "forbidden",
        reason: "csrf",
        message: "missing X-HP-Request",
        fields: [],
      },
    });
    expect(await snapshot(seeded.planId)).toEqual(before);

    await sql`UPDATE plans SET state = 'collecting' WHERE id = ${seeded.planId}`;
    const collecting = await signalPut(seeded.planId, seeded.dinnerId, "like", {
      cookie: `hp_session=${seeded.nour.token}`,
    });
    expect(collecting.status).toBe(409);
    expect(await collecting.json()).toEqual({
      error: {
        code: "conflict",
        reason: "not_proposed",
        message: "proposal is not available",
        fields: [],
      },
    });
    await sql`UPDATE plans SET state = 'blocked' WHERE id = ${seeded.planId}`;
    const blocked = await signalPut(seeded.planId, seeded.dinnerId, "like", {
      cookie: `hp_session=${seeded.nour.token}`,
    });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({
      error: { reason: "not_proposed" },
    });
    await sql`UPDATE plans SET state = 'proposed' WHERE id = ${seeded.planId}`;
    expect(await snapshot(seeded.planId)).toEqual(before);

    await sql`
      UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${seeded.planId}
    `;
    const locked = await signalPut(seeded.planId, seeded.dinnerId, "like", {
      cookie: `hp_session=${seeded.nour.token}`,
    });
    expect(locked.status).toBe(409);
    expect(await locked.json()).toEqual({
      error: {
        code: "conflict",
        reason: "plan_locked",
        message: "plan is locked",
        fields: [],
      },
    });
    const lockedSnap = await snapshot(seeded.planId);
    expect(lockedSnap.proposal).toEqual(before.proposal);
    expect(lockedSnap.steps).toEqual(before.steps);
    expect(lockedSnap.cohort).toEqual(before.cohort);
    expect(lockedSnap.signals).toEqual(before.signals);
    expectNoGoogle();
  });
});
