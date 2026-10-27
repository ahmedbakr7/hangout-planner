/**
 * T-001-90 — real-stack proof for shipped T-001-26 AC-1, T-001-27 AC-3 and T-001-28 AC-2.
 * Plans are set up through the real route handlers and Postgres with the route server, and Google
 * is a fake fetch. The proposal and confirmed pages' default exports are called directly with
 * `next/headers` returning the actor's cookies, as e2e/proposal-server-load.e2e.ts and
 * e2e/confirmed-server-load.e2e.ts do, and the element they render is shown in jsdom.
 */
import { randomBytes } from "node:crypto";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import en from "../messages/en.json";
import { ConfirmedView } from "@/components/confirmed-view";
import { ProposalView } from "@/components/proposal-view";
import ConfirmedPage from "@/app/plans/[planId]/confirmed/page";
import ProposalPage from "@/app/plans/[planId]/proposal/page";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { closeDatabase as closeJoin } from "@/server/join/db";
import { closeDatabase as closeAttempt } from "@/server/proposal/attempt";
import { closeDatabase as closeInbox } from "@/server/invites/inbox";
import { PLACES_SEARCH_TEXT_URL, type FetchFn } from "@/server/google/places";
import { ROUTES_MATRIX_URL } from "@/server/google/routes";
import { setProposalAttemptGoogleOptions } from "@/server/proposal/trigger";
import { setGoogleClientOptions as setResponseGoogle } from "@/server/response/google";
import { setGoogleClientOptions as setSwapGoogle } from "@/server/proposal/swap-google";
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
const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

const emails: string[] = [];
const planIds: string[] = [];
const originalProposalEnabled = process.env.HP_PROPOSAL_ENABLED;

let server: RouteServer;

const START = {
  id: "ChIJ-start",
  displayName: { text: "Maadi, Cairo" },
  location: { latitude: 29.96, longitude: 31.25 },
};

type Venue = { id: string; name: string; lat: number; lng: number; units: number };

const DINNER_A: Venue = { id: "ChIJ-dinner-a", name: "Abu Tarek", lat: 30.01, lng: 31.235, units: 120 };
const DINNER_B: Venue = { id: "ChIJ-dinner-b", name: "Koshary El Tahrir", lat: 30.012, lng: 31.236, units: 90 };
const COFFEE_A: Venue = { id: "ChIJ-coffee-a", name: "Cilantro", lat: 30.02, lng: 31.24, units: 40 };
const COFFEE_B: Venue = { id: "ChIJ-coffee-b", name: "Filter Room", lat: 30.021, lng: 31.241, units: 35 };
const DESSERT_A: Venue = { id: "ChIJ-dessert-a", name: "Mandarine Koueider", lat: 30.03, lng: 31.245, units: 55 };
const DESSERT_B: Venue = { id: "ChIJ-dessert-b", name: "Gelato Mix", lat: 30.031, lng: 31.246, units: 45 };

const VENUES_BY_QUERY: Record<string, Venue[]> = {
  Koshary: [DINNER_A, DINNER_B],
  Turkish: [COFFEE_A, COFFEE_B],
  Baklava: [DESSERT_A, DESSERT_B],
};

/** Seconds between a step's place and the next one: 180 leaving dinner, 420 leaving coffee. */
const DINNER_TO_COFFEE_SECONDS = 180;
const COFFEE_TO_DESSERT_SECONDS = 420;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function venue(place: Venue) {
  return {
    id: place.id,
    displayName: { text: place.name },
    location: { latitude: place.lat, longitude: place.lng },
    priceRange: { startPrice: { currencyCode: "EGP", units: place.units, nanos: 0 } },
  };
}

type Waypoint = { waypoint?: { location?: { latLng?: { latitude?: number; longitude?: number } } } };

function venueAt(waypoint: Waypoint | undefined): Venue | undefined {
  const latLng = waypoint?.waypoint?.location?.latLng;
  return [DINNER_A, DINNER_B, COFFEE_A, COFFEE_B, DESSERT_A, DESSERT_B].find(
    (place) => place.lat === latLng?.latitude && place.lng === latLng?.longitude,
  );
}

