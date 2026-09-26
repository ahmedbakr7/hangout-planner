import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { resetClock } from "@/server/clock";
import { generateId } from "@/server/ids";
import { PLACES_SEARCH_TEXT_URL, type FetchFn } from "@/server/google/places";
import { ROUTES_MATRIX_URL } from "@/server/google/routes";
import {
  POST as createAccount,
  closeDatabase as closeAccounts,
} from "@/app/api/v1/accounts/route";
import {
  POST as createPlan,
  closeDatabase as closePlans,
} from "@/app/api/v1/plans/route";
import {
  closeDatabase as closeAttempt,
  runProposalAttempt,
  type ProposalAttemptDeps,
} from "./attempt";

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

const START_A = {
  id: "ChIJ-start-a",
  name: "Maadi, Cairo",
  lat: 29.96,
  lng: 31.25,
};
const START_B = {
  id: "ChIJ-start-b",
  name: "Zamalek Garden",
  lat: 30.06,
  lng: 31.22,
};

const DINNER_A = {
  id: "ChIJ-dinner-a",
  name: "Abu Tarek",
  lat: 30.01,
  lng: 31.235,
  units: 120,
  nanos: 0,
};
const DINNER_B = {
  id: "ChIJ-dinner-b",
  name: "Koshary El Tahrir",
  lat: 30.012,
  lng: 31.236,
  units: 90,
  nanos: 0,
};
const DINNER_LEVEL = {
  id: "ChIJ-dinner-level",
  name: "Fancy",
  lat: 30.011,
  lng: 31.234,
};
const DINNER_USD = {
  id: "ChIJ-dinner-usd",
  name: "Dollar Place",
  lat: 30.013,
  lng: 31.237,
};
const DINNER_EXPENSIVE = {
  id: "ChIJ-dinner-exp",
  name: "Too Much",
  lat: 30.014,
  lng: 31.238,
  units: 600,
  nanos: 0,
};
const DINNER_ZERO = {
  id: "ChIJ-dinner-zero",
  name: "Zero Route",
  lat: 29.0,
  lng: 31.0,
  units: 80,
  nanos: 0,
};
const COFFEE_A = {
  id: "ChIJ-coffee-a",
  name: "Cilantro",
  lat: 30.02,
  lng: 31.24,
  units: 40,
  nanos: 0,
};
const COFFEE_B = {
  id: "ChIJ-coffee-b",
  name: "Filter Room",
  lat: 30.021,
  lng: 31.241,
  units: 35,
  nanos: 0,
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
  units?: number;
  nanos?: number;
  currency?: string;
  priceLevelOnly?: boolean;
}) {
  if (place.priceLevelOnly) {
    return {
      id: place.id,
      displayName: { text: place.name },
      location: { latitude: place.lat, longitude: place.lng },
      priceLevel: "PRICE_LEVEL_EXPENSIVE",
    };
  }
  return {
    id: place.id,
    displayName: { text: place.name },
    location: { latitude: place.lat, longitude: place.lng },
    priceRange: {
      startPrice: {
        currencyCode: place.currency ?? "EGP",
        units: place.units ?? 10,
        nanos: place.nanos ?? 0,
      },
      endPrice: { currencyCode: place.currency ?? "EGP", units: 200, nanos: 0 },
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

function googleFetch(
  captured: string[],
  input: {
    byQuery: Record<string, unknown[]>;
    durationSeconds?: (
      origin: { latitude: number; longitude: number },
      destination: { latitude: number; longitude: number },
    ) => number;
  },
): FetchFn {
  const durationSeconds =
    input.durationSeconds ??
    (() => 180);
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
      const places = input.byQuery[body.textQuery ?? ""] ?? [];
      return jsonResponse({ places });
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
          const origin = origins[i];
          const destination = destinations[j];
          const seconds =
            origin && destination ? durationSeconds(origin, destination) : 0;
          elements.push({
            originIndex: i,
            destinationIndex: j,
            status: { code: 0 },
            condition: "ROUTE_EXISTS",
            duration: `${seconds}s`,
          });
        }
      }
      return jsonResponse(elements);
    }
    throw new Error(`unexpected Google URL: ${url}`);
  };
}

