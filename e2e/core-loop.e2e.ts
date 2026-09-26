/**
 * T-001-29 — core loop e2e
 * Covers: account → create in EGP → copy path → anonymous join →
 * complete response → proposal → swap → signal → lock →
 * confirmed read on the share link.
 */
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import postgres from "postgres";
import { resetClock } from "@/server/clock";
import { isJoinToken } from "@/server/ids";
import {
  PLACES_SEARCH_TEXT_URL,
  type FetchFn,
} from "@/server/google/places";
import { ROUTES_MATRIX_URL } from "@/server/google/routes";
import { closeDatabase as closeAttempt } from "@/server/proposal/attempt";
import {
  POST as createAccount,
  closeDatabase as closeAccounts,
} from "@/app/api/v1/accounts/route";
import {
  POST as createPlan,
  closeDatabase as closePlans,
} from "@/app/api/v1/plans/route";
import {
  PATCH as patchPlan,
  setProposalAttemptGoogleOptions,
} from "@/app/api/v1/plans/[planId]/route";
import {
  GET as joinGet,
  POST as joinPost,
  closeDatabase as closeJoin,
} from "@/app/api/v1/join/[token]/route";
import {
  PUT as putResponse,
  setGoogleClientOptions as setResponseGoogle,
} from "@/app/api/v1/plans/[planId]/response/route";
import { GET as getProposal } from "@/app/api/v1/plans/[planId]/proposal/route";
import {
  POST as swapPost,
  setGoogleClientOptions as setSwapGoogle,
} from "@/app/api/v1/plans/[planId]/steps/[stepId]/swap/route";
import { PUT as signalPut } from "@/app/api/v1/plans/[planId]/steps/[stepId]/signal/route";
import { POST as lockPost } from "@/app/api/v1/plans/[planId]/lock/route";
import { GET as getConfirmed } from "@/app/api/v1/plans/[planId]/confirmed/route";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const migrationPath = resolve(process.cwd(), "drizzle/0001_init.sql");
const LOCK_KEY = 60129;

const sql = postgres(databaseUrl, {
  max: 1,
  idle_timeout: 0,
  connect_timeout: 10,
  onnotice: () => {},
});

const createdEmails: string[] = [];
const originalProposalEnabled = process.env.HP_PROPOSAL_ENABLED;

const startCafe = {
  id: "ChIJ-start",
  displayName: { text: "Maadi, Cairo" },
  location: { latitude: 29.96, longitude: 31.25 },
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

function waypointLatLng(
  value: unknown,
): { latitude: number; longitude: number } | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const latLng = (
    value as {
      waypoint?: { location?: { latLng?: { latitude?: unknown; longitude?: unknown } } };
    }
  ).waypoint?.location?.latLng;
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

function detailsFetch(place: unknown): FetchFn {
  return async () => jsonResponse(place);
}

function routesOnlyFetch(captured: string[]): FetchFn {
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
        elements.push({
          originIndex: i,
          destinationIndex: j,
          status: { code: 0 },
          condition: "ROUTE_EXISTS",
          duration: "240s",
        });
      }
    }
    return jsonResponse(elements);
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
    body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(body),
  });
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
    threshold: 1,
    ...overrides,
  };
}

async function register(email: string, displayName = "Omar") {
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

function completeBody(shape: PlanShape) {
  return {
    windows: [
      {
        window_id: shape.windows[0]!.id,
        kind: "free",
        earliest_local: "18:00",
        latest_local: "19:00",
      },
    ],
    start_place_id: startCafe.id,
    picks: [
      {
        step_id: shape.steps[0]!.id,
        option_id: optionFor(shape, "Dinner", "Koshary"),
      },
      {
        step_id: shape.steps[1]!.id,
        option_id: optionFor(shape, "Coffee", "Turkish"),
      },
    ],
  };
}

beforeAll(async () => {
  await sql`SELECT pg_advisory_lock(${LOCK_KEY})`;
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
    await sql`SELECT pg_advisory_unlock(${LOCK_KEY})`;
  }
});