function secondsFrom(origin: Venue | undefined): number {
  return origin !== undefined && origin.id.startsWith("ChIJ-coffee")
    ? COFFEE_TO_DESSERT_SECONDS
    : DINNER_TO_COFFEE_SECONDS;
}

/** Google stand-in: two venues per step, and a route between every pair whose length depends on where it starts. */
const googleFetch: FetchFn = async (request, init) => {
  const url = typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
  if (url === PLACES_SEARCH_TEXT_URL) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { textQuery?: string };
    return json({ places: (VENUES_BY_QUERY[body.textQuery ?? ""] ?? []).map(venue) });
  }
  if (url === ROUTES_MATRIX_URL) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { origins?: Waypoint[]; destinations?: Waypoint[] };
    const elements: unknown[] = [];
    (body.origins ?? []).forEach((origin, i) => {
      (body.destinations ?? []).forEach((_destination, j) => {
        elements.push({
          originIndex: i,
          destinationIndex: j,
          status: { code: 0 },
          condition: "ROUTE_EXISTS",
          duration: `${secondsFrom(venueAt(origin))}s`,
        });
      });
    });
    return json(elements);
  }
  throw new Error(`unexpected Google URL: ${url}`);
};

async function call(path: string, method: string, body: unknown): Promise<Response> {
  return server.serve(path, {
    method,
    headers: { "content-type": "application/json", "x-hp-request": "1" },
    body: JSON.stringify(body),
  });
}

type Member = { name: string; earliest: string; latest: string };

type Plan = {
  planId: string;
  title: string;
  organizer: string;
  token: string;
  /** Each cohort member's cookies, in the order they answered. */
  members: string[];
};

/** A plan owned by a new account; its threshold is the member count, so the last answer runs the attempt. */
async function seedPlan(title: string, count: number): Promise<Omit<Plan, "members">> {
  server.useCookies("");
  const email = `shipped-lock-${randomBytes(6).toString("hex")}@example.com`;
  emails.push(email);
  const account = await call("/api/v1/accounts", "POST", { email, password: "password1", display_name: "Omar" });
  expect(account.status).toBe(201);
  const organizer = server.cookies();
  const created = await call("/api/v1/plans", "POST", {
    title,
    timezone: "Africa/Cairo",
    windows: [{ local_date: "2026-10-02", start_local: "18:00", end_local: "19:00" }],
    budget: { amount_minor: 50_000, currency: "EGP" },
    steps: [
      { name: "Dinner", options: ["Koshary", "Grills"] },
      { name: "Coffee", options: ["Turkish", "Filter"] },
      { name: "Dessert", options: ["Baklava", "Gelato"] },
    ],
    threshold: count,
  });
  expect(created.status).toBe(201);
  const plan = (await created.json()) as { id: string; join_path: string };
  planIds.push(plan.id);
  return { planId: plan.id, title, organizer, token: plan.join_path.slice("/join/".length) };
}

/** An anonymous participant joins and answers through the real routes; returns that browser's cookies. */
async function joinAndAnswer(plan: Omit<Plan, "members">, member: Member): Promise<{ cookies: string; state: string }> {
  server.useCookies("");
  const joined = await call(`/api/v1/join/${plan.token}`, "POST", { kind: "anonymous", display_name: member.name });
  expect(joined.status).toBe(201);
  const cookies = server.cookies();

  const form = (await (await server.serve(`/api/v1/plans/${plan.planId}/response`)).json()) as {
    windows: { id: string }[];
    steps: { id: string; options: { id: string }[] }[];
  };
  setResponseGoogle({ apiKey: "test-places-key", fetch: async () => json(START) });
  setProposalAttemptGoogleOptions({ apiKey: "test-places-key", fetch: googleFetch });
  const saved = await call(`/api/v1/plans/${plan.planId}/response`, "PUT", {
    windows: [
      { window_id: form.windows[0]?.id, kind: "free", earliest_local: member.earliest, latest_local: member.latest },
    ],
    start_place_id: START.id,
    picks: form.steps.map((step) => ({ step_id: step.id, option_id: step.options[0]?.id })),
  });
  expect(saved.status).toBe(200);
  const body = (await saved.json()) as { complete: boolean; plan_state: string };
  expect(body.complete).toBe(true);
  return { cookies, state: body.plan_state };
}

