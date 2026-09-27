import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { resetClock } from "@/server/clock";
import { generateId } from "@/server/ids";
import { PLACES_SEARCH_TEXT_URL, type FetchFn } from "@/server/google/places";
import { ROUTES_MATRIX_URL } from "@/server/google/routes";
import { POST as createAccount } from "../../../../../accounts/route";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { POST as createPlan } from "../../../../route";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { GET as getProposal } from "../../../proposal/route";
import { POST } from "./route";
import { setGoogleClientOptions } from "@/server/proposal/swap-google";

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
const DINNER_C = {
  id: "ChIJ-dinner-c",
  name: "Koshary Sayed",
  lat: 30.013,
  lng: 31.237,
  amount: 8_500,
};
const DINNER_D = {
  id: "ChIJ-dinner-d",
  name: "Koshary Hindi",
  lat: 30.014,
  lng: 31.238,
  amount: 8_000,
};
const DINNER_E = {
  id: "ChIJ-dinner-e",
  name: "Koshary Street",
  lat: 30.015,
  lng: 31.239,
  amount: 7_500,
};
const COFFEE_A = {
  id: "ChIJ-coffee-a",
  name: "Cilantro",
  lat: 30.02,
  lng: 31.24,
  amount: 4_000,
};
const COFFEE_B = {
  id: "ChIJ-coffee-b",
  name: "Filter Room",
  lat: 30.021,
  lng: 31.241,
  amount: 3_500,
};

const ORIGINAL_LEG_SECONDS = 840;
const ROUTED_SECONDS = 180;
const UNFAIR_START_SECONDS = 4_000;

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

function samePoint(
  point: { latitude: number; longitude: number } | null,
  expected: { lat: number; lng: number },
): boolean {
  return (
    point !== null &&
    point.latitude === expected.lat &&
    point.longitude === expected.lng
  );
}

function routesFetch(
  captured: string[],
  mode: "ok" | "fail_new_leg" | "unfair" = "ok",
): FetchFn {
  return async (request, init) => {
    const url =
      typeof request === "string"
        ? request
        : request instanceof URL
          ? request.href
          : request.url;
    captured.push(url);
    if (url !== ROUTES_MATRIX_URL) {
      throw new Error(`unexpected Google URL: ${url}`);
    }
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
        const from = origins[i] ?? null;
        const to = destinations[j] ?? null;
        if (
          mode === "fail_new_leg" &&
          samePoint(from, DINNER_B) &&
          samePoint(to, COFFEE_A)
        ) {
          elements.push({
            originIndex: i,
            destinationIndex: j,
            status: { code: 0 },
            condition: "ROUTE_NOT_FOUND",
            duration: "0s",
          });
          continue;
        }
        const durationSeconds =
          mode === "unfair" &&
          samePoint(from, START_B) &&
          samePoint(to, DINNER_B)
            ? UNFAIR_START_SECONDS
            : ROUTED_SECONDS;
        elements.push({
          originIndex: i,
          destinationIndex: j,
          status: { code: 0 },
          condition: "ROUTE_EXISTS",
          duration: `${durationSeconds}s`,
        });
      }
    }
    return jsonResponse(elements);
  };
}

function expectFakeRoutesOnly(urls: readonly string[]): void {
  expect(urls.every((url) => url === ROUTES_MATRIX_URL)).toBe(true);
  expect(urls.some((url) => url.includes("places.googleapis.com"))).toBe(false);
  expect(urls.some((url) => url === PLACES_SEARCH_TEXT_URL)).toBe(false);
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
  await sql`SELECT pg_advisory_lock(60126)`;
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
    await sql`SELECT pg_advisory_unlock(60126)`;
  }
});

beforeEach(() => {
  process.env.HP_HASH_TEST = "1";
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    throw new Error(`unit tests must not call the network: ${String(input)}`);
  });
  setGoogleClientOptions(undefined);
});

