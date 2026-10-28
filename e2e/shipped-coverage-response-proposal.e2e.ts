/**
 * T-001-95 — real-stack coverage for shipped tickets T-001-20, -24 and -25.
 * Each test carries this ticket's tag and one shipped ticket's tag, and asserts every clause of
 * that AC through the route handlers and Postgres. Google is faked at the server's client options.
 * Harness copied from e2e/shipped-response-proposal.e2e.ts (T-001-89).
 * T-001-24's AC name `/v1/...`; the routes are `/api/v1/...` (ADR-0003), which is what these call.
 */
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { resetClock } from "@/server/clock";
import { PLACES_SEARCH_TEXT_URL, type FetchFn } from "@/server/google/places";
import { ROUTES_MATRIX_URL } from "@/server/google/routes";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { closeDatabase as closeJoin } from "@/server/join/db";
import { closeDatabase as closeAttempt } from "@/server/proposal/attempt";
import { closeDatabase as closeInbox } from "@/server/invites/inbox";
import { setProposalAttemptGoogleOptions } from "@/server/proposal/trigger";
import { setGoogleClientOptions as setResponseGoogle } from "@/server/response/google";
import { setGoogleClientOptions as setSwapGoogle } from "@/server/proposal/swap-google";
import { cleanupThenClose } from "./db-cleanup";
import { createRouteServer, type RouteServer } from "./route-server";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}
const sql = postgres(databaseUrl, { max: 1, idle_timeout: 0, connect_timeout: 10, onnotice: () => {} });

const originalProposalEnabled = process.env.HP_PROPOSAL_ENABLED;
const emails: string[] = [];
const planIds: string[] = [];
const TITLE = "Thursday in Maadi";

const startCafe = {
  id: "ChIJ-start",
  displayName: { text: "Maadi, Cairo" },
  location: { latitude: 29.96, longitude: 31.25 },
};

const DINNER_A = { id: "ChIJ-dinner-a", name: "Abu Tarek", lat: 30.01, lng: 31.235, units: 120 };
const DINNER_B = { id: "ChIJ-dinner-b", name: "Koshary El Tahrir", lat: 30.012, lng: 31.236, units: 90 };
const COFFEE_A = { id: "ChIJ-coffee-a", name: "Cilantro", lat: 30.02, lng: 31.24, units: 40 };
const COFFEE_B = { id: "ChIJ-coffee-b", name: "Filter Room", lat: 30.021, lng: 31.241, units: 35 };

type Venue = typeof DINNER_A;

let server: RouteServer;
let googleCalls: string[] = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function venuePlace(place: Venue) {
  return {
    id: place.id,
    displayName: { text: place.name },
    location: { latitude: place.lat, longitude: place.lng },
    priceRange: { startPrice: { currencyCode: "EGP", units: place.units, nanos: 0 } },
  };
}