/** A proposed plan whose cohort is exactly `members`, each answering in turn. */
async function seedProposed(title: string, members: Member[]): Promise<Plan> {
  const plan = await seedPlan(title, members.length);
  const cookies: string[] = [];
  let state = "collecting";
  for (const member of members) {
    const answered = await joinAndAnswer(plan, member);
    cookies.push(answered.cookies);
    state = answered.state;
  }
  expect(state).toBe("proposed");
  return { ...plan, members: cookies };
}

/** Both members cover 18:30 (A free 18:00-18:30, B free 18:30-19:00): the time works for the whole cohort. */
const EVERYONE: Member[] = [
  { name: "Hana", earliest: "18:00", latest: "18:30" },
  { name: "Salma", earliest: "18:30", latest: "19:00" },
];

/**
 * 18:00 and 18:15 are covered by Hana and Dina, 18:30 by Hana and Salma, so the earliest maximum is
 * 18:00 with two of the three cohort members.
 */
const TWO_OF_THREE: Member[] = [
  { name: "Hana", earliest: "18:00", latest: "18:30" },
  { name: "Salma", earliest: "18:30", latest: "19:00" },
  { name: "Dina", earliest: "18:00", latest: "18:15" },
];

async function getJson<T>(path: string, cookies: string): Promise<{ status: number; body: T }> {
  server.useCookies(cookies);
  const response = await server.serve(path);
  return { status: response.status, body: (await response.json()) as T };
}

function show(element: React.ReactElement) {
  return render(React.createElement(NextIntlClientProvider, { locale: "en", messages: en }, element));
}

/** Call the page as the actor with these cookies; return the first element of `view` it renders. */
async function openPage<P>(
  page: (props: { params: Promise<{ planId: string }> }) => Promise<React.ReactNode>,
  view: unknown,
  planId: string,
  cookies: string,
): Promise<React.ReactElement<P>> {
  cookieJar.value = cookies;
  const tree = await page({ params: Promise.resolve({ planId }) });
  const stack: React.ReactNode[] = [tree];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!React.isValidElement(current)) {
      continue;
    }
    if (current.type === view) {
      return current as React.ReactElement<P>;
    }
    React.Children.forEach((current.props as { children?: React.ReactNode }).children, (child) =>
      stack.push(child),
    );
  }
  throw new Error("the page did not render its view");
}

beforeEach(() => {
  server = createRouteServer();
  vi.stubGlobal("fetch", server.serve);
  process.env.HP_HASH_TEST = "1";
  delete process.env.HP_PROPOSAL_ENABLED;
  redirectMock.mockClear();
  router.replace.mockClear();
});

afterEach(() => {
  cleanup();
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
  cookieJar.value = "";
});