afterEach(async () => {
  resetClock();
  delete process.env.HP_HASH_TEST;
  setGoogleClientOptions(undefined);
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

function swapPost(
  planId: string,
  stepId: string,
  googlePlaceId: string,
  init: { cookie?: string; csrf?: boolean },
) {
  return POST(
    jsonRequest(
      `/v1/plans/${planId}/steps/${stepId}/swap`,
      "POST",
      { google_place_id: googlePlaceId },
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
  const alts = await sql<
    { step_id: string; position: number; google_place_id: string }[]
  >`
    SELECT step_id, position, google_place_id
    FROM proposal_alternatives
    WHERE proposal_id IN (SELECT id FROM proposals WHERE plan_id = ${planId})
    ORDER BY step_id, position
  `;
  const legs = await sql<
    { from_step_id: string; to_step_id: string; duration_seconds: number }[]
  >`
    SELECT from_step_id, to_step_id, duration_seconds
    FROM proposal_legs
    WHERE proposal_id IN (SELECT id FROM proposals WHERE plan_id = ${planId})
    ORDER BY from_step_id
  `;
  const signals = await sql<
    { step_id: string; participant_id: string; signal: string }[]
  >`
    SELECT step_id, participant_id, signal
    FROM step_signals
    WHERE proposal_id IN (SELECT id FROM proposals WHERE plan_id = ${planId})
    ORDER BY step_id, participant_id
  `;
  const state = await sql<{ state: string }[]>`
    SELECT state FROM plans WHERE id = ${planId}
  `;
  return {
    proposal: proposal[0],
    steps,
    alts,
    legs,
    signals,
    state: state[0]?.state,
  };
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
    VALUES (${proposalId}, ${dinnerId}, ${coffeeId}, ${ORIGINAL_LEG_SECONDS})
  `;
  await sql`
    INSERT INTO proposal_candidates (
      proposal_id, step_id, google_place_id, place_name, amount_minor, latitude, longitude
    ) VALUES
      (${proposalId}, ${dinnerId}, ${DINNER_A.id}, ${DINNER_A.name}, ${DINNER_A.amount}, ${DINNER_A.lat}, ${DINNER_A.lng}),
      (${proposalId}, ${dinnerId}, ${DINNER_B.id}, ${DINNER_B.name}, ${DINNER_B.amount}, ${DINNER_B.lat}, ${DINNER_B.lng}),
      (${proposalId}, ${dinnerId}, ${DINNER_C.id}, ${DINNER_C.name}, ${DINNER_C.amount}, ${DINNER_C.lat}, ${DINNER_C.lng}),
      (${proposalId}, ${dinnerId}, ${DINNER_D.id}, ${DINNER_D.name}, ${DINNER_D.amount}, ${DINNER_D.lat}, ${DINNER_D.lng}),
      (${proposalId}, ${dinnerId}, ${DINNER_E.id}, ${DINNER_E.name}, ${DINNER_E.amount}, ${DINNER_E.lat}, ${DINNER_E.lng}),
      (${proposalId}, ${coffeeId}, ${COFFEE_A.id}, ${COFFEE_A.name}, ${COFFEE_A.amount}, ${COFFEE_A.lat}, ${COFFEE_A.lng}),
      (${proposalId}, ${coffeeId}, ${COFFEE_B.id}, ${COFFEE_B.name}, ${COFFEE_B.amount}, ${COFFEE_B.lat}, ${COFFEE_B.lng})
  `;
  await sql`
    INSERT INTO proposal_alternatives (proposal_id, step_id, position, google_place_id) VALUES
      (${proposalId}, ${dinnerId}, 0, ${DINNER_B.id}),
      (${proposalId}, ${dinnerId}, 1, ${DINNER_C.id}),
      (${proposalId}, ${dinnerId}, 2, ${DINNER_D.id}),
      (${proposalId}, ${coffeeId}, 0, ${COFFEE_B.id})
  `;
  await sql`
    INSERT INTO step_signals (proposal_id, step_id, participant_id, signal) VALUES
      (${proposalId}, ${dinnerId}, ${nourId}, 'like'),
      (${proposalId}, ${dinnerId}, ${ziadId}, 'dislike'),
      (${proposalId}, ${coffeeId}, ${nourId}, 'like')
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

type OrganizerProposalBody = {
  state: string;
  block: unknown;
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
      my_signal?: string;
      alternatives: {
        google_place_id: string;
        name: string;
        amount_minor: number;
        currency: string;
      }[];
    }[];
    legs: { from_step_id: string; to_step_id: string; duration_seconds: number }[];
  } | null;
};

describe("POST /v1/plans/{planId}/steps/{stepId}/swap", () => {
  it("replaces the step place from a stored alternative, refreshes touching legs and fairness, deletes that step's signals, and rebuilds that step's alternatives from the remaining pool", async () => {
    const seeded = await seedProposedPlan();
    const captured: string[] = [];
    setGoogleClientOptions({
      apiKey: "test-routes-key",
      fetch: routesFetch(captured, "ok"),
    });

    const response = await swapPost(seeded.planId, seeded.dinnerId, DINNER_B.id, {
      cookie: `hp_session=${seeded.organizerToken}`,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as OrganizerProposalBody;
    expect(body.state).toBe("proposed");
    expect(body.block).toBeNull();
    expect(body.proposal).not.toBeNull();
    expect(body.proposal?.time).toEqual({
      local_date: "2026-10-02",
      local_time: "18:30",
      timezone: "Africa/Cairo",
    });
    expect(body.proposal?.fairness_warning).toBe(false);
    expect(body.proposal?.cohort_size).toBe(2);
    const dinner = body.proposal?.steps.find((step) => step.step_id === seeded.dinnerId);
    const coffee = body.proposal?.steps.find((step) => step.step_id === seeded.coffeeId);
    expect(dinner).toMatchObject({
      name: "Dinner",
      option_label: "Koshary",
      place: { name: DINNER_B.name, amount_minor: DINNER_B.amount, currency: "EGP" },
      like_count: 0,
      dislike_count: 0,
    });
    expect(dinner).not.toHaveProperty("my_signal");
    expect(dinner?.alternatives.map((alt) => alt.google_place_id)).toEqual([
      DINNER_A.id,
      DINNER_C.id,
      DINNER_D.id,
    ]);
    expect(dinner?.alternatives).toHaveLength(3);
    expect(coffee).toMatchObject({
      name: "Coffee",
      option_label: "Turkish",
      place: { name: COFFEE_A.name, amount_minor: COFFEE_A.amount, currency: "EGP" },
      like_count: 1,
      dislike_count: 0,
    });
    expect(coffee?.alternatives).toEqual([
      {
        google_place_id: COFFEE_B.id,
        name: COFFEE_B.name,
        amount_minor: COFFEE_B.amount,
        currency: "EGP",
      },
    ]);
    expect(body.proposal?.legs).toEqual([
      {
        from_step_id: seeded.dinnerId,
        to_step_id: seeded.coffeeId,
        duration_seconds: ROUTED_SECONDS,
      },
    ]);
    expectFakeRoutesOnly(captured);

    const after = await snapshot(seeded.planId);
    expect(after.proposal?.local_time).toBe("18:30");
    expect(
      after.signals.filter((row) => row.step_id === seeded.dinnerId),
    ).toEqual([]);
    expect(
      after.signals.filter((row) => row.step_id === seeded.coffeeId),
    ).toEqual([
      {
        step_id: seeded.coffeeId,
        participant_id: seeded.nour.id,
        signal: "like",
      },
    ]);

    const cohortGet = await getProposal(
      new Request(`http://localhost/v1/plans/${seeded.planId}/proposal`, {
        headers: { cookie: `hp_session=${seeded.nour.token}` },
      }),
      { params: Promise.resolve({ planId: seeded.planId }) },
    );
    expect(cohortGet.status).toBe(200);
    const cohortBody = (await cohortGet.json()) as {
      proposal: {
        steps: { step_id: string; my_signal?: string }[];
      };
    };
    const cohortDinner = cohortBody.proposal.steps.find(
      (step) => step.step_id === seeded.dinnerId,
    );
    expect(cohortDinner?.my_signal).toBe("unset");
  });

  it("leaves time and other steps' places and alternative lists unchanged and does not call Places", async () => {
    const seeded = await seedProposedPlan();
    const before = await snapshot(seeded.planId);
    const captured: string[] = [];
    setGoogleClientOptions({
      apiKey: "test-routes-key",
      fetch: routesFetch(captured, "ok"),
    });

    const response = await swapPost(seeded.planId, seeded.dinnerId, DINNER_B.id, {
      cookie: `hp_session=${seeded.organizerToken}`,
    });
    expect(response.status).toBe(200);
    const after = await snapshot(seeded.planId);
    expect(after.proposal?.local_date).toBe(before.proposal?.local_date);
    expect(after.proposal?.local_time).toBe("18:30");
    const coffeeBefore = before.steps.find((row) => row.step_id === seeded.coffeeId);
    const coffeeAfter = after.steps.find((row) => row.step_id === seeded.coffeeId);
    expect(coffeeAfter).toEqual(coffeeBefore);
    expect(after.alts.filter((row) => row.step_id === seeded.coffeeId)).toEqual(
      before.alts.filter((row) => row.step_id === seeded.coffeeId),
    );
    expectFakeRoutesOnly(captured);
    expect(captured.length).toBeGreaterThan(0);
  });

  it("returns 409 not_an_alternative for a place that is not one of that step's alternatives and leaves the proposal unchanged", async () => {
    const seeded = await seedProposedPlan();
    const before = await snapshot(seeded.planId);
    const captured: string[] = [];
    setGoogleClientOptions({
      apiKey: "test-routes-key",
      fetch: routesFetch(captured, "ok"),
    });

    const leftover = await swapPost(seeded.planId, seeded.dinnerId, DINNER_E.id, {
      cookie: `hp_session=${seeded.organizerToken}`,
    });
    expect(leftover.status).toBe(409);
    expect(await leftover.json()).toEqual({
      error: {
        code: "conflict",
        reason: "not_an_alternative",
        message: "place is not an alternative",
        fields: [],
      },
    });
    expect(captured).toEqual([]);

    const current = await swapPost(seeded.planId, seeded.dinnerId, DINNER_A.id, {
      cookie: `hp_session=${seeded.organizerToken}`,
    });
    expect(current.status).toBe(409);
    expect(await current.json()).toMatchObject({
      error: { reason: "not_an_alternative" },
    });

    const unknown = await swapPost(seeded.planId, seeded.dinnerId, "ChIJ-unknown", {
      cookie: `hp_session=${seeded.organizerToken}`,
    });
    expect(unknown.status).toBe(409);
    expect(await unknown.json()).toMatchObject({
      error: { reason: "not_an_alternative" },
    });

    expect(await snapshot(seeded.planId)).toEqual(before);
    expect(captured).toEqual([]);
  });

  it("returns 409 route_unavailable when a touched leg cannot be routed and leaves the previous place, legs, signals, and alternatives", async () => {
    const seeded = await seedProposedPlan();
    const before = await snapshot(seeded.planId);
    const captured: string[] = [];
    setGoogleClientOptions({
      apiKey: "test-routes-key",
      fetch: routesFetch(captured, "fail_new_leg"),
    });

    const response = await swapPost(seeded.planId, seeded.dinnerId, DINNER_B.id, {
      cookie: `hp_session=${seeded.organizerToken}`,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "conflict",
        reason: "route_unavailable",
        message: "route is unavailable",
        fields: [],
      },
    });
    expect(await snapshot(seeded.planId)).toEqual(before);
    expectFakeRoutesOnly(captured);
  });

  it("after a successful swap, like_count and dislike_count are 0 and a cohort member's my_signal on that step is unset", async () => {
    const seeded = await seedProposedPlan();
    const captured: string[] = [];
    setGoogleClientOptions({
      apiKey: "test-routes-key",
      fetch: routesFetch(captured, "ok"),
    });

    const response = await swapPost(seeded.planId, seeded.dinnerId, DINNER_B.id, {
      cookie: `hp_session=${seeded.organizerToken}`,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as OrganizerProposalBody;
    const dinner = body.proposal?.steps.find((step) => step.step_id === seeded.dinnerId);
    expect(dinner?.like_count).toBe(0);
    expect(dinner?.dislike_count).toBe(0);
    expect(dinner).not.toHaveProperty("my_signal");

    const cohortGet = await getProposal(
      new Request(`http://localhost/v1/plans/${seeded.planId}/proposal`, {
        headers: { cookie: `hp_session=${seeded.nour.token}` },
      }),
      { params: Promise.resolve({ planId: seeded.planId }) },
    );
    const cohortBody = (await cohortGet.json()) as {
      proposal: { steps: { step_id: string; my_signal?: string }[] };
    };
    expect(
      cohortBody.proposal.steps.find((step) => step.step_id === seeded.dinnerId)
        ?.my_signal,
    ).toBe("unset");
    expectFakeRoutesOnly(captured);
  });

  it("refreshes fairness_warning from the new member start and between-place trips", async () => {
    const seeded = await seedProposedPlan();
    const captured: string[] = [];
    setGoogleClientOptions({
      apiKey: "test-routes-key",
      fetch: routesFetch(captured, "unfair"),
    });

    const response = await swapPost(seeded.planId, seeded.dinnerId, DINNER_B.id, {
      cookie: `hp_session=${seeded.organizerToken}`,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as OrganizerProposalBody;
    expect(body.proposal?.fairness_warning).toBe(true);
    const after = await snapshot(seeded.planId);
    expect(after.proposal?.fairness_warning).toBe(true);
    expectFakeRoutesOnly(captured);
  });

  it("a stranger gets 404 with the envelope only; a non-organizer who can know the plan gets 403 organizer_only; missing X-HP-Request: 1 returns 403 csrf and writes nothing; a non-proposed or locked plan does not change", async () => {
    const seeded = await seedProposedPlan();
    const before = await snapshot(seeded.planId);
    const captured: string[] = [];
    setGoogleClientOptions({
      apiKey: "test-routes-key",
      fetch: routesFetch(captured, "ok"),
    });

    const stranger = await swapPost(seeded.planId, seeded.dinnerId, DINNER_B.id, {
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

    const member = await swapPost(seeded.planId, seeded.dinnerId, DINNER_B.id, {
      cookie: `hp_session=${seeded.nour.token}`,
    });
    expect(member.status).toBe(403);
    expect(await member.json()).toEqual({
      error: {
        code: "forbidden",
        reason: "organizer_only",
        message: "organizer only",
        fields: [],
      },
    });

    const extra = await swapPost(seeded.planId, seeded.dinnerId, DINNER_B.id, {
      cookie: `hp_session=${seeded.extra.token}`,
    });
    expect(extra.status).toBe(403);
    expect(await extra.json()).toMatchObject({
      error: { reason: "organizer_only" },
    });

    const csrf = await swapPost(seeded.planId, seeded.dinnerId, DINNER_B.id, {
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
    expect(await snapshot(seeded.planId)).toEqual(before);
    expect(captured).toEqual([]);

    await sql`UPDATE plans SET state = 'collecting' WHERE id = ${seeded.planId}`;
    const collecting = await swapPost(seeded.planId, seeded.dinnerId, DINNER_B.id, {
      cookie: `hp_session=${seeded.organizerToken}`,
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
    await sql`UPDATE plans SET state = 'proposed' WHERE id = ${seeded.planId}`;
    expect(await snapshot(seeded.planId)).toEqual(before);

    await sql`
      UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${seeded.planId}
    `;
    const locked = await swapPost(seeded.planId, seeded.dinnerId, DINNER_B.id, {
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
    const lockedSnap = await snapshot(seeded.planId);
    expect(lockedSnap.steps).toEqual(before.steps);
    expect(lockedSnap.alts).toEqual(before.alts);
    expect(lockedSnap.legs).toEqual(before.legs);
    expect(lockedSnap.signals).toEqual(before.signals);
    expect(captured).toEqual([]);
  });
});