function attemptDeps(fetch: FetchFn): ProposalAttemptDeps {
  return { google: { apiKey: "test-places-key", fetch }, languageCode: "en" };
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
  await sql`SELECT pg_advisory_lock(60123)`;
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
    await sql`SELECT pg_advisory_unlock(60123)`;
  }
});

beforeEach(() => {
  process.env.HP_HASH_TEST = "1";
  delete process.env.HP_PROPOSAL_ENABLED;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    throw new Error(`unit tests must not call the network: ${String(input)}`);
  });
});

afterEach(async () => {
  resetClock();
  delete process.env.HP_HASH_TEST;
  if (originalProposalEnabled === undefined) {
    delete process.env.HP_PROPOSAL_ENABLED;
  } else {
    process.env.HP_PROPOSAL_ENABLED = originalProposalEnabled;
  }
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
  init?: { cookie?: string },
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-hp-request": "1",
  };
  if (init?.cookie) {
    headers.cookie = init.cookie;
  }
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: JSON.stringify(body),
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
  const windowId = shape.windows[0]!.id;
  await sql`
    INSERT INTO response_windows (
      participant_id, window_id, kind, earliest_local, latest_local
    ) VALUES (
      ${participantId}, ${windowId}, 'free', '18:00', '19:00'
    )
  `;
  await sql`
    INSERT INTO response_picks (participant_id, step_id, option_id) VALUES
      (${participantId}, ${shape.steps[0]!.id}, ${optionFor(shape, "Dinner", "Koshary")}),
      (${participantId}, ${shape.steps[1]!.id}, ${optionFor(shape, "Coffee", "Turkish")})
  `;
}

async function setAnswered(planId: string, count: number): Promise<void> {
  await sql`UPDATE plans SET answered_count = ${count} WHERE id = ${planId}`;
}

const defaultPlaces = {
  Koshary: [
    venuePlace({ ...DINNER_A, units: DINNER_A.units }),
    venuePlace({ ...DINNER_B, units: DINNER_B.units }),
    venuePlace({ ...DINNER_LEVEL, priceLevelOnly: true }),
    venuePlace({ ...DINNER_USD, currency: "USD", units: 20 }),
    venuePlace({ ...DINNER_EXPENSIVE, units: DINNER_EXPENSIVE.units }),
  ],
  Turkish: [
    venuePlace({ ...COFFEE_A, units: COFFEE_A.units }),
    venuePlace({ ...COFFEE_B, units: COFFEE_B.units }),
  ],
};

function defaultDuration(
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
): number {
  if (origin.latitude === DINNER_ZERO.lat || destination.latitude === DINNER_ZERO.lat) {
    return 0;
  }
  return 180;
}

async function seedTwoMemberPlan(): Promise<{
  planId: string;
  shape: PlanShape;
  nourId: string;
  ziadId: string;
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
  await setAnswered(plan.id, 2);
  return { planId: plan.id, shape, nourId, ziadId };
}

