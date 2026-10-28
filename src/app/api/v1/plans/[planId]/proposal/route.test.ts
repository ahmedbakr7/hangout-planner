import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { resetClock } from "@/server/clock";
import { generateCookieToken, hashCookieToken } from "@/server/auth/session";
import { generateId } from "@/server/ids";
import { PLACES_SEARCH_TEXT_URL, type FetchFn } from "@/server/google/places";
import { ROUTES_MATRIX_URL } from "@/server/google/routes";
import {
  closeDatabase as closeAttempt,
  runProposalAttempt,
} from "@/server/proposal/attempt";
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

function googleFetch(captured: string[]): FetchFn {
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
  await sql`SELECT pg_advisory_lock(60124)`;
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
    await sql`SELECT pg_advisory_unlock(60124)`;
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

function proposalGet(planId: string, cookie?: string) {
  const headers: Record<string, string> = {};
  if (cookie) {
    headers.cookie = cookie;
  }
  return GET(new Request(`http://localhost/v1/plans/${planId}/proposal`, { headers }), {
    params: Promise.resolve({ planId }),
  });
}

type StepJson = {
  step_id: string;
  name: string;
  option_label: string;
  place: { name: string; amount_minor: number; currency: string };
  like_count?: number;
  dislike_count?: number;
  my_signal?: string;
  alternatives?: unknown[];
};

type ProposalGetBody = {
  state: string;
  block: { time: boolean; budget: boolean; venue_data: boolean } | null;
  proposal: {
    time: { local_date: string; local_time: string; timezone: string };
    attending_count: number;
    cohort_size: number;
    cohort: { display_name: string; distinguisher: string; attending: boolean }[];
    fairness_warning: boolean;
    steps: StepJson[];
    legs: { from_step_id: string; to_step_id: string; duration_seconds: number }[];
  } | null;
};

describe("GET /v1/plans/{planId}/proposal", () => {
  it("T-001-39/AC-1 returns the organizer collecting and blocked shapes, and the organizer and participant proposed shapes from the contract", async () => {
    const organizer = await register(track(uniqueEmail("org")), "Omar");
    const nour = await register(track(uniqueEmail("nour")), "Nour");
    const ziad = await register(track(uniqueEmail("ziad")), "Ziad");
    const extra = await register(track(uniqueEmail("extra")), "Hana");
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
    await seedAccountParticipant(plan.id, extra.account.id, "Hana", "k7m2");
    const orgCookie = `hp_session=${organizer.token}`;

    const collecting = await proposalGet(plan.id, orgCookie);
    expect(collecting.status).toBe(200);
    expect(await collecting.json()).toEqual({
      state: "collecting",
      block: null,
      proposal: null,
    });

    const captured: string[] = [];
    const shape = await planShape(plan.id);
    await seedComplete(plan.id, nourId, START_A, shape);
    await seedComplete(plan.id, ziadId, START_B, shape);
    await sql`UPDATE plans SET answered_count = 2 WHERE id = ${plan.id}`;
    const proposed = await runProposalAttempt(plan.id, {
      google: { apiKey: "test-places-key", fetch: googleFetch(captured) },
      languageCode: "en",
    });
    expect(proposed).toEqual({ status: "proposed" });
    expect(
      captured.every(
        (url) => url === PLACES_SEARCH_TEXT_URL || url === ROUTES_MATRIX_URL,
      ),
    ).toBe(true);

    const proposalIdRows = await sql<{ id: string }[]>`
      SELECT id FROM proposals WHERE plan_id = ${plan.id}
    `;
    const dinnerStep = shape.steps[0]!;
    await sql`
      INSERT INTO step_signals (proposal_id, step_id, participant_id, signal)
      VALUES (${proposalIdRows[0]!.id}, ${dinnerStep.id}, ${nourId}, 'like')
    `;
    await sql`
      INSERT INTO step_signals (proposal_id, step_id, participant_id, signal)
      VALUES (${proposalIdRows[0]!.id}, ${dinnerStep.id}, ${ziadId}, 'dislike')
    `;

    const organizerProposed = await proposalGet(plan.id, orgCookie);
    expect(organizerProposed.status).toBe(200);
    const organizerBody = (await organizerProposed.json()) as ProposalGetBody;
    expect(organizerBody.state).toBe("proposed");
    expect(organizerBody.block).toBeNull();
    expect(organizerBody.proposal).not.toBeNull();
    expect(organizerBody.proposal?.time).toEqual({
      local_date: "2026-10-02",
      local_time: "18:00",
      timezone: "Africa/Cairo",
    });
    expect(organizerBody.proposal?.cohort_size).toBe(2);
    expect(organizerBody.proposal?.attending_count).toBe(2);
    expect(organizerBody.proposal?.cohort).toEqual(
      expect.arrayContaining([
        { display_name: "Nour", distinguisher: "a3k9", attending: true },
        { display_name: "Ziad", distinguisher: "m2n4", attending: true },
      ]),
    );
    expect(organizerBody.proposal?.legs).toHaveLength(1);
    expect(
      organizerBody.proposal?.legs[0]?.duration_seconds,
    ).toBeGreaterThanOrEqual(1);
    const orgDinner = organizerBody.proposal?.steps.find(
      (step) => step.step_id === dinnerStep.id,
    );
    expect(orgDinner).toMatchObject({
      name: "Dinner",
      option_label: "Koshary",
      like_count: 1,
      dislike_count: 1,
      place: { currency: "EGP" },
    });
    expect(orgDinner).toHaveProperty("alternatives");
    expect(orgDinner).not.toHaveProperty("my_signal");
    expect(Array.isArray(orgDinner?.alternatives)).toBe(true);
    expect((orgDinner?.alternatives?.length ?? 0) <= 3).toBe(true);

    const cohortGet = await proposalGet(plan.id, `hp_session=${nour.token}`);
    expect(cohortGet.status).toBe(200);
    const cohortBody = (await cohortGet.json()) as ProposalGetBody;
    expect(cohortBody.state).toBe("proposed");
    expect(cohortBody.block).toBeNull();
    const cohortDinner = cohortBody.proposal?.steps.find(
      (step) => step.step_id === dinnerStep.id,
    );
    expect(cohortDinner?.my_signal).toBe("like");
    expect(cohortDinner).not.toHaveProperty("alternatives");
    expect(cohortDinner).not.toHaveProperty("like_count");
    expect(cohortDinner).not.toHaveProperty("dislike_count");
    expect(cohortDinner).toMatchObject({
      name: "Dinner",
      option_label: "Koshary",
      place: { currency: "EGP" },
    });

    const otherCohort = await proposalGet(plan.id, `hp_session=${ziad.token}`);
    const otherBody = (await otherCohort.json()) as ProposalGetBody;
    const otherDinner = otherBody.proposal?.steps.find(
      (step) => step.step_id === dinnerStep.id,
    );
    expect(otherDinner?.my_signal).toBe("dislike");
    expect(otherDinner).not.toHaveProperty("alternatives");
    expect(otherDinner).not.toHaveProperty("like_count");

    const visitorGet = await proposalGet(plan.id, `hp_session=${extra.token}`);
    expect(visitorGet.status).toBe(200);
    const visitorBody = (await visitorGet.json()) as ProposalGetBody;
    const visitorDinner = visitorBody.proposal?.steps.find(
      (step) => step.step_id === dinnerStep.id,
    );
    expect(visitorDinner).toMatchObject({
      name: "Dinner",
      option_label: "Koshary",
      place: { currency: "EGP" },
    });
    expect(visitorDinner).not.toHaveProperty("alternatives");
    expect(visitorDinner).not.toHaveProperty("like_count");
    expect(visitorDinner).not.toHaveProperty("dislike_count");
    expect(visitorDinner).not.toHaveProperty("my_signal");
    expect(visitorBody.proposal?.legs).toEqual(organizerBody.proposal?.legs);
  });

  it("T-001-95/AC-4 T-001-23/AC-5 GET proposal returns the contract shapes: alternatives, like_count and dislike_count are organizer-only; a cohort member gets my_signal and no alternatives or counts; a non-cohort participant gets the itinerary without alternatives, counts or my_signal", async () => {
    const organizer = await register(track(uniqueEmail("org")), "Omar");
    const nour = await register(track(uniqueEmail("nour")), "Nour");
    const ziad = await register(track(uniqueEmail("ziad")), "Ziad");
    const hana = await register(track(uniqueEmail("hana")), "Hana");
    const plan = await openPlan(organizer.token);
    const nourId = await seedAccountParticipant(plan.id, nour.account.id, "Nour", "a3k9");
    const ziadId = await seedAccountParticipant(plan.id, ziad.account.id, "Ziad", "m2n4");
    await seedAccountParticipant(plan.id, hana.account.id, "Hana", "k7m2");
    const shape = await planShape(plan.id);
    await seedComplete(plan.id, nourId, START_A, shape);
    await seedComplete(plan.id, ziadId, START_B, shape);
    await sql`UPDATE plans SET answered_count = 2 WHERE id = ${plan.id}`;
    expect(
      await runProposalAttempt(plan.id, {
        google: { apiKey: "test-places-key", fetch: googleFetch([]) },
        languageCode: "en",
      }),
    ).toEqual({ status: "proposed" });
    const proposalId = (await sql<{ id: string }[]>`SELECT id FROM proposals WHERE plan_id = ${plan.id}`)[0]!.id;
    const dinner = shape.steps[0]!.id;
    const coffee = shape.steps[1]!.id;
    await sql`
      INSERT INTO step_signals (proposal_id, step_id, participant_id, signal)
      VALUES (${proposalId}, ${dinner}, ${nourId}, 'like'), (${proposalId}, ${coffee}, ${nourId}, 'dislike')
    `;

    const read = async (token: string) => {
      const response = await proposalGet(plan.id, `hp_session=${token}`);
      expect(response.status).toBe(200);
      return (await response.json()) as ProposalGetBody;
    };
    const org = await read(organizer.token);
    const member = await read(nour.token);
    const quiet = await read(ziad.token);
    const outsider = await read(hana.token);

    const itineraryKeys = ["name", "option_label", "place", "step_id"];
    for (const body of [org, member, quiet, outsider]) {
      expect(Object.keys(body).sort()).toEqual(["block", "proposal", "state"]);
      expect(body.state).toBe("proposed");
      expect(body.block).toBeNull();
      expect(Object.keys(body.proposal!).sort()).toEqual(
        ["attending_count", "cohort", "cohort_size", "fairness_warning", "legs", "steps", "time"].sort(),
      );
    }

    // Organizer: counts and alternatives on every step, no my_signal.
    for (const step of org.proposal!.steps) {
      expect(Object.keys(step).sort()).toEqual(
        [...itineraryKeys, "alternatives", "dislike_count", "like_count"].sort(),
      );
      for (const alternative of step.alternatives as Record<string, unknown>[]) {
        expect(Object.keys(alternative).sort()).toEqual(
          ["amount_minor", "currency", "google_place_id", "name"].sort(),
        );
      }
    }
    const orgByStep = new Map(org.proposal!.steps.map((step) => [step.step_id, step]));
    expect(orgByStep.get(dinner)).toMatchObject({ like_count: 1, dislike_count: 0 });
    expect(orgByStep.get(coffee)).toMatchObject({ like_count: 0, dislike_count: 1 });
    expect(orgByStep.get(dinner)!.alternatives).toEqual([
      expect.objectContaining({ currency: "EGP" }),
    ]);

    // Cohort members: my_signal (like, dislike or unset) and nothing organizer-only.
    for (const body of [member, quiet]) {
      for (const step of body.proposal!.steps) {
        expect(Object.keys(step).sort()).toEqual([...itineraryKeys, "my_signal"].sort());
      }
    }
    const signals = (body: ProposalGetBody) =>
      Object.fromEntries(body.proposal!.steps.map((step) => [step.step_id, step.my_signal]));
    expect(signals(member)).toEqual({ [dinner]: "like", [coffee]: "dislike" });
    expect(signals(quiet)).toEqual({ [dinner]: "unset", [coffee]: "unset" });

    // Non-cohort participant: the itinerary only.
    for (const step of outsider.proposal!.steps) {
      expect(Object.keys(step).sort()).toEqual(itineraryKeys);
    }

    // Everyone sees the same itinerary.
    const itinerary = (body: ProposalGetBody) => ({
      ...body.proposal!,
      steps: body.proposal!.steps.map((step) => ({
        step_id: step.step_id,
        name: step.name,
        option_label: step.option_label,
        place: step.place,
      })),
    });
    for (const body of [member, quiet, outsider]) {
      expect(itinerary(body)).toEqual(itinerary(org));
    }
  });

  it("T-001-39/AC-1 an invited account, a link reader and an unknown plan get 404 with the envelope only", async () => {
    const organizer = await register(track(uniqueEmail("org")), "Omar");
    const invited = await register(track(uniqueEmail("invited")), "Hana");
    const plan = await openPlan(organizer.token);
    await sql`
      INSERT INTO invitations (id, plan_id, account_id, distinguisher)
      VALUES (${generateId("inv_")}, ${plan.id}, ${invited.account.id}, 'k7m2')
    `;
    const linkToken = generateCookieToken();
    const linkId = `lnk_${randomBytes(8).toString("hex")}`;
    await sql`
      INSERT INTO link_sessions (id, token_hash, expires_at)
      VALUES (${linkId}, ${hashCookieToken(linkToken)}, ${new Date("2099-01-01T00:00:00.000Z")})
    `;
    await sql`INSERT INTO link_session_plans (link_session_id, plan_id) VALUES (${linkId}, ${plan.id})`;

    const notFound = {
      error: { code: "not_found", message: "plan not found", fields: [] },
    };
    const inviteRes = await proposalGet(plan.id, `hp_session=${invited.token}`);
    expect(inviteRes.status).toBe(404);
    expect(await inviteRes.json()).toEqual(notFound);
    const linkRes = await proposalGet(plan.id, `hp_link=${linkToken}`);
    expect(linkRes.status).toBe(404);
    expect(await linkRes.json()).toEqual(notFound);
    const unknown = await proposalGet(
      generateId("pln_"),
      `hp_session=${organizer.token}`,
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual(notFound);

    await sql`DELETE FROM link_session_plans WHERE link_session_id = ${linkId}`;
    await sql`DELETE FROM link_sessions WHERE id = ${linkId}`;
  });

  it("T-001-39/AC-1 a participant while collecting or blocked gets 409 not_proposed; locked is 409 plan_locked; a stranger gets 404 with the envelope only", async () => {
    const organizer = await register(track(uniqueEmail("org")), "Omar");
    const member = await register(track(uniqueEmail("member")), "Nour");
    const stranger = await register(track(uniqueEmail("stranger")), "Ziad");
    const plan = await openPlan(organizer.token, { threshold: 1 });
    const memberId = await seedAccountParticipant(
      plan.id,
      member.account.id,
      "Nour",
      "a3k9",
    );
    const memberCookie = `hp_session=${member.token}`;
    const orgCookie = `hp_session=${organizer.token}`;

    const collecting = await proposalGet(plan.id, memberCookie);
    expect(collecting.status).toBe(409);
    expect(await collecting.json()).toEqual({
      error: {
        code: "conflict",
        reason: "not_proposed",
        message: "proposal is not available",
        fields: [],
      },
    });

    const captured: string[] = [];
    const blocked = await runProposalAttempt(plan.id, {
      google: { apiKey: "test-places-key", fetch: googleFetch(captured) },
      languageCode: "en",
    });
    expect(blocked).toEqual({
      status: "blocked",
      block: { time: true, budget: false, venue_data: false },
    });
    expect(captured).toEqual([]);

    const organizerBlocked = await proposalGet(plan.id, orgCookie);
    expect(organizerBlocked.status).toBe(200);
    expect(await organizerBlocked.json()).toEqual({
      state: "blocked",
      block: { time: true, budget: false, venue_data: false },
      proposal: null,
    });

    const participantBlocked = await proposalGet(plan.id, memberCookie);
    expect(participantBlocked.status).toBe(409);
    expect(await participantBlocked.json()).toMatchObject({
      error: { code: "conflict", reason: "not_proposed", fields: [] },
    });

    const shape = await planShape(plan.id);
    await seedComplete(plan.id, memberId, START_A, shape);
    await sql`UPDATE plans SET answered_count = 1, state = 'collecting' WHERE id = ${plan.id}`;
    const proposed = await runProposalAttempt(plan.id, {
      google: { apiKey: "test-places-key", fetch: googleFetch([]) },
      languageCode: "en",
    });
    expect(proposed).toEqual({ status: "proposed" });

    await sql`UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${plan.id}`;
    const lockedOrg = await proposalGet(plan.id, orgCookie);
    expect(lockedOrg.status).toBe(409);
    expect(await lockedOrg.json()).toEqual({
      error: {
        code: "conflict",
        reason: "plan_locked",
        message: "plan is locked",
        fields: [],
      },
    });
    const lockedMember = await proposalGet(plan.id, memberCookie);
    expect(lockedMember.status).toBe(409);
    expect(await lockedMember.json()).toMatchObject({
      error: { reason: "plan_locked" },
    });

    const strangerRes = await proposalGet(plan.id, `hp_session=${stranger.token}`);
    expect(strangerRes.status).toBe(404);
    const strangerBody = (await strangerRes.json()) as {
      error: Record<string, unknown>;
    };
    expect(Object.keys(strangerBody)).toEqual(["error"]);
    expect(strangerBody).toEqual({
      error: {
        code: "not_found",
        message: "plan not found",
        fields: [],
      },
    });

    const anonymous = await proposalGet(plan.id);
    expect(anonymous.status).toBe(404);
    expect(await anonymous.json()).toEqual({
      error: {
        code: "not_found",
        message: "plan not found",
        fields: [],
      },
    });
  });
});
