/**
 * T-001-89 — real-stack proof for shipped tickets T-001-20, -21, -22, -23, -24 and -25.
 * Each test carries this ticket's tag and one shipped ticket's tag, and asserts that AC through
 * the route handlers and Postgres; AC-2 renders the respond page's default export with the data
 * the routes and Postgres gave it. Google is faked at the server's client options.
 */
import { randomBytes } from "node:crypto";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import en from "../messages/en.json";
import { ResponseForm } from "@/components/response-form";
import RespondPage from "@/app/plans/[planId]/respond/page";
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
import { cleanupThenClose } from "./db-cleanup";
import { createRouteServer, type RouteServer } from "./route-server";

const { router, cookieJar, redirectMock } = vi.hoisted(() => ({
  router: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
  cookieJar: { value: "" },
  redirectMock: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  redirect: redirectMock,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get(name: string) {
      for (const pair of cookieJar.value.split(";")) {
        const at = pair.indexOf("=");
        if (at > 0 && pair.slice(0, at).trim() === name) {
          return { name, value: pair.slice(at + 1).trim() };
        }
      }
      return undefined;
    },
  }),
}));

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
  const email = `shipped-rp-${randomBytes(6).toString("hex")}@example.com`;
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
async function createPlan(options: {
  threshold: number;
  windows?: Window[];
  budgetMinor?: number;
  steps?: { name: string; options: string[] }[];
}): Promise<Seeded> {
  const organizer = await newAccount("Omar");
  const created = await call("/api/v1/plans", "POST", {
    title: TITLE,
    timezone: "Africa/Cairo",
    windows: options.windows ?? [{ local_date: "2026-10-02", start_local: "18:00", end_local: "19:00" }],
    budget: { amount_minor: options.budgetMinor ?? 50_000, currency: "EGP" },
    steps: options.steps ?? [
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

/** The response GET as the cookies' owner, for the ids the PUT body needs. */
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

/** A complete answer: free in the first window between earliest and latest, one pick per step. */
function completeBody(view: ResponseView, earliest: string, latest: string) {
  return {
    windows: [{ window_id: view.windows[0]!.id, kind: "free", earliest_local: earliest, latest_local: latest }],
    start_place_id: startCafe.id,
    picks: [pick(view, 0, "Koshary"), pick(view, 1, "Turkish")],
  };
}

async function putResponse(planId: string, cookies: string, body: unknown): Promise<Response> {
  server.useCookies(cookies);
  return call(`/api/v1/plans/${planId}/response`, "PUT", body);
}

async function saveComplete(planId: string, cookies: string, earliest: string, latest: string) {
  const view = await responseView(planId, cookies);
  const saved = await putResponse(planId, cookies, completeBody(view, earliest, latest));
  expect(saved.status).toBe(200);
  return (await saved.json()) as { complete: boolean; first_completion: boolean; plan_state: string };
}

type PlanRow = { state: string; answered_count: number };

async function planRow(planId: string): Promise<PlanRow> {
  const rows = await sql<PlanRow[]>`SELECT state, answered_count FROM plans WHERE id = ${planId}`;
  return rows[0]!;
}

/** A plan whose one participant completed and whose attempt proposed (threshold 1). */
async function seedProposed(): Promise<Seeded & { guest: string }> {
  const plan = await createPlan({ threshold: 1 });
  const guest = await joinAsGuest(plan.token, "Hana");
  const saved = await saveComplete(plan.planId, guest, "18:00", "19:00");
  expect(saved.plan_state).toBe("proposed");
  return { ...plan, guest };
}

/**
 * A plan blocked on time: two participants whose free times in the one window do not overlap and
 * each fall between two 15-minute instants, so no instant is covered (coverage 0).
 */
async function seedTimeBlocked(): Promise<Seeded & { guest: string; second: string }> {
  const plan = await createPlan({ threshold: 2 });
  const guest = await joinAsGuest(plan.token, "Hana");
  const second = await joinAsGuest(plan.token, "Youssef");
  expect((await saveComplete(plan.planId, guest, "18:01", "18:10")).plan_state).toBe("collecting");
  expect((await saveComplete(plan.planId, second, "18:16", "18:29")).plan_state).toBe("blocked");
  return { ...plan, guest, second };
}

function getJson(planId: string, cookies: string, path: string): Promise<Response> {
  server.useCookies(cookies);
  return server.serve(`/api/v1/plans/${planId}/${path}`);
}

function show(element: React.ReactElement) {
  return render(React.createElement(NextIntlClientProvider, { locale: "en", messages: en }, element));
}

type FormElement = React.ReactElement<{ planId: string; initialResponse: unknown }>;

/** Call the respond page as the actor with these cookies; return the ResponseForm it renders. */
async function openRespondPage(planId: string, cookies: string): Promise<FormElement> {
  cookieJar.value = cookies;
  const tree = await RespondPage({ params: Promise.resolve({ planId }) });
  const stack: React.ReactNode[] = [tree];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!React.isValidElement(current)) {
      continue;
    }
    if (current.type === ResponseForm) {
      return current as FormElement;
    }
    React.Children.forEach((current.props as { children?: React.ReactNode }).children, (child) =>
      stack.push(child),
    );
  }
  throw new Error("the page did not render ResponseForm");
}

beforeEach(() => {
  server = createRouteServer();
  vi.stubGlobal("fetch", server.serve);
  process.env.HP_HASH_TEST = "1";
  delete process.env.HP_PROPOSAL_ENABLED;
  redirectMock.mockClear();
  setResponseGoogle({ apiKey: "test-places-key", fetch: async () => jsonResponse(startCafe) });
  setProposalAttemptGoogleOptions({ apiKey: "test-places-key", fetch: venueFetch() });
});

afterEach(() => {
  cleanup();
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
  cookieJar.value = "";
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

describe("shipped response and proposal tickets, through the real stack", () => {
  it("T-001-89/AC-1 T-001-20/AC-1 an incomplete save leaves the count; the first complete save counts once; a later complete save does not", async () => {
    // "Same transaction as the write" is not observable from outside; the visible half is that
    // each response and the stored count agree after every call.
    const { planId, token } = await createPlan({ threshold: 5 });
    const guest = await joinAsGuest(token, "Hana");
    expect((await planRow(planId)).answered_count).toBe(0);

    const view = await responseView(planId, guest);
    const incomplete = await putResponse(planId, guest, {
      windows: [{ window_id: view.windows[0]!.id, kind: "free", earliest_local: "18:10", latest_local: "18:50" }],
      start_place_id: startCafe.id,
      picks: [pick(view, 0, "Koshary")],
    });
    expect(incomplete.status).toBe(200);
    expect(await incomplete.json()).toMatchObject({ complete: false });
    expect(await planRow(planId)).toMatchObject({ answered_count: 0, state: "collecting" });

    const first = await putResponse(planId, guest, completeBody(view, "18:10", "18:50"));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ complete: true, first_completion: true, plan_state: "collecting" });
    expect((await planRow(planId)).answered_count).toBe(1);

    const again = await putResponse(planId, guest, completeBody(view, "18:20", "18:40"));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ complete: true, first_completion: false, plan_state: "collecting" });
    expect((await planRow(planId)).answered_count).toBe(1);

    // A second participant's first completion adds exactly one more.
    const second = await joinAsGuest(token, "Youssef");
    const other = await saveComplete(planId, second, "18:00", "19:00");
    expect(other).toMatchObject({ complete: true, first_completion: true });
    expect((await planRow(planId)).answered_count).toBe(2);
    expect(server.unserved).toEqual([]);
  });

  it("T-001-89/AC-2 T-001-21/AC-1 the respond page shows the budget with currency, every window, step and option as authored, and an approximate starting-point label", async () => {
    const windows: Window[] = [
      { local_date: "2026-10-02", start_local: "18:00", end_local: "19:00" },
      { local_date: "2026-10-03", start_local: "20:00", end_local: "22:30" },
    ];
    const steps = [
      { name: "Late Dinner — عشاء", options: ["Koshary Tahrir", "Grills & Co"] },
      { name: "Coffee Round", options: ["Turkish Brew", "Filter (V60)"] },
    ];
    const { planId, token } = await createPlan({ threshold: 3, windows, steps, budgetMinor: 123_450 });
    const guest = await joinAsGuest(token, "Hana");

    const rendered = await openRespondPage(planId, guest);
    expect(rendered.props.planId).toBe(planId);
    server.useCookies(guest);
    show(rendered);

    expect(await screen.findByRole("heading", { name: TITLE })).toBeTruthy();
    const budget = screen.getByText(/1,234\.50/);
    expect(budget.textContent).toBe("1,234.50 EGP");
    for (const window of windows) {
      const label = `${window.local_date} ${window.start_local}-${window.end_local}`;
      expect(screen.getByText(label).textContent).toBe(label);
    }
    for (const step of steps) {
      expect(screen.getByText(step.name).textContent).toBe(step.name);
      for (const option of step.options) {
        expect(screen.getByLabelText(option)).toBeTruthy();
        expect(screen.getByText(option).textContent).toBe(option);
      }
    }
    const start = screen.getByLabelText(en.respond.startApproximate);
    expect(start.getAttribute("type")).toBe("search");
    expect(en.respond.startApproximate.toLowerCase()).toContain("approximate");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("T-001-89/AC-3 T-001-22/AC-2 coverage 0 is time-blocked and stores no clock time", async () => {
    const { planId, organizer } = await seedTimeBlocked();

    expect(await planRow(planId)).toEqual({ state: "blocked", answered_count: 2 });
    const runs = await sql<
      { outcome: string; block_time: boolean; block_budget: boolean; block_venue_data: boolean }[]
    >`
      SELECT outcome, block_time, block_budget, block_venue_data FROM proposal_runs WHERE plan_id = ${planId}
    `;
    expect(runs).toEqual([
      { outcome: "blocked", block_time: true, block_budget: false, block_venue_data: false },
    ]);
    const stored = await sql<{ id: string }[]>`SELECT id FROM proposals WHERE plan_id = ${planId}`;
    expect(stored).toEqual([]);
    const cohort = await sql<{ proposal_id: string }[]>`
      SELECT proposal_id FROM proposal_cohort WHERE proposal_id IN (SELECT id FROM proposals WHERE plan_id = ${planId})
    `;
    expect(cohort).toEqual([]);

    const document = await getJson(planId, organizer, "proposal");
    expect(document.status).toBe(200);
    expect(await document.json()).toEqual({
      state: "blocked",
      block: { time: true, budget: false, venue_data: false },
      proposal: null,
    });
    expect(server.unserved).toEqual([]);
  });

  it("T-001-89/AC-4 T-001-23/AC-6 a participant gets 409 not_proposed while collecting or blocked and 409 plan_locked once locked; a stranger gets 404 with the envelope only", async () => {
    const collecting = await createPlan({ threshold: 2 });
    const collectingGuest = await joinAsGuest(collecting.token, "Hana");
    const blocked = await seedTimeBlocked();
    const proposed = await seedProposed();

    for (const [label, plan, guest] of [
      ["collecting", collecting, collectingGuest],
      ["blocked", blocked, blocked.guest],
    ] as const) {
      expect(await planRow(plan.planId), label).toMatchObject({ state: label });
      const refused = await getJson(plan.planId, guest, "proposal");
      expect(refused.status, label).toBe(409);
      expect(await refused.json(), label).toEqual({
        error: { code: "conflict", reason: "not_proposed", message: expect.any(String), fields: [] },
      });
    }

    server.useCookies(proposed.organizer);
    const locked = await call(`/api/v1/plans/${proposed.planId}/lock`, "POST", {});
    expect(locked.status).toBe(200);
    expect((await planRow(proposed.planId)).state).toBe("locked");
    const lockedRead = await getJson(proposed.planId, proposed.guest, "proposal");
    expect(lockedRead.status).toBe(409);
    expect(await lockedRead.json()).toEqual({
      error: { code: "conflict", reason: "plan_locked", message: expect.any(String), fields: [] },
    });

    const stranger = await newAccount("Sara");
    for (const [label, plan] of [
      ["collecting", collecting],
      ["blocked", blocked],
      ["locked", proposed],
    ] as const) {
      const hidden = await getJson(plan.planId, stranger, "proposal");
      expect(hidden.status, label).toBe(404);
      const body = (await hidden.json()) as { error: Record<string, unknown> };
      expect(Object.keys(body), label).toEqual(["error"]);
      expect(Object.keys(body.error).sort(), label).toEqual(["code", "fields", "message"]);
      expect(body.error.code, label).toBe("not_found");
      expect(body.error.fields, label).toEqual([]);
      expect(JSON.stringify(body), label).not.toContain(TITLE);
    }
    expect(server.unserved).toEqual([]);
  });

  it("T-001-89/AC-5 T-001-24/AC-3 an attempt while blocked returns the organizer proposal document; collecting and proposed give 409 not_blocked and locked gives 409 plan_locked", async () => {
    // Block the first attempt on venue data (no Google call), then let the retry succeed.
    process.env.HP_PROPOSAL_ENABLED = "0";
    const plan = await createPlan({ threshold: 1 });
    const guest = await joinAsGuest(plan.token, "Hana");
    const saved = await saveComplete(plan.planId, guest, "18:00", "19:00");
    expect(saved.plan_state).toBe("blocked");
    delete process.env.HP_PROPOSAL_ENABLED;
    expect(await planRow(plan.planId)).toMatchObject({ state: "blocked" });
    const runsBefore = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM proposal_runs WHERE plan_id = ${plan.planId}
    `;

    server.useCookies(plan.organizer);
    const attempt = await call(`/api/v1/plans/${plan.planId}/proposal-attempts`, "POST", {});
    expect(attempt.status).toBe(200);
    const document = (await attempt.json()) as {
      state: string;
      block: unknown;
      proposal: {
        cohort: { display_name: string }[];
        cohort_size: number;
        steps: { name: string; option_label: string; place: { name: string }; alternatives: unknown[] }[];
      } | null;
    };
    expect(document.state).toBe("proposed");
    expect(document.block).toBeNull();
    expect(document.proposal?.cohort.map((member) => member.display_name)).toEqual(["Hana"]);
    expect(document.proposal?.steps.map((step) => [step.name, step.option_label])).toEqual([
      ["Dinner", "Koshary"],
      ["Coffee", "Turkish"],
    ]);
    expect(document.proposal?.steps[0]).toHaveProperty("alternatives");
    const runsAfter = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM proposal_runs WHERE plan_id = ${plan.planId}
    `;
    expect(runsAfter[0]!.n).toBe(runsBefore[0]!.n + 1);
    expect(await planRow(plan.planId)).toMatchObject({ state: "proposed" });

    // proposed
    const whileProposed = await call(`/api/v1/plans/${plan.planId}/proposal-attempts`, "POST", {});
    expect(whileProposed.status).toBe(409);
    expect(await whileProposed.json()).toMatchObject({ error: { code: "conflict", reason: "not_blocked" } });

    // collecting
    const waiting = await createPlan({ threshold: 2 });
    server.useCookies(waiting.organizer);
    const whileCollecting = await call(`/api/v1/plans/${waiting.planId}/proposal-attempts`, "POST", {});
    expect(whileCollecting.status).toBe(409);
    expect(await whileCollecting.json()).toMatchObject({ error: { code: "conflict", reason: "not_blocked" } });

    // locked
    server.useCookies(plan.organizer);
    const lock = await call(`/api/v1/plans/${plan.planId}/lock`, "POST", {});
    expect(lock.status).toBe(200);
    const whileLocked = await call(`/api/v1/plans/${plan.planId}/proposal-attempts`, "POST", {});
    expect(whileLocked.status).toBe(409);
    expect(await whileLocked.json()).toMatchObject({ error: { code: "conflict", reason: "plan_locked" } });
    expect(server.unserved).toEqual([]);
  });

  it("T-001-89/AC-6 T-001-25/AC-6 like, dislike and unset work for a cohort participant while proposed, leave the time, places and cohort alone, and return no counts", async () => {
    const plan = await seedProposed();
    const steps = await sql<{ id: string }[]>`
      SELECT id FROM plan_steps WHERE plan_id = ${plan.planId} ORDER BY position
    `;
    const stepId = steps[0]!.id;

    async function snapshot() {
      const time = await sql`
        SELECT id, local_date::text AS local_date, local_time FROM proposals WHERE plan_id = ${plan.planId}
      `;
      const places = await sql`
        SELECT step_id, option_id, google_place_id, place_name, amount_minor::text AS amount_minor
        FROM proposal_steps WHERE proposal_id IN (SELECT id FROM proposals WHERE plan_id = ${plan.planId})
        ORDER BY step_id
      `;
      const cohort = await sql`
        SELECT participant_id, attending FROM proposal_cohort
        WHERE proposal_id IN (SELECT id FROM proposals WHERE plan_id = ${plan.planId})
        ORDER BY participant_id
      `;
      return { time: [...time], places: [...places], cohort: [...cohort] };
    }
    async function signalRows() {
      const rows = await sql<{ step_id: string; signal: string }[]>`
        SELECT step_id, signal FROM step_signals
        WHERE proposal_id IN (SELECT id FROM proposals WHERE plan_id = ${plan.planId})
      `;
      return [...rows];
    }

    const before = await snapshot();
    expect(before.time).toHaveLength(1);
    expect(before.places).toHaveLength(2);
    expect(before.cohort).toHaveLength(1);
    expect(await signalRows()).toEqual([]);

    for (const [signal, expected] of [
      ["like", [{ step_id: stepId, signal: "like" }]],
      ["dislike", [{ step_id: stepId, signal: "dislike" }]],
      ["unset", []],
    ] as const) {
      server.useCookies(plan.guest);
      const sent = await call(`/api/v1/plans/${plan.planId}/steps/${stepId}/signal`, "PUT", { signal });
      expect(sent.status, signal).toBe(200);
      const body = (await sent.json()) as Record<string, unknown>;
      expect(body, signal).toEqual({ signal });
      expect(Object.keys(body), signal).toEqual(["signal"]);
      expect(await signalRows(), signal).toEqual(expected);
      expect(await snapshot(), signal).toEqual(before);
      expect(await planRow(plan.planId), signal).toMatchObject({ state: "proposed" });
    }
    expect(server.unserved).toEqual([]);
  });
});
