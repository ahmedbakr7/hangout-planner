import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { resetClock, setClock } from "@/server/clock";
import { generateId } from "@/server/ids";
import { PLACES_SEARCH_TEXT_URL, type FetchFn } from "@/server/google/places";
import { ROUTES_MATRIX_URL } from "@/server/google/routes";
import { ATTEMPT_LOCK_MS, closeDatabase as closeAttempt } from "@/server/proposal/attempt";
import { POST as createAccount } from "../../../accounts/route";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { POST as createPlan } from "../../route";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { PROPOSAL_ATTEMPT_HOUR_CAP } from "@/server/proposal/trigger";
import { POST } from "./route";
import { setProposalAttemptGoogleOptions as setGoogleClientOptions } from "@/server/proposal/trigger";

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
const originalProposalEnabled = process.env.HP_PROPOSAL_ENABLED;

const START_A = { id: "ChIJ-start-a", name: "Maadi, Cairo", lat: 29.96, lng: 31.25 };
const START_B = { id: "ChIJ-start-b", name: "Zamalek Garden", lat: 30.06, lng: 31.22 };
const DINNER_A = {
  id: "ChIJ-dinner-a",
  name: "Abu Tarek",
  lat: 30.01,
  lng: 31.235,
  units: 120,
};
const DINNER_B = {
  id: "ChIJ-dinner-b",
  name: "Koshary El Tahrir",
  lat: 30.012,
  lng: 31.236,
  units: 90,
};
const COFFEE_A = {
  id: "ChIJ-coffee-a",
  name: "Cilantro",
  lat: 30.02,
  lng: 31.24,
  units: 40,
};
const COFFEE_B = {
  id: "ChIJ-coffee-b",
  name: "Filter Room",
  lat: 30.021,
  lng: 31.241,
  units: 35,
};

function uniqueEmail(label = "user"): string {
  return `${label}.${randomBytes(8).toString("hex")}@example.com`;
}

function track(email: string): string {
  createdEmails.push(email);
  return email;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function venuePlace(place: {
  id: string;
  name: string;
  lat: number;
  lng: number;
  units: number;
}) {
  return {
    id: place.id,
    displayName: { text: place.name },
    location: { latitude: place.lat, longitude: place.lng },
    priceRange: {
      startPrice: { currencyCode: "EGP", units: place.units, nanos: 0 },
    },
  };
}

function waypointLatLng(value: unknown): { latitude: number; longitude: number } | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const latLng = (
    (value as { waypoint?: { location?: { latLng?: unknown } } }).waypoint
      ?.location as { latLng?: { latitude?: unknown; longitude?: unknown } } | undefined
  )?.latLng;
  if (
    latLng === undefined ||
    typeof latLng.latitude !== "number" ||
    typeof latLng.longitude !== "number"
  ) {
    return null;
  }
  return { latitude: latLng.latitude, longitude: latLng.longitude };
}

function attemptGoogleFetch(captured: string[]): FetchFn {
  const byQuery: Record<string, unknown[]> = {
    Koshary: [venuePlace(DINNER_A), venuePlace(DINNER_B)],
    Turkish: [venuePlace(COFFEE_A), venuePlace(COFFEE_B)],
  };
  return async (request, init) => {
    const url =
      typeof request === "string"
        ? request
        : request instanceof URL
          ? request.href
          : request.url;
    captured.push(url);
    if (url === PLACES_SEARCH_TEXT_URL) {
      const body =
        init?.body === undefined
          ? {}
          : (JSON.parse(String(init.body)) as { textQuery?: string });
      return jsonResponse({ places: byQuery[body.textQuery ?? ""] ?? [] });
    }
    if (url === ROUTES_MATRIX_URL) {
      const body =
        init?.body === undefined
          ? { origins: [], destinations: [] }
          : (JSON.parse(String(init.body)) as {
              origins?: unknown[];
              destinations?: unknown[];
            });
      const origins = (body.origins ?? []).map(waypointLatLng);
      const destinations = (body.destinations ?? []).map(waypointLatLng);
      const elements: unknown[] = [];
      for (let i = 0; i < origins.length; i += 1) {
        for (let j = 0; j < destinations.length; j += 1) {
          elements.push({
            originIndex: i,
            destinationIndex: j,
            status: { code: 0 },
            condition: "ROUTE_EXISTS",
            duration: "180s",
          });
        }
      }
      return jsonResponse(elements);
    }
    throw new Error(`unexpected Google URL: ${url}`);
  };
}