async function deleteSeededRows(): Promise<void> {
  for (const planId of planIds) {
    const participants = sql`SELECT id FROM participants WHERE plan_id = ${planId}`;
    const proposalIds = sql`SELECT id FROM proposals WHERE plan_id = ${planId}`;
    const guests = await sql<{ id: string }[]>`
      SELECT DISTINCT guest_session_id AS id FROM participants
      WHERE plan_id = ${planId} AND guest_session_id IS NOT NULL
    `;
    const linkSessions = await sql<{ id: string }[]>`
      SELECT DISTINCT link_session_id AS id FROM link_session_plans WHERE plan_id = ${planId}
    `;
    await sql`DELETE FROM step_signals WHERE proposal_id IN (${proposalIds})`;
    await sql`DELETE FROM proposal_alternatives WHERE proposal_id IN (${proposalIds})`;
    await sql`DELETE FROM proposal_candidates WHERE proposal_id IN (${proposalIds})`;
    await sql`DELETE FROM proposal_legs WHERE proposal_id IN (${proposalIds})`;
    await sql`DELETE FROM proposal_steps WHERE proposal_id IN (${proposalIds})`;
    await sql`DELETE FROM proposal_cohort WHERE proposal_id IN (${proposalIds})`;
    await sql`DELETE FROM proposals WHERE plan_id = ${planId}`;
    await sql`DELETE FROM proposal_runs WHERE plan_id = ${planId}`;
    await sql`DELETE FROM response_picks WHERE participant_id IN (${participants})`;
    await sql`DELETE FROM response_windows WHERE participant_id IN (${participants})`;
    await sql`DELETE FROM responses WHERE participant_id IN (${participants})`;
    await sql`DELETE FROM participants WHERE plan_id = ${planId}`;
    await sql`DELETE FROM invitations WHERE plan_id = ${planId}`;
    await sql`DELETE FROM link_session_plans WHERE plan_id = ${planId}`;
    await sql`DELETE FROM plan_options WHERE step_id IN (SELECT id FROM plan_steps WHERE plan_id = ${planId})`;
    await sql`DELETE FROM plan_steps WHERE plan_id = ${planId}`;
    await sql`DELETE FROM plan_windows WHERE plan_id = ${planId}`;
    await sql`DELETE FROM plans WHERE id = ${planId}`;
    for (const link of linkSessions) {
      await sql`
        DELETE FROM link_sessions WHERE id = ${link.id}
        AND NOT EXISTS (SELECT 1 FROM link_session_plans WHERE link_session_id = ${link.id})
      `;
    }
    for (const guest of guests) {
      await sql`DELETE FROM guest_sessions WHERE id = ${guest.id}`;
    }
  }
  for (const email of emails) {
    await sql`DELETE FROM invitations WHERE account_id IN (SELECT id FROM accounts WHERE email = ${email})`;
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

type ProposalPageProps = { planId: string; initialProposal: unknown };
type ConfirmedPageProps = { planId: string; initialDoc: unknown };

describe("shipped lock and confirmed, proven through the real stack", () => {
  it("T-001-90/AC-1 T-001-26/AC-1 POST lock from proposed returns 200 with the confirmed document and sets state locked", async () => {
    const plan = await seedProposed("Thursday in Maadi", EVERYONE);
    const stored = await sql<{ state: string }[]>`SELECT state FROM plans WHERE id = ${plan.planId}`;
    expect(stored[0]?.state).toBe("proposed");

    server.useCookies(plan.organizer);
    const locked = await call(`/api/v1/plans/${plan.planId}/lock`, "POST", {});
    expect(locked.status).toBe(200);
    const lockedBody = (await locked.json()) as Record<string, unknown>;
    expect(lockedBody).toMatchObject({
      plan_id: plan.planId,
      title: "Thursday in Maadi",
      state: "locked",
      time: { local_date: "2026-10-02", local_time: "18:30", timezone: "Africa/Cairo" },
    });
    expect((lockedBody.steps as unknown[]).length).toBe(3);
    expect((lockedBody.legs as unknown[]).length).toBe(2);
    expect((lockedBody.cohort as unknown[]).length).toBe(2);

    // The lock body is the confirmed document: the same shape and content GET confirmed returns.
    const read = await getJson<Record<string, unknown>>(`/api/v1/plans/${plan.planId}/confirmed`, plan.organizer);
    expect(read.status).toBe(200);
    expect(lockedBody).toEqual(read.body);
    expect(Object.keys(lockedBody).sort()).toEqual(Object.keys(read.body).sort());

    const after = await sql<{ state: string; locked_at: Date | null }[]>`
      SELECT state, locked_at FROM plans WHERE id = ${plan.planId}
    `;
    expect(after[0]?.state).toBe("locked");
    expect(after[0]?.locked_at).not.toBeNull();
    expect(server.unserved).toEqual([]);
  });

  it("T-001-90/AC-2 T-001-27/AC-3 a proposed itinerary shows the time with the timezone, the attendance count and each cohort display name, and says everyone when the count equals the cohort size", async () => {
    const plan = await seedProposed("Thursday in Maadi", EVERYONE);
    const api = await getJson<{
      proposal: { attending_count: number; cohort_size: number; time: { local_time: string } };
    }>(`/api/v1/plans/${plan.planId}/proposal`, plan.organizer);
    expect(api.body.proposal).toMatchObject({ attending_count: 2, cohort_size: 2 });

    const rendered = await openPage<ProposalPageProps>(ProposalPage, ProposalView, plan.planId, plan.organizer);
    expect(redirectMock).not.toHaveBeenCalled();
    show(rendered);

    expect(await screen.findByText("2026-10-02 18:30 Africa/Cairo")).toBeTruthy();
    expect(screen.getByText(en.proposal.attendingEveryone)).toBeTruthy();
    expect(screen.queryByText("2 of 2 can make this time.")).toBeNull();
    for (const name of ["Hana", "Salma"]) {
      expect(screen.getByText(name), name).toBeTruthy();
    }
  });

  it("T-001-90/AC-2 T-001-27/AC-3 a proposed itinerary with fewer attending than the cohort shows the count and does not say everyone", async () => {
    const plan = await seedProposed("Thursday in Maadi", TWO_OF_THREE);
    const api = await getJson<{
      proposal: { attending_count: number; cohort_size: number; cohort: { display_name: string; attending: boolean }[] };
    }>(`/api/v1/plans/${plan.planId}/proposal`, plan.organizer);
    expect(api.body.proposal.attending_count).toBe(2);
    expect(api.body.proposal.cohort_size).toBe(3);
    expect(api.body.proposal.cohort.filter((member) => !member.attending).map((member) => member.display_name)).toEqual([
      "Salma",
    ]);

    // A cohort member opens the same surface and sees the same attendance line.
    const rendered = await openPage<ProposalPageProps>(ProposalPage, ProposalView, plan.planId, plan.members[0]!);
    expect(redirectMock).not.toHaveBeenCalled();
    show(rendered);

    expect(await screen.findByText("2026-10-02 18:00 Africa/Cairo")).toBeTruthy();
    expect(screen.getByText("2 of 3 can make this time.")).toBeTruthy();
    expect(screen.queryByText(en.proposal.attendingEveryone)).toBeNull();
    for (const name of ["Hana", "Salma", "Dina"]) {
      expect(screen.getByText(name), name).toBeTruthy();
    }
  });

  it("T-001-90/AC-3 T-001-28/AC-2 the loaded outing shows state locked, the title, the time with the timezone, each step's place and amount with currency, the travel durations and the cohort names", async () => {
    const plan = await seedProposed("Thursday in Maadi", EVERYONE);
    server.useCookies(plan.organizer);
    expect((await call(`/api/v1/plans/${plan.planId}/lock`, "POST", {})).status).toBe(200);

    const rendered = await openPage<ConfirmedPageProps>(ConfirmedPage, ConfirmedView, plan.planId, plan.members[1]!);
    expect(redirectMock).not.toHaveBeenCalled();
    expect(rendered.props.initialDoc).toMatchObject({
      plan_id: plan.planId,
      title: "Thursday in Maadi",
      state: "locked",
    });

    server.useCookies(plan.members[1]!);
    server.requested.length = 0;
    const { container } = show(rendered);

    expect(await screen.findByRole("heading", { name: "Thursday in Maadi" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(en.confirmed.locked)).toBeTruthy();
    expect(screen.getByText("2026-10-02 18:30 Africa/Cairo")).toBeTruthy();
    for (const name of ["Hana", "Salma"]) {
      expect(screen.getByText(name), name).toBeTruthy();
    }

    // Each step carries its place and per-person amount with currency; the duration to the next place
    // sits under the step it leaves, so each pair of consecutive places has its own travel time.
    const steps = [...container.querySelectorAll("ol > li")].map((item) =>
      [...item.querySelectorAll("p")].map((line) => line.textContent),
    );
    expect(steps).toEqual([
      [DINNER_A.name, "120.00 EGP", "3 min"],
      [COFFEE_A.name, "40.00 EGP", "7 min"],
      [DESSERT_A.name, "55.00 EGP"],
    ]);
    expect(container.textContent).not.toContain("Grills");

    // The first render needed no fetch: the page's own load supplied the outing.
    expect(server.requested).toEqual([]);
  });
});