/** Venue search and route matrix for the Koshary and Turkish options; every pair is 180s apart. */
function venueFetch(): FetchFn {
  const byQuery: Record<string, unknown[]> = {
    Koshary: [venuePlace(DINNER_A), venuePlace(DINNER_B)],
    Turkish: [venuePlace(COFFEE_A), venuePlace(COFFEE_B)],
  };
  return async (request, init) => {
    const url = typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
    googleCalls.push(url);
    const body = init?.body === undefined ? {} : (JSON.parse(String(init.body)) as Record<string, unknown>);
    if (url === PLACES_SEARCH_TEXT_URL) {
      return jsonResponse({ places: byQuery[String(body.textQuery ?? "")] ?? [] });
    }
    if (url === ROUTES_MATRIX_URL) {
      const origins = (body.origins as unknown[] | undefined) ?? [];
      const destinations = (body.destinations as unknown[] | undefined) ?? [];
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

async function call(path: string, method: string, body?: unknown): Promise<Response> {
  return server.serve(path, {
    method,
    headers: { "content-type": "application/json", "x-hp-request": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function newAccount(name: string): Promise<string> {
  server.useCookies("");
  const email = `shipped-cov-rp-${randomBytes(6).toString("hex")}@example.com`;
  emails.push(email);
  const account = await call("/api/v1/accounts", "POST", {
    email,
    password: "password1",
    display_name: name,
  });
  expect(account.status).toBe(201);
  return server.cookies();
}

type Window = { local_date: string; start_local: string; end_local: string };

type Seeded = { planId: string; organizer: string; token: string };

/** A collecting plan in EGP owned by a new account; the organizer's cookies are returned. */
async function createPlan(options: { threshold: number; windows?: Window[] }): Promise<Seeded> {
  const organizer = await newAccount("Omar");
  const created = await call("/api/v1/plans", "POST", {
    title: TITLE,
    timezone: "Africa/Cairo",
    windows: options.windows ?? [{ local_date: "2026-10-02", start_local: "18:00", end_local: "19:00" }],
    budget: { amount_minor: 50_000, currency: "EGP" },
    steps: [
      { name: "Dinner", options: ["Koshary", "Grills"] },
      { name: "Coffee", options: ["Turkish", "Filter"] },
    ],
    threshold: options.threshold,
  });
  expect(created.status).toBe(201);
  const plan = (await created.json()) as { id: string; join_path: string };
  planIds.push(plan.id);
  return { planId: plan.id, organizer, token: plan.join_path.slice("/join/".length) };
}

async function joinAsGuest(token: string, name: string): Promise<string> {
  server.useCookies("");
  const joined = await call(`/api/v1/join/${token}`, "POST", { kind: "anonymous", display_name: name });
  expect(joined.status).toBe(201);
  return server.cookies();
}

type ResponseView = {
  windows: { id: string }[];
  steps: { id: string; options: { id: string; label: string }[] }[];
};

async function responseView(planId: string, cookies: string): Promise<ResponseView> {
  server.useCookies(cookies);
  const read = await server.serve(`/api/v1/plans/${planId}/response`);
  expect(read.status).toBe(200);
  return (await read.json()) as ResponseView;
}

function pick(view: ResponseView, stepIndex: number, label: string) {
  const step = view.steps[stepIndex]!;
  const option = step.options.find((candidate) => candidate.label === label);
  expect(option).toBeDefined();
  return { step_id: step.id, option_id: option!.id };
}

function completeBody(view: ResponseView, earliest: string, latest: string) {
  return {
    windows: [{ window_id: view.windows[0]!.id, kind: "free", earliest_local: earliest, latest_local: latest }],
    start_place_id: startCafe.id,
    picks: [pick(view, 0, "Koshary"), pick(view, 1, "Turkish")],
  };
}

type SaveResult = { complete: boolean; first_completion: boolean; plan_state: string };

async function save(planId: string, cookies: string, body: unknown): Promise<SaveResult> {
  server.useCookies(cookies);
  const saved = await call(`/api/v1/plans/${planId}/response`, "PUT", body);
  expect(saved.status).toBe(200);
  return (await saved.json()) as SaveResult;
}

async function saveComplete(planId: string, cookies: string, earliest: string, latest: string) {
  const view = await responseView(planId, cookies);
  return save(planId, cookies, completeBody(view, earliest, latest));
}

type PlanRow = { state: string; answered_count: number };

async function planRow(planId: string): Promise<PlanRow> {
  const rows = await sql<PlanRow[]>`SELECT state, answered_count FROM plans WHERE id = ${planId}`;
  return rows[0]!;
}

async function runCount(planId: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM proposal_runs WHERE plan_id = ${planId}`;
  return rows[0]!.n;
}

/** A plan whose one participant completed and whose attempt proposed (threshold 1). */
async function seedProposed(): Promise<Seeded & { guest: string }> {
  const plan = await createPlan({ threshold: 1 });
  const guest = await joinAsGuest(plan.token, "Hana");
  const saved = await saveComplete(plan.planId, guest, "18:00", "19:00");
  expect(saved.plan_state).toBe("proposed");
  return { ...plan, guest };
}

type ProposalStep = {
  step_id: string;
  name: string;
  place: { name: string; amount_minor: number; currency: string };
  like_count?: number;
  dislike_count?: number;
  my_signal?: string;
  alternatives?: { google_place_id: string; name: string }[];
};

type ProposalDocument = {
  state: string;
  proposal: {
    time: unknown;
    fairness_warning: boolean;
    steps: ProposalStep[];
    legs: unknown[];
  } | null;
};

async function proposalAs(planId: string, cookies: string): Promise<ProposalDocument> {
  server.useCookies(cookies);
  const read = await server.serve(`/api/v1/plans/${planId}/proposal`);
  expect(read.status).toBe(200);
  return (await read.json()) as ProposalDocument;
}

/** Every stored row a swap could change, for one plan's proposal. */
async function storedProposal(planId: string) {
  const ids = sql`SELECT id FROM proposals WHERE plan_id = ${planId}`;
  const proposal = await sql`
    SELECT id, local_date::text AS local_date, local_time, fairness_warning FROM proposals WHERE plan_id = ${planId}
  `;
  const steps = await sql`
    SELECT step_id, option_id, google_place_id, place_name, amount_minor::text AS amount_minor
    FROM proposal_steps WHERE proposal_id IN (${ids}) ORDER BY step_id
  `;
  const legs = await sql`
    SELECT from_step_id, to_step_id, duration_seconds FROM proposal_legs
    WHERE proposal_id IN (${ids}) ORDER BY from_step_id, to_step_id
  `;
  const alternatives = await sql`
    SELECT step_id, position, google_place_id FROM proposal_alternatives
    WHERE proposal_id IN (${ids}) ORDER BY step_id, position
  `;
  const signals = await sql`
    SELECT step_id, participant_id, signal FROM step_signals
    WHERE proposal_id IN (${ids}) ORDER BY step_id, participant_id
  `;
  return {
    proposal: [...proposal],
    steps: [...steps],
    legs: [...legs],
    alternatives: [...alternatives],
    signals: [...signals],
  };
}

beforeEach(() => {
  server = createRouteServer();
  googleCalls = [];
  vi.stubGlobal("fetch", server.serve);
  process.env.HP_HASH_TEST = "1";
  delete process.env.HP_PROPOSAL_ENABLED;
  setResponseGoogle({ apiKey: "test-places-key", fetch: async () => jsonResponse(startCafe) });
  setProposalAttemptGoogleOptions({ apiKey: "test-places-key", fetch: venueFetch() });
  setSwapGoogle({ apiKey: "test-routes-key", fetch: venueFetch() });
});

afterEach(() => {
  resetClock();
  vi.unstubAllGlobals();
  delete process.env.HP_HASH_TEST;
  if (originalProposalEnabled === undefined) {
    delete process.env.HP_PROPOSAL_ENABLED;
  } else {
    process.env.HP_PROPOSAL_ENABLED = originalProposalEnabled;
  }
  setResponseGoogle(undefined);
  setProposalAttemptGoogleOptions(undefined);
  setSwapGoogle(undefined);
});

async function deleteSeededRows(): Promise<void> {
  for (const planId of planIds) {
    const guests = await sql<{ id: string }[]>`
      SELECT DISTINCT guest_session_id AS id FROM participants
      WHERE plan_id = ${planId} AND guest_session_id IS NOT NULL
    `;
    const links = await sql<{ id: string }[]>`
      SELECT DISTINCT link_session_id AS id FROM link_session_plans WHERE plan_id = ${planId}
    `;
    const proposalIds = sql`SELECT id FROM proposals WHERE plan_id = ${planId}`;
    const participantIds = sql`SELECT id FROM participants WHERE plan_id = ${planId}`;
    await sql`DELETE FROM step_signals WHERE proposal_id IN (${proposalIds})`;
    await sql`DELETE FROM proposal_alternatives WHERE proposal_id IN (${proposalIds})`;
    await sql`DELETE FROM proposal_candidates WHERE proposal_id IN (${proposalIds})`;
    await sql`DELETE FROM proposal_legs WHERE proposal_id IN (${proposalIds})`;
    await sql`DELETE FROM proposal_steps WHERE proposal_id IN (${proposalIds})`;
    await sql`DELETE FROM proposal_cohort WHERE proposal_id IN (${proposalIds})`;
    await sql`DELETE FROM proposals WHERE plan_id = ${planId}`;
    await sql`DELETE FROM proposal_runs WHERE plan_id = ${planId}`;
    await sql`DELETE FROM place_searches WHERE participant_id IN (${participantIds})`;
    await sql`DELETE FROM response_picks WHERE participant_id IN (${participantIds})`;
    await sql`DELETE FROM response_windows WHERE participant_id IN (${participantIds})`;
    await sql`DELETE FROM responses WHERE participant_id IN (${participantIds})`;
    await sql`DELETE FROM participants WHERE plan_id = ${planId}`;
    await sql`DELETE FROM invitations WHERE plan_id = ${planId}`;
    await sql`DELETE FROM link_session_plans WHERE plan_id = ${planId}`;
    await sql`DELETE FROM plan_options WHERE step_id IN (SELECT id FROM plan_steps WHERE plan_id = ${planId})`;
    await sql`DELETE FROM plan_steps WHERE plan_id = ${planId}`;
    await sql`DELETE FROM plan_windows WHERE plan_id = ${planId}`;
    await sql`DELETE FROM plans WHERE id = ${planId}`;
    for (const link of links) {
      await sql`
        DELETE FROM link_sessions WHERE id = ${link.id}
        AND NOT EXISTS (SELECT 1 FROM link_session_plans WHERE link_session_id = ${link.id})
      `;
    }
    for (const guest of guests) {
      await sql`
        DELETE FROM guest_sessions WHERE id = ${guest.id}
        AND NOT EXISTS (SELECT 1 FROM participants WHERE guest_session_id = ${guest.id})
      `;
    }
  }
  for (const email of emails) {
    await sql`DELETE FROM invitations WHERE account_id IN (SELECT id FROM accounts WHERE email = ${email})`;
    await sql`DELETE FROM participants WHERE account_id IN (SELECT id FROM accounts WHERE email = ${email})`;
    await sql`DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE email = ${email})`;
    await sql`DELETE FROM accounts WHERE email = ${email}`;
  }
}

afterAll(() =>
  cleanupThenClose(
    deleteSeededRows,
    () => sql.end(),
    () => closeAccounts(),
    () => closePlans(),
    () => closeJoin(),
    () => closeAttempt(),
    () => closeInbox(),
  ),
);

describe("shipped response and proposal coverage, through the real stack", () => {
  it("T-001-95/AC-1 T-001-20/AC-5 GET and PUT response give 409 responses_closed while proposed and 409 plan_locked while locked; the open payload omits count, threshold, other participants and starts; title, labels and start name are as stored", async () => {
    const plan = await createPlan({ threshold: 2 });
    const hana = await joinAsGuest(plan.token, "Hana");
    const youssef = await joinAsGuest(plan.token, "Youssef");
    setResponseGoogle({
      apiKey: "test-places-key",
      fetch: async () => jsonResponse({ ...startCafe, id: "ChIJ-secret", displayName: { text: "Secret Dock" } }),
    });
    expect((await saveComplete(plan.planId, youssef, "18:00", "19:00")).plan_state).toBe("collecting");
    setResponseGoogle({ apiKey: "test-places-key", fetch: async () => jsonResponse(startCafe) });
    const hanaView = await responseView(plan.planId, hana);
    expect(await save(plan.planId, hana, { start_place_id: startCafe.id })).toMatchObject({ complete: false });

    server.useCookies(hana);
    const open = await server.serve(`/api/v1/plans/${plan.planId}/response`);
    expect(open.status).toBe(200);
    const view = (await open.json()) as {
      title: string;
      steps: { options: { label: string }[] }[];
      response: { start: { name: string } | null };
    };
    expect(view.title).toBe(TITLE);
    expect(view.steps.map((step) => step.options.map((option) => option.label))).toEqual([
      ["Koshary", "Grills"],
      ["Turkish", "Filter"],
    ]);
    expect(view.response.start).toEqual({ name: "Maadi, Cairo" });
    const json = JSON.stringify(view);
    for (const hidden of ["answered_count", "threshold", "participants", "Youssef", "Secret Dock", "ChIJ-secret"]) {
      expect(json).not.toContain(hidden);
    }

    // Youssef's completion plus Hana's makes two: the attempt proposes and responses close.
    expect((await save(plan.planId, hana, completeBody(hanaView, "18:00", "19:00"))).plan_state).toBe("proposed");
    for (const [state, reason] of [
      ["proposed", "responses_closed"],
      ["locked", "plan_locked"],
    ] as const) {
      if (state === "locked") {
        server.useCookies(plan.organizer);
        expect((await call(`/api/v1/plans/${plan.planId}/lock`, "POST", {})).status).toBe(200);
      }
      expect((await planRow(plan.planId)).state).toBe(state);
      server.useCookies(hana);
      const read = await server.serve(`/api/v1/plans/${plan.planId}/response`);
      expect(read.status, state).toBe(409);
      expect(await read.json(), state).toEqual({
        error: { code: "conflict", reason, message: expect.any(String), fields: [] },
      });
      const write = await call(`/api/v1/plans/${plan.planId}/response`, "PUT", completeBody(hanaView, "18:15", "18:45"));
      expect(write.status, state).toBe(409);
      expect(await write.json(), state).toEqual({
        error: { code: "conflict", reason, message: expect.any(String), fields: [] },
      });
      expect((await planRow(plan.planId)).answered_count, state).toBe(2);
    }
    expect(server.unserved).toEqual([]);
  });

  it("T-001-95/AC-5 T-001-24/AC-1 PUT response runs an attempt only after the first completion that makes answered_count equal the threshold, returns the resulting plan_state, and a save while blocked runs none", async () => {
    // ADR-0003: the AC names /v1/plans/{planId}/response; the route is /api/v1/plans/{planId}/response.
    const plan = await createPlan({ threshold: 2 });
    const hana = await joinAsGuest(plan.token, "Hana");
    const youssef = await joinAsGuest(plan.token, "Youssef");
    const hanaView = await responseView(plan.planId, hana);

    // An incomplete save, a first completion below the threshold and an edit run nothing.
    expect(await save(plan.planId, hana, { start_place_id: startCafe.id })).toMatchObject({
      complete: false,
      plan_state: "collecting",
    });
    expect(await save(plan.planId, hana, completeBody(hanaView, "18:00", "19:00"))).toEqual({
      complete: true,
      first_completion: true,
      plan_state: "collecting",
    });
    expect(await save(plan.planId, hana, completeBody(hanaView, "18:00", "18:45"))).toMatchObject({
      first_completion: false,
      plan_state: "collecting",
    });
    expect(await runCount(plan.planId)).toBe(0);
    expect(googleCalls).toEqual([]);
    expect(await planRow(plan.planId)).toEqual({ state: "collecting", answered_count: 1 });

    // The completion that makes the count equal the threshold runs one attempt after it commits:
    // the attempt's cohort already holds the completer, and the PUT returns the attempt's state.
    const meets = await saveComplete(plan.planId, youssef, "18:00", "19:00");
    expect(meets).toEqual({ complete: true, first_completion: true, plan_state: "proposed" });
    expect(await planRow(plan.planId)).toEqual({ state: "proposed", answered_count: 2 });
    expect(await runCount(plan.planId)).toBe(1);
    const cohort = await sql<{ display_name: string }[]>`
      SELECT p.display_name FROM proposal_cohort c JOIN participants p ON p.id = c.participant_id
      WHERE c.proposal_id IN (SELECT id FROM proposals WHERE plan_id = ${plan.planId})
      ORDER BY p.display_name
    `;
    expect(cohort.map((row) => row.display_name)).toEqual(["Hana", "Youssef"]);

    // While blocked, neither a new completion nor an edit runs an attempt.
    process.env.HP_PROPOSAL_ENABLED = "0";
    const blocked = await createPlan({ threshold: 1 });
    const first = await joinAsGuest(blocked.token, "Mona");
    expect((await saveComplete(blocked.planId, first, "18:00", "19:00")).plan_state).toBe("blocked");
    delete process.env.HP_PROPOSAL_ENABLED;
    expect(await runCount(blocked.planId)).toBe(1);
    const late = await joinAsGuest(blocked.token, "Ziad");
    expect(await saveComplete(blocked.planId, late, "18:00", "19:00")).toEqual({
      complete: true,
      first_completion: true,
      plan_state: "blocked",
    });
    expect(await saveComplete(blocked.planId, first, "18:15", "18:45")).toEqual({
      complete: true,
      first_completion: false,
      plan_state: "blocked",
    });
    expect(await runCount(blocked.planId)).toBe(1);
    expect(await planRow(blocked.planId)).toEqual({ state: "blocked", answered_count: 2 });
    expect(googleCalls.filter((url) => url === PLACES_SEARCH_TEXT_URL).length).toBeGreaterThan(0);
    const callsAfterProposal = googleCalls.length;
    expect(await saveComplete(blocked.planId, late, "18:30", "18:45")).toMatchObject({ plan_state: "blocked" });
    expect(googleCalls.length).toBe(callsAfterProposal);
    expect(server.unserved).toEqual([]);
  });

  it("T-001-95/AC-6 T-001-25/AC-3 a google_place_id that is not one of that step's alternatives returns 409 not_an_alternative and leaves the proposal unchanged", async () => {
    const plan = await seedProposed();
    server.useCookies(plan.guest);
    const before = await proposalAs(plan.planId, plan.organizer);
    const dinner = before.proposal!.steps[0]!;
    const coffee = before.proposal!.steps[1]!;
    expect(dinner.alternatives?.length).toBeGreaterThan(0);
    server.useCookies(plan.guest);
    expect((await call(`/api/v1/plans/${plan.planId}/steps/${dinner.step_id}/signal`, "PUT", { signal: "like" })).status).toBe(200);
    const stored = await storedProposal(plan.planId);
    const document = await proposalAs(plan.planId, plan.organizer);
    const callsBefore = googleCalls.length;

    const otherStepPlace = [COFFEE_A, COFFEE_B]
      .map((venue) => venue.id)
      .find((id) => coffee.alternatives?.some((alternative) => alternative.google_place_id === id));
    expect(otherStepPlace).toBeDefined();
    const dinnerCurrent = stored.steps.find((row) => row.step_id === dinner.step_id)!.google_place_id as string;
    for (const id of ["ChIJ-nowhere", otherStepPlace!, dinnerCurrent]) {
      server.useCookies(plan.organizer);
      const refused = await call(`/api/v1/plans/${plan.planId}/steps/${dinner.step_id}/swap`, "POST", {
        google_place_id: id,
      });
      expect(refused.status, id).toBe(409);
      expect(await refused.json(), id).toEqual({
        error: { code: "conflict", reason: "not_an_alternative", message: expect.any(String), fields: [] },
      });
      expect(await storedProposal(plan.planId), id).toEqual(stored);
      expect(await proposalAs(plan.planId, plan.organizer), id).toEqual(document);
      expect((await planRow(plan.planId)).state, id).toBe("proposed");
    }
    expect(googleCalls.length).toBe(callsBefore);
    expect(server.unserved).toEqual([]);
  });

  it("T-001-95/AC-6 T-001-25/AC-5 after a successful swap like_count and dislike_count are 0 and a cohort member's my_signal on that step is unset", async () => {
    const plan = await seedProposed();
    const first = await proposalAs(plan.planId, plan.organizer);
    const dinner = first.proposal!.steps[0]!;
    const coffee = first.proposal!.steps[1]!;

    server.useCookies(plan.guest);
    expect((await call(`/api/v1/plans/${plan.planId}/steps/${dinner.step_id}/signal`, "PUT", { signal: "like" })).status).toBe(200);
    expect((await call(`/api/v1/plans/${plan.planId}/steps/${coffee.step_id}/signal`, "PUT", { signal: "dislike" })).status).toBe(200);
    const liked = await proposalAs(plan.planId, plan.organizer);
    expect(liked.proposal!.steps[0]).toMatchObject({ like_count: 1, dislike_count: 0 });
    expect((await proposalAs(plan.planId, plan.guest)).proposal!.steps[0]!.my_signal).toBe("like");

    const target = dinner.alternatives![0]!;
    server.useCookies(plan.organizer);
    const swapped = await call(`/api/v1/plans/${plan.planId}/steps/${dinner.step_id}/swap`, "POST", {
      google_place_id: target.google_place_id,
    });
    expect(swapped.status).toBe(200);
    const returned = (await swapped.json()) as ProposalDocument;
    expect(returned.proposal!.steps[0]!.place.name).toBe(target.name);
    expect(returned.proposal!.steps[0]).toMatchObject({ like_count: 0, dislike_count: 0 });

    const organizerView = await proposalAs(plan.planId, plan.organizer);
    expect(organizerView.proposal!.steps[0]).toMatchObject({ like_count: 0, dislike_count: 0 });
    // The other step's signal is untouched.
    expect(organizerView.proposal!.steps[1]).toMatchObject({ like_count: 0, dislike_count: 1 });
    const memberView = await proposalAs(plan.planId, plan.guest);
    expect(memberView.proposal!.steps[0]!.my_signal).toBe("unset");
    expect(memberView.proposal!.steps[1]!.my_signal).toBe("dislike");
    const rows = (await storedProposal(plan.planId)).signals;
    expect(rows.map((row) => [row.step_id, row.signal])).toEqual([[coffee.step_id, "dislike"]]);
    expect(server.unserved).toEqual([]);
  });
});