function expectNoLiveGoogle(urls: readonly string[]): void {
  expect(
    urls.every(
      (url) => url === PLACES_SEARCH_TEXT_URL || url === ROUTES_MATRIX_URL,
    ),
  ).toBe(true);
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
  await sql`SELECT pg_advisory_lock(60125)`;
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
    await sql`SELECT pg_advisory_unlock(60125)`;
  }
});

beforeEach(() => {
  process.env.HP_HASH_TEST = "1";
  delete process.env.HP_PROPOSAL_ENABLED;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    throw new Error(`unit tests must not call the network: ${String(input)}`);
  });
  setGoogleClientOptions(undefined);
});

afterEach(async () => {
  resetClock();
  delete process.env.HP_HASH_TEST;
  if (originalProposalEnabled === undefined) {
    delete process.env.HP_PROPOSAL_ENABLED;
  } else {
    process.env.HP_PROPOSAL_ENABLED = originalProposalEnabled;
  }
  setGoogleClientOptions(undefined);
  vi.unstubAllGlobals();
  const emails = createdEmails.splice(0, createdEmails.length);
  for (const email of emails) {
    await forget(email);
  }
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
  await closeAttempt();
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

function attemptPost(
  planId: string,
  init: { cookie?: string; csrf?: boolean },
) {
  return POST(
    jsonRequest(`/v1/plans/${planId}/proposal-attempts`, "POST", {}, init),
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

async function seedBlockedPlan(): Promise<{
  planId: string;
  organizerToken: string;
  member: { account: { id: string }; token: string };
  shape: PlanShape;
}> {
  const organizer = await register(track(uniqueEmail("org")), "Omar");
  const nour = await register(track(uniqueEmail("nour")), "Nour");
  const ziad = await register(track(uniqueEmail("ziad")), "Ziad");
  const plan = await openPlan(organizer.token);
  const nourId = await seedAccountParticipant(
    plan.id,
    nour.account.id,
    "Nour",
    "a3k9",
  );
  const ziadId = await seedAccountParticipant(
    plan.id,
    ziad.account.id,
    "Ziad",
    "m2n4",
  );
  const shape = await planShape(plan.id);
  await seedComplete(plan.id, nourId, START_A, shape);
  await seedComplete(plan.id, ziadId, START_B, shape);
  await sql`
    UPDATE plans SET answered_count = 2, state = 'blocked' WHERE id = ${plan.id}
  `;
  return {
    planId: plan.id,
    organizerToken: organizer.token,
    member: nour,
    shape,
  };
}

async function seedHourRuns(planId: string, count: number, startedAt: Date): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await sql`
      INSERT INTO proposal_runs (
        id, plan_id, started_at, outcome, block_time, block_budget, block_venue_data
      ) VALUES (
        ${`prn_${randomBytes(16).toString("hex")}`},
        ${planId},
        ${startedAt},
        'blocked',
        false,
        false,
        true
      )
    `;
  }
}

async function runCount(planId: string): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM proposal_runs WHERE plan_id = ${planId}
  `;
  return Number(rows[0]?.count ?? 0);
}

async function planState(planId: string): Promise<string> {
  const rows = await sql<{ state: string }[]>`
    SELECT state FROM plans WHERE id = ${planId}
  `;
  return rows[0]?.state ?? "";
}

type OrganizerProposalBody = {
  state: string;
  block: { time: boolean; budget: boolean; venue_data: boolean } | null;
  proposal: {
    time: { local_date: string; local_time: string; timezone: string };
    attending_count: number;
    cohort_size: number;
    cohort: { display_name: string; distinguisher: string; attending: boolean }[];
    fairness_warning: boolean;
    steps: {
      step_id: string;
      name: string;
      option_label: string;
      place: { name: string; amount_minor: number; currency: string };
      like_count: number;
      dislike_count: number;
      alternatives: unknown[];
    }[];
    legs: { from_step_id: string; to_step_id: string; duration_seconds: number }[];
  } | null;
};

describe("POST /v1/plans/{planId}/proposal-attempts", () => {
  it("runs an attempt while blocked and returns the organizer proposal document; other states return 409 not_blocked or plan_locked", async () => {
    const seeded = await seedBlockedPlan();
    const captured: string[] = [];
    setGoogleClientOptions({
      apiKey: "test-places-key",
      fetch: attemptGoogleFetch(captured),
    });

    const ok = await attemptPost(seeded.planId, {
      cookie: `hp_session=${seeded.organizerToken}`,
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as OrganizerProposalBody;
    expect(body.state).toBe("proposed");
    expect(body.block).toBeNull();
    expect(body.proposal).not.toBeNull();
    expect(body.proposal?.time).toEqual({
      local_date: "2026-10-02",
      local_time: "18:00",
      timezone: "Africa/Cairo",
    });
    expect(body.proposal?.cohort_size).toBe(2);
    expect(body.proposal?.attending_count).toBe(2);
    expect(body.proposal?.legs).toHaveLength(1);
    expect(body.proposal?.legs[0]?.duration_seconds).toBeGreaterThanOrEqual(1);
    const dinner = body.proposal?.steps.find((step) => step.name === "Dinner");
    expect(dinner).toMatchObject({
      option_label: "Koshary",
      like_count: 0,
      dislike_count: 0,
      place: { currency: "EGP" },
    });
    expect(dinner).toHaveProperty("alternatives");
    expect(dinner).not.toHaveProperty("my_signal");
    expectNoLiveGoogle(captured);
    expect(await planState(seeded.planId)).toBe("proposed");

    const collecting = await register(track(uniqueEmail("col")), "Omar");
    const collectingPlan = await openPlan(collecting.token);
    const collectingPost = await attemptPost(collectingPlan.id, {
      cookie: `hp_session=${collecting.token}`,
    });
    expect(collectingPost.status).toBe(409);
    expect(await collectingPost.json()).toEqual({
      error: {
        code: "conflict",
        reason: "not_blocked",
        message: "plan is not blocked",
        fields: [],
      },
    });
    expect(await runCount(collectingPlan.id)).toBe(0);

    const proposedPost = await attemptPost(seeded.planId, {
      cookie: `hp_session=${seeded.organizerToken}`,
    });
    expect(proposedPost.status).toBe(409);
    expect(await proposedPost.json()).toMatchObject({
      error: { reason: "not_blocked" },
    });

    await sql`
      UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${seeded.planId}
    `;
    const locked = await attemptPost(seeded.planId, {
      cookie: `hp_session=${seeded.organizerToken}`,
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
  });

  it("returns 409 attempt_in_progress for a lock younger than 20s and takes over a lock older than 20s", async () => {
    const young = await seedBlockedPlan();
    const old = await seedBlockedPlan();
    const frozen = new Date("2026-09-26T12:00:00.000Z");
    setClock(frozen);
    await sql`
      UPDATE plans
      SET attempt_lock = true, attempt_lock_at = ${frozen}
      WHERE id = ${young.planId}
    `;
    const captured: string[] = [];
    setGoogleClientOptions({
      apiKey: "test-places-key",
      fetch: attemptGoogleFetch(captured),
    });

    const inProgress = await attemptPost(young.planId, {
      cookie: `hp_session=${young.organizerToken}`,
    });
    expect(inProgress.status).toBe(409);
    expect(await inProgress.json()).toEqual({
      error: {
        code: "conflict",
        reason: "attempt_in_progress",
        message: "a proposal attempt is already in progress",
        fields: [],
      },
    });
    expect(await planState(young.planId)).toBe("blocked");
    expect(await runCount(young.planId)).toBe(0);
    expect(captured).toEqual([]);

    await sql`
      UPDATE plans
      SET attempt_lock = true, attempt_lock_at = ${frozen}
      WHERE id = ${old.planId}
    `;
    setClock(new Date(frozen.getTime() + ATTEMPT_LOCK_MS + 1));
    const takeover = await attemptPost(old.planId, {
      cookie: `hp_session=${old.organizerToken}`,
    });
    expect(takeover.status).toBe(200);
    const body = (await takeover.json()) as OrganizerProposalBody;
    expect(body.state).toBe("proposed");
    expectNoLiveGoogle(captured);
    const lock = await sql<{ attempt_lock: boolean }[]>`
      SELECT attempt_lock FROM plans WHERE id = ${old.planId}
    `;
    expect(lock[0]?.attempt_lock).toBe(false);
  });

  it("returns 429 after 20 runs per plan per rolling hour and does not change the plan", async () => {
    const seeded = await seedBlockedPlan();
    await seedHourRuns(seeded.planId, PROPOSAL_ATTEMPT_HOUR_CAP, new Date());
    const captured: string[] = [];
    setGoogleClientOptions({
      apiKey: "test-places-key",
      fetch: attemptGoogleFetch(captured),
    });

    const limited = await attemptPost(seeded.planId, {
      cookie: `hp_session=${seeded.organizerToken}`,
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      error: {
        code: "rate_limited",
        message: "too many proposal attempts",
        fields: [],
      },
    });
    expect(await planState(seeded.planId)).toBe("blocked");
    expect(await runCount(seeded.planId)).toBe(PROPOSAL_ATTEMPT_HOUR_CAP);
    expect(captured).toEqual([]);
    const proposals = await sql<{ id: string }[]>`
      SELECT id FROM proposals WHERE plan_id = ${seeded.planId}
    `;
    expect(proposals).toEqual([]);
  });

  it("HP_PROPOSAL_ENABLED=0 records venue_data and does not call Google", async () => {
    const seeded = await seedBlockedPlan();
    process.env.HP_PROPOSAL_ENABLED = "0";
    const captured: string[] = [];
    setGoogleClientOptions({
      apiKey: "test-places-key",
      fetch: attemptGoogleFetch(captured),
    });

    const response = await attemptPost(seeded.planId, {
      cookie: `hp_session=${seeded.organizerToken}`,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      state: "blocked",
      block: { time: false, budget: false, venue_data: true },
      proposal: null,
    });
    expect(captured).toEqual([]);
    expect(await planState(seeded.planId)).toBe("blocked");
  });

  it("a stranger gets 404 with the envelope only; a non-organizer who can know the plan gets 403 organizer_only; missing X-HP-Request: 1 returns 403 csrf and writes nothing", async () => {
    const seeded = await seedBlockedPlan();
    const stranger = await register(track(uniqueEmail("stranger")), "Ziad");
    const captured: string[] = [];
    setGoogleClientOptions({
      apiKey: "test-places-key",
      fetch: attemptGoogleFetch(captured),
    });

    const strangerPost = await attemptPost(seeded.planId, {
      cookie: `hp_session=${stranger.token}`,
    });
    expect(strangerPost.status).toBe(404);
    const strangerBody = await strangerPost.json();
    expect(strangerBody).toEqual({
      error: { code: "not_found", message: "plan not found", fields: [] },
    });
    expect(Object.keys(strangerBody)).toEqual(["error"]);
    expect(JSON.stringify(strangerBody)).not.toContain("Thursday");
    expect(JSON.stringify(strangerBody)).not.toContain(seeded.planId);

    const memberPost = await attemptPost(seeded.planId, {
      cookie: `hp_session=${seeded.member.token}`,
    });
    expect(memberPost.status).toBe(403);
    expect(await memberPost.json()).toEqual({
      error: {
        code: "forbidden",
        reason: "organizer_only",
        message: "organizer only",
        fields: [],
      },
    });

    const csrf = await attemptPost(seeded.planId, {
      cookie: `hp_session=${seeded.organizerToken}`,
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
    expect(await planState(seeded.planId)).toBe("blocked");
    expect(await runCount(seeded.planId)).toBe(0);
    expect(captured).toEqual([]);
  });
});