beforeEach(() => {
  process.env.HP_HASH_TEST = "1";
  delete process.env.HP_PROPOSAL_ENABLED;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    throw new Error(`e2e must not call the network: ${String(input)}`);
  });
  setResponseGoogle({
    apiKey: "test-places-key",
    fetch: detailsFetch(startCafe),
  });
  setProposalAttemptGoogleOptions(undefined);
  setSwapGoogle(undefined);
});

afterEach(async () => {
  resetClock();
  delete process.env.HP_HASH_TEST;
  if (originalProposalEnabled === undefined) {
    delete process.env.HP_PROPOSAL_ENABLED;
  } else {
    process.env.HP_PROPOSAL_ENABLED = originalProposalEnabled;
  }
  setResponseGoogle(undefined);
  setProposalAttemptGoogleOptions(undefined);
  setSwapGoogle(undefined);
  vi.unstubAllGlobals();
  const emails = createdEmails.splice(0, createdEmails.length);
  for (const email of emails) {
    await forget(email);
  }
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
  await closeAttempt();
  await closeJoin();
  await closePlans();
  await closeAccounts();
});

describe("e2e core loop", () => {
  it("account, create in EGP, copy path, anonymous join, complete response, proposal, swap, signal, lock, and confirmed read on the share link", async () => {
    const organizerEmail = track(uniqueEmail("org"));
    const organizer = await register(organizerEmail, "Omar");

    const create = await createPlan(
      jsonRequest("/v1/plans", "POST", validPlan(), {
        cookie: `hp_session=${organizer.token}`,
      }),
    );
    expect(create.status).toBe(201);
    const plan = (await create.json()) as {
      id: string;
      state: string;
      budget: { amount_minor: number; currency: string };
      join_path: string;
      answered_count: number;
    };
    expect(plan.state).toBe("collecting");
    expect(plan.budget).toEqual({ amount_minor: 50_000, currency: "EGP" });
    expect(plan.answered_count).toBe(0);
    expect(plan.join_path).toMatch(/^\/join\/jt_/);
    const joinToken = plan.join_path.slice("/join/".length);
    expect(isJoinToken(joinToken)).toBe(true);

    const copyPath = plan.join_path;
    expect(copyPath).toBe(`/join/${joinToken}`);

    const anonymous = await joinPost(
      jsonRequest(`/v1/join/${joinToken}`, "POST", {
        kind: "anonymous",
        display_name: "Hana",
      }),
      { params: Promise.resolve({ token: joinToken }) },
    );
    expect(anonymous.status).toBe(201);
    const joined = (await anonymous.json()) as {
      next: string;
      participant: { display_name: string };
    };
    expect(joined.next).toBe("respond");
    expect(joined.participant.display_name).toBe("Hana");
    const guestToken = cookieValue(anonymous, "hp_guest");
    expect(guestToken.length).toBeGreaterThan(8);
    const guestCookie = `hp_guest=${guestToken}`;

    const shape = await planShape(plan.id);
    const capturedAttempt: string[] = [];
    setProposalAttemptGoogleOptions({
      apiKey: "test-places-key",
      fetch: attemptGoogleFetch(capturedAttempt),
    });

    const responded = await putResponse(
      jsonRequest(
        `/v1/plans/${plan.id}/response`,
        "PUT",
        completeBody(shape),
        { cookie: guestCookie },
      ),
      { params: Promise.resolve({ planId: plan.id }) },
    );
    expect(responded.status).toBe(200);
    const responseBody = (await responded.json()) as {
      complete: boolean;
      first_completion: boolean;
      plan_state: string;
    };
    expect(responseBody).toEqual({
      complete: true,
      first_completion: true,
      plan_state: "proposed",
    });

    const proposalRes = await getProposal(
      new Request(`http://localhost/v1/plans/${plan.id}/proposal`, {
        headers: { cookie: `hp_session=${organizer.token}` },
      }),
      { params: Promise.resolve({ planId: plan.id }) },
    );
    expect(proposalRes.status).toBe(200);
    const proposal = (await proposalRes.json()) as {
      state: string;
      proposal: {
        steps: {
          step_id: string;
          name: string;
          place: { name: string };
          alternatives: { google_place_id: string; name: string }[];
        }[];
      } | null;
    };
    expect(proposal.state).toBe("proposed");
    expect(proposal.proposal).not.toBeNull();
    const dinner = proposal.proposal!.steps.find((s) => s.name === "Dinner");
    expect(dinner).toBeDefined();
    expect(dinner!.alternatives.length).toBeGreaterThan(0);
    const alt = dinner!.alternatives[0]!;

    const capturedSwap: string[] = [];
    setSwapGoogle({
      apiKey: "test-routes-key",
      fetch: routesOnlyFetch(capturedSwap),
    });
    const swapped = await swapPost(
      jsonRequest(
        `/v1/plans/${plan.id}/steps/${dinner!.step_id}/swap`,
        "POST",
        { google_place_id: alt.google_place_id },
        { cookie: `hp_session=${organizer.token}` },
      ),
      {
        params: Promise.resolve({
          planId: plan.id,
          stepId: dinner!.step_id,
        }),
      },
    );
    expect(swapped.status).toBe(200);
    const swappedBody = (await swapped.json()) as {
      state: string;
      proposal: {
        steps: { step_id: string; place: { name: string } }[];
      } | null;
    };
    expect(swappedBody.state).toBe("proposed");
    const swappedDinner = swappedBody.proposal?.steps.find(
      (s) => s.step_id === dinner!.step_id,
    );
    expect(swappedDinner?.place.name).toBe(alt.name);

    const signaled = await signalPut(
      jsonRequest(
        `/v1/plans/${plan.id}/steps/${dinner!.step_id}/signal`,
        "PUT",
        { signal: "like" },
        { cookie: guestCookie },
      ),
      {
        params: Promise.resolve({
          planId: plan.id,
          stepId: dinner!.step_id,
        }),
      },
    );
    expect(signaled.status).toBe(200);
    expect(await signaled.json()).toEqual({ signal: "like" });

    const locked = await lockPost(
      jsonRequest(`/v1/plans/${plan.id}/lock`, "POST", {}, {
        cookie: `hp_session=${organizer.token}`,
      }),
      { params: Promise.resolve({ planId: plan.id }) },
    );
    expect(locked.status).toBe(200);
    const lockedBody = (await locked.json()) as {
      state: string;
      title: string;
    };
    expect(lockedBody.state).toBe("locked");
    expect(lockedBody.title).toBe("Thursday in Maadi");

    const shareRead = await joinGet(
      new Request(`http://localhost/v1/join/${joinToken}`),
      { params: Promise.resolve({ token: joinToken }) },
    );
    expect(shareRead.status).toBe(200);
    const shareBody = (await shareRead.json()) as {
      next: string;
      plan_id: string;
    };
    expect(shareBody.next).toBe("confirmed");
    expect(shareBody.plan_id).toBe(plan.id);

    const confirmed = await getConfirmed(
      new Request(`http://localhost/v1/plans/${plan.id}/confirmed`, {
        headers: { cookie: `hp_session=${organizer.token}` },
      }),
      { params: Promise.resolve({ planId: plan.id }) },
    );
    expect(confirmed.status).toBe(200);
    const confirmedBody = (await confirmed.json()) as {
      state: string;
      title: string;
      plan_id: string;
    };
    expect(confirmedBody.state).toBe("locked");
    expect(confirmedBody.title).toBe("Thursday in Maadi");
    expect(confirmedBody.plan_id).toBe(plan.id);

    const lockedWrite = await patchPlan(
      jsonRequest(
        `/v1/plans/${plan.id}`,
        "PATCH",
        { title: "Should not stick" },
        { cookie: `hp_session=${organizer.token}` },
      ),
      { params: Promise.resolve({ planId: plan.id }) },
    );
    expect(lockedWrite.status).toBe(409);
    const stored = await sql<{ title: string; state: string }[]>`
      SELECT title, state FROM plans WHERE id = ${plan.id}
    `;
    expect(stored[0]).toEqual({ title: "Thursday in Maadi", state: "locked" });

    expect(capturedAttempt.length).toBeGreaterThan(0);
    expect(capturedSwap.every((u) => u === ROUTES_MATRIX_URL)).toBe(true);
  });
});