describe("runProposalAttempt", () => {
  it("an empty cohort stores no proposal and finishes blocked with time true, budget false, venue_data false, and no Google calls", async () => {
    const organizer = await register(track(uniqueEmail("org")), "Omar");
    const member = await register(track(uniqueEmail("member")), "Nour");
    const plan = await openPlan(organizer.token, { threshold: 1 });
    await seedAccountParticipant(plan.id, member.account.id, "Nour", "a3k9");
    const captured: string[] = [];
    const fetch = googleFetch(captured, { byQuery: defaultPlaces });

    const result = await runProposalAttempt(plan.id, attemptDeps(fetch));
    expect(result).toEqual({
      status: "blocked",
      block: { time: true, budget: false, venue_data: false },
    });
    expect(captured).toEqual([]);

    const state = await sql<{ state: string }[]>`
      SELECT state FROM plans WHERE id = ${plan.id}
    `;
    expect(state[0]?.state).toBe("blocked");
    const proposal = await sql<{ id: string }[]>`
      SELECT id FROM proposals WHERE plan_id = ${plan.id}
    `;
    expect(proposal).toEqual([]);
    const runs = await sql<
      {
        outcome: string;
        block_time: boolean;
        block_budget: boolean;
        block_venue_data: boolean;
      }[]
    >`
      SELECT outcome, block_time, block_budget, block_venue_data
      FROM proposal_runs WHERE plan_id = ${plan.id}
    `;
    expect(runs).toEqual([
      {
        outcome: "blocked",
        block_time: true,
        block_budget: false,
        block_venue_data: false,
      },
    ]);
  });

  it("drops a place with only priceLevel, a price in another currency, or an amount outside 1 through the plan budget; amount_minor uses the integer startPrice rule", async () => {
    const { planId } = await seedTwoMemberPlan();
    const captured: string[] = [];
    const fetch = googleFetch(captured, {
      byQuery: defaultPlaces,
      durationSeconds: defaultDuration,
    });

    const result = await runProposalAttempt(planId, attemptDeps(fetch));
    expect(result).toEqual({ status: "proposed" });
    expect(captured.length).toBeGreaterThan(0);
    expect(
      captured.every(
        (url) => url === PLACES_SEARCH_TEXT_URL || url === ROUTES_MATRIX_URL,
      ),
    ).toBe(true);

    const candidates = await sql<{ google_place_id: string; amount_minor: number }[]>`
      SELECT google_place_id, amount_minor
      FROM proposal_candidates
      WHERE proposal_id IN (SELECT id FROM proposals WHERE plan_id = ${planId})
      ORDER BY google_place_id
    `;
    const ids = candidates.map((row) => row.google_place_id);
    expect(ids).toContain(DINNER_A.id);
    expect(ids).toContain(DINNER_B.id);
    expect(ids).toContain(COFFEE_A.id);
    expect(ids).toContain(COFFEE_B.id);
    expect(ids).not.toContain(DINNER_LEVEL.id);
    expect(ids).not.toContain(DINNER_USD.id);
    expect(ids).not.toContain(DINNER_EXPENSIVE.id);
    expect(
      Number(
        candidates.find((row) => row.google_place_id === DINNER_B.id)?.amount_minor,
      ),
    ).toBe(90 * 100 + 0 / 10_000_000);
    expect(
      Number(
        candidates.find((row) => row.google_place_id === DINNER_A.id)?.amount_minor,
      ),
    ).toBe(120 * 100);
  });

  it("does not store a duration under 1 second; a full proposal has one leg between each consecutive pair with duration_seconds at least 1", async () => {
    const { planId } = await seedTwoMemberPlan();
    const captured: string[] = [];
    const fetch = googleFetch(captured, {
      byQuery: {
        Koshary: [
          venuePlace({ ...DINNER_ZERO, units: DINNER_ZERO.units }),
          venuePlace({ ...DINNER_A, units: DINNER_A.units }),
        ],
        Turkish: [venuePlace({ ...COFFEE_A, units: COFFEE_A.units })],
      },
      durationSeconds: defaultDuration,
    });

    const result = await runProposalAttempt(planId, attemptDeps(fetch));
    expect(result).toEqual({ status: "proposed" });

    const steps = await sql<{ google_place_id: string }[]>`
      SELECT google_place_id
      FROM proposal_steps
      WHERE proposal_id IN (SELECT id FROM proposals WHERE plan_id = ${planId})
      ORDER BY step_id
    `;
    const placeIds = steps.map((row) => row.google_place_id);
    expect(placeIds).toContain(DINNER_A.id);
    expect(placeIds).not.toContain(DINNER_ZERO.id);
    expect(placeIds).toContain(COFFEE_A.id);

    const legs = await sql<{ duration_seconds: number }[]>`
      SELECT duration_seconds
      FROM proposal_legs
      WHERE proposal_id IN (SELECT id FROM proposals WHERE plan_id = ${planId})
    `;
    expect(legs).toHaveLength(1);
    expect(legs[0]?.duration_seconds).toBeGreaterThanOrEqual(1);
    expect(legs.some((row) => row.duration_seconds < 1)).toBe(false);
  });

  it("writes proposed for a full chain and stores the cohort and the pool", async () => {
    const { planId, nourId, ziadId, shape } = await seedTwoMemberPlan();
    const captured: string[] = [];
    const fetch = googleFetch(captured, {
      byQuery: defaultPlaces,
      durationSeconds: defaultDuration,
    });

    const result = await runProposalAttempt(planId, attemptDeps(fetch));
    expect(result).toEqual({ status: "proposed" });

    const plan = await sql<{ state: string }[]>`
      SELECT state FROM plans WHERE id = ${planId}
    `;
    expect(plan[0]?.state).toBe("proposed");
    const proposal = await sql<
      { id: string; local_date: string; local_time: string }[]
    >`
      SELECT id, local_date, local_time FROM proposals WHERE plan_id = ${planId}
    `;
    expect(proposal).toHaveLength(1);
    const localDate = proposal[0]?.local_date;
    const localDateText =
      localDate instanceof Date
        ? localDate.toISOString().slice(0, 10)
        : String(localDate).slice(0, 10);
    expect(localDateText).toBe("2026-10-02");
    expect(proposal[0]?.local_time).toBe("18:00");

    const cohort = await sql<
      { participant_id: string; attending: boolean }[]
    >`
      SELECT participant_id, attending FROM proposal_cohort
      WHERE proposal_id = ${proposal[0]!.id}
      ORDER BY participant_id
    `;
    expect(cohort).toHaveLength(2);
    expect(cohort.map((row) => row.participant_id).sort()).toEqual(
      [nourId, ziadId].sort(),
    );
    expect(cohort.every((row) => row.attending)).toBe(true);

    const pool = await sql<{ google_place_id: string; step_id: string }[]>`
      SELECT google_place_id, step_id FROM proposal_candidates
      WHERE proposal_id = ${proposal[0]!.id}
    `;
    expect(pool.length).toBeGreaterThanOrEqual(2);
    const dinnerPool = pool.filter((row) => row.step_id === shape.steps[0]!.id);
    const coffeePool = pool.filter((row) => row.step_id === shape.steps[1]!.id);
    expect(dinnerPool.map((row) => row.google_place_id).sort()).toEqual(
      [DINNER_A.id, DINNER_B.id].sort(),
    );
    expect(coffeePool.map((row) => row.google_place_id).sort()).toEqual(
      [COFFEE_A.id, COFFEE_B.id].sort(),
    );

    const storedSteps = await sql<{ step_id: string }[]>`
      SELECT step_id FROM proposal_steps WHERE proposal_id = ${proposal[0]!.id}
    `;
    expect(storedSteps).toHaveLength(2);
    const legs = await sql<{ duration_seconds: number }[]>`
      SELECT duration_seconds FROM proposal_legs WHERE proposal_id = ${proposal[0]!.id}
    `;
    expect(legs).toHaveLength(1);
    expect(legs[0]?.duration_seconds).toBeGreaterThanOrEqual(1);

    const runs = await sql<{ outcome: string }[]>`
      SELECT outcome FROM proposal_runs WHERE plan_id = ${planId}
    `;
    expect(runs).toEqual([{ outcome: "proposed" }]);
  });

  it("HP_PROPOSAL_ENABLED=0 skips Google and finishes as venue_data with the other two flags false for the parts that did not finish", async () => {
    const { planId } = await seedTwoMemberPlan();
    process.env.HP_PROPOSAL_ENABLED = "0";
    const captured: string[] = [];
    const fetch = googleFetch(captured, { byQuery: defaultPlaces });

    const result = await runProposalAttempt(planId, attemptDeps(fetch));
    expect(result).toEqual({
      status: "blocked",
      block: { time: false, budget: false, venue_data: true },
    });
    expect(captured).toEqual([]);

    const state = await sql<{ state: string }[]>`
      SELECT state FROM plans WHERE id = ${planId}
    `;
    expect(state[0]?.state).toBe("blocked");
    const proposal = await sql<{ id: string }[]>`
      SELECT id FROM proposals WHERE plan_id = ${planId}
    `;
    expect(proposal).toEqual([]);
    const runs = await sql<
      {
        outcome: string;
        block_time: boolean;
        block_budget: boolean;
        block_venue_data: boolean;
      }[]
    >`
      SELECT outcome, block_time, block_budget, block_venue_data
      FROM proposal_runs WHERE plan_id = ${planId}
    `;
    expect(runs).toEqual([
      {
        outcome: "blocked",
        block_time: false,
        block_budget: false,
        block_venue_data: true,
      },
    ]);
  });
});
