/**
 * T-001-96 — real-stack proof for shipped T-001-26 AC-2, T-001-27 AC-1 and AC-2, and T-001-28 AC-5.
 * Plans are set up through the real route handlers and Postgres with the route server, and Google
 * is a fake fetch. The proposal and confirmed pages' default exports are called directly with
 * `next/headers` returning the actor's cookies, and the element they render is shown in jsdom.
 * Harness copied from e2e/shipped-lock-confirmed.e2e.ts (T-001-90).
 */
import { randomBytes } from "node:crypto";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import en from "../messages/en.json";
import { ConfirmedView } from "@/components/confirmed-view";
import { InvitationsList } from "@/components/invite-panel";
import { JoinPanel } from "@/components/join-panel";
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

/** Venues per option label; a label with no entry ("Nowhere") finds no place. */
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

/** Google stand-in: two venues per known option, and a route between every pair whose length depends on where it starts. */
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

async function call(path: string, method: string, body?: unknown): Promise<Response> {
  return server.serve(path, {
    method,
    headers: { "content-type": "application/json", "x-hp-request": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** A member who is free between `earliest` and `latest`, or busy for the whole window. */
type Member = { name: string; earliest: string; latest: string } | { name: string; busy: true };

type SeededPlan = { planId: string; title: string; organizer: string; token: string };

const THREE_STEPS = [
  { name: "Dinner", options: ["Koshary", "Grills"] },
  { name: "Coffee", options: ["Turkish", "Filter"] },
  { name: "Dessert", options: ["Baklava", "Gelato"] },
];

/** The first dinner option finds no place, so no place set covers every step. */
const NO_DINNER_PLACE = [
  { name: "Dinner", options: ["Nowhere", "Grills"] },
  { name: "Coffee", options: ["Turkish", "Filter"] },
];

/** A plan owned by a new account; its threshold is `threshold`, so that answer runs the attempt. */
async function seedPlan(title: string, threshold: number, steps = THREE_STEPS): Promise<SeededPlan> {
  server.useCookies("");
  const email = `shipped-cov-lock-${randomBytes(6).toString("hex")}@example.com`;
  emails.push(email);
  const account = await call("/api/v1/accounts", "POST", { email, password: "password1", display_name: "Omar" });
  expect(account.status).toBe(201);
  const organizer = server.cookies();
  const created = await call("/api/v1/plans", "POST", {
    title,
    timezone: "Africa/Cairo",
    windows: [{ local_date: "2026-10-02", start_local: "18:00", end_local: "19:00" }],
    budget: { amount_minor: 50_000, currency: "EGP" },
    steps,
    threshold,
  });
  expect(created.status).toBe(201);
  const plan = (await created.json()) as { id: string; join_path: string };
  planIds.push(plan.id);
  return { planId: plan.id, title, organizer, token: plan.join_path.slice("/join/".length) };
}

/** An anonymous participant joins and answers through the real routes; returns that browser's cookies. */
async function joinAndAnswer(plan: SeededPlan, member: Member): Promise<{ cookies: string; state: string }> {
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
  const window =
    "busy" in member
      ? { window_id: form.windows[0]?.id, kind: "busy" }
      : { window_id: form.windows[0]?.id, kind: "free", earliest_local: member.earliest, latest_local: member.latest };
  const saved = await call(`/api/v1/plans/${plan.planId}/response`, "PUT", {
    windows: [window],
    start_place_id: START.id,
    picks: form.steps.map((step) => ({ step_id: step.id, option_id: step.options[0]?.id })),
  });
  expect(saved.status).toBe(200);
  const body = (await saved.json()) as { complete: boolean; plan_state: string };
  expect(body.complete).toBe(true);
  return { cookies, state: body.plan_state };
}

/** A plan whose cohort is exactly `members`, each answering in turn; returns the members' cookies and the end state. */
async function seedAnswered(
  title: string,
  members: Member[],
  steps = THREE_STEPS,
): Promise<SeededPlan & { members: string[]; state: string }> {
  const plan = await seedPlan(title, members.length, steps);
  const cookies: string[] = [];
  let state = "collecting";
  for (const member of members) {
    const answered = await joinAndAnswer(plan, member);
    cookies.push(answered.cookies);
    state = answered.state;
  }
  return { ...plan, members: cookies, state };
}

/** Both members cover 18:30: the time works for the whole cohort. */
const EVERYONE: Member[] = [
  { name: "Hana", earliest: "18:00", latest: "18:30" },
  { name: "Salma", earliest: "18:30", latest: "19:00" },
];

const ALL_BUSY: Member[] = [
  { name: "Hana", busy: true },
  { name: "Salma", busy: true },
];

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

/** Call the page as the actor and return the path it redirected to. */
async function redirectOf(
  page: (props: { params: Promise<{ planId: string }> }) => Promise<React.ReactNode>,
  planId: string,
  cookies: string,
): Promise<string> {
  cookieJar.value = cookies;
  redirectMock.mockClear();
  await expect(page({ params: Promise.resolve({ planId }) })).rejects.toThrow(/^NEXT_REDIRECT /);
  expect(redirectMock).toHaveBeenCalledTimes(1);
  return String(redirectMock.mock.calls[0]?.[0]);
}

async function planRow(planId: string): Promise<{ state: string; locked_at: Date | null } | undefined> {
  const rows = await sql<{ state: string; locked_at: Date | null }[]>`
    SELECT state, locked_at FROM plans WHERE id = ${planId}
  `;
  return rows[0];
}

const NOT_PROPOSED = {
  error: { code: "conflict", reason: "not_proposed", message: "proposal is not available", fields: [] },
};

const PLAN_LOCKED = {
  error: { code: "conflict", reason: "plan_locked", message: "plan is locked", fields: [] },
};

const SENTENCES = {
  time: en.proposal.timeBlocked,
  budget: en.proposal.budgetBlocked,
  venue_data: en.proposal.venueData,
} as const;

beforeEach(() => {
  server = createRouteServer();
  vi.stubGlobal("fetch", server.serve);
  process.env.HP_HASH_TEST = "1";
  delete process.env.HP_PROPOSAL_ENABLED;
  redirectMock.mockClear();
  router.replace.mockClear();
  router.push.mockClear();
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

describe("shipped lock and confirmed coverage, proven through the real stack", () => {
  it("T-001-96/AC-1 T-001-26/AC-2 collecting and blocked return 409 not_proposed; already locked returns 409 plan_locked; there is no unlock route", async () => {
    // Collecting: one of two members has answered.
    const collecting = await seedPlan("Collecting Thursday", 2);
    expect((await joinAndAnswer(collecting, EVERYONE[0]!)).state).toBe("collecting");
    server.useCookies(collecting.organizer);
    const fromCollecting = await call(`/api/v1/plans/${collecting.planId}/lock`, "POST", {});
    expect(fromCollecting.status).toBe(409);
    expect(await fromCollecting.json()).toEqual(NOT_PROPOSED);
    expect(await planRow(collecting.planId)).toEqual({ state: "collecting", locked_at: null });

    // Blocked: the attempt could not use venue data.
    process.env.HP_PROPOSAL_ENABLED = "0";
    const blocked = await seedAnswered("Blocked Thursday", EVERYONE);
    expect(blocked.state).toBe("blocked");
    delete process.env.HP_PROPOSAL_ENABLED;
    server.useCookies(blocked.organizer);
    const fromBlocked = await call(`/api/v1/plans/${blocked.planId}/lock`, "POST", {});
    expect(fromBlocked.status).toBe(409);
    expect(await fromBlocked.json()).toEqual(NOT_PROPOSED);
    expect(await planRow(blocked.planId)).toEqual({ state: "blocked", locked_at: null });

    // Already locked.
    const proposed = await seedAnswered("Locked Thursday", EVERYONE);
    expect(proposed.state).toBe("proposed");
    server.useCookies(proposed.organizer);
    expect((await call(`/api/v1/plans/${proposed.planId}/lock`, "POST", {})).status).toBe(200);
    const lockedOnce = await planRow(proposed.planId);
    expect(lockedOnce?.state).toBe("locked");
    expect(lockedOnce?.locked_at).not.toBeNull();
    const again = await call(`/api/v1/plans/${proposed.planId}/lock`, "POST", {});
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual(PLAN_LOCKED);
    expect(await planRow(proposed.planId)).toEqual(lockedOnce);

    // No route undoes a lock: none of these is served, and the plan stays locked.
    server.unserved.length = 0;
    const attempts: [string, string][] = [
      ["POST", `/api/v1/plans/${proposed.planId}/unlock`],
      ["DELETE", `/api/v1/plans/${proposed.planId}/unlock`],
      ["PUT", `/api/v1/plans/${proposed.planId}/unlock`],
      ["DELETE", `/api/v1/plans/${proposed.planId}/lock`],
      ["PUT", `/api/v1/plans/${proposed.planId}/lock`],
      ["PATCH", `/api/v1/plans/${proposed.planId}/lock`],
      ["DELETE", `/api/v1/plans/${proposed.planId}/confirmed`],
    ];
    for (const [method, path] of attempts) {
      const response = await call(path, method, {});
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    expect(server.unserved).toEqual(attempts.map(([method, path]) => `${method} ${path}`));
    expect(await planRow(proposed.planId)).toEqual(lockedOnce);
  });

  it("T-001-96/AC-2 T-001-27/AC-1 while collecting the proposal surface is not shown; while blocked the organizer sees the time, budget and venue-data sentences from the three flags in text-destructive and no lock; time and budget both true show both sentences", async () => {
    // Collecting: the page sends the organizer to the plan and a participant to their answers.
    const collecting = await seedPlan("Collecting Thursday", 2);
    const member = await joinAndAnswer(collecting, EVERYONE[0]!);
    expect(member.state).toBe("collecting");
    expect(await redirectOf(ProposalPage, collecting.planId, collecting.organizer)).toBe(
      `/plans/${collecting.planId}`,
    );
    expect(await redirectOf(ProposalPage, collecting.planId, member.cookies)).toBe(
      `/plans/${collecting.planId}/respond`,
    );

    // Blocked: each sentence follows its own flag.
    const cases: { title: string; members: Member[]; steps?: typeof NO_DINNER_PLACE; disabled?: true; flags: { time: boolean; budget: boolean; venue_data: boolean } }[] = [
      { title: "Time only", members: ALL_BUSY, flags: { time: true, budget: false, venue_data: false } },
      { title: "Budget only", members: EVERYONE, steps: NO_DINNER_PLACE, flags: { time: false, budget: true, venue_data: false } },
      { title: "Venue data only", members: EVERYONE, disabled: true, flags: { time: false, budget: false, venue_data: true } },
      { title: "Time and budget", members: ALL_BUSY, steps: NO_DINNER_PLACE, flags: { time: true, budget: true, venue_data: false } },
      { title: "Time and venue data", members: ALL_BUSY, disabled: true, flags: { time: true, budget: false, venue_data: true } },
    ];
    for (const example of cases) {
      if (example.disabled) {
        process.env.HP_PROPOSAL_ENABLED = "0";
      } else {
        delete process.env.HP_PROPOSAL_ENABLED;
      }
      const plan = await seedAnswered(example.title, example.members, example.steps);
      expect(plan.state, example.title).toBe("blocked");

      const rendered = await openPage<ProposalPageProps>(ProposalPage, ProposalView, plan.planId, plan.organizer);
      expect(rendered.props.initialProposal, example.title).toEqual({
        state: "blocked",
        block: example.flags,
        proposal: null,
      });
      show(rendered);
      for (const flag of ["time", "budget", "venue_data"] as const) {
        const sentence = screen.queryByText(SENTENCES[flag]);
        if (example.flags[flag]) {
          expect(sentence, `${example.title}: ${flag}`).not.toBeNull();
          expect(sentence!.className.split(/\s+/), `${example.title}: ${flag}`).toContain("text-destructive");
        } else {
          expect(sentence, `${example.title}: ${flag}`).toBeNull();
        }
      }
      expect(screen.queryByRole("button", { name: en.proposal.lock }), example.title).toBeNull();
      cleanup();
    }
  });

  it("T-001-96/AC-2 T-001-27/AC-2 a joined participant while blocked is shown the response surface; venue-data offers retry; a missing duration is blank and is not rendered as zero", async () => {
    process.env.HP_PROPOSAL_ENABLED = "0";
    const plan = await seedAnswered("Blocked Thursday", EVERYONE);
    expect(plan.state).toBe("blocked");
    delete process.env.HP_PROPOSAL_ENABLED;

    // Each joined participant lands on the response surface.
    for (const cookies of plan.members) {
      expect(await redirectOf(ProposalPage, plan.planId, cookies)).toBe(`/plans/${plan.planId}/respond`);
    }

    // The organizer sees the venue-data sentence with a Retry that runs the attempt again.
    const rendered = await openPage<ProposalPageProps>(ProposalPage, ProposalView, plan.planId, plan.organizer);
    server.useCookies(plan.organizer);
    server.requested.length = 0;
    show(rendered);
    expect(screen.getByText(en.proposal.venueData)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: en.proposal.retry }));
    expect(await screen.findByText(DINNER_A.name)).toBeTruthy();
    expect(server.requested).toEqual([`POST /api/v1/plans/${plan.planId}/proposal-attempts`]);
    expect((await planRow(plan.planId))?.state).toBe("proposed");
    expect(screen.queryByText(en.proposal.venueData)).toBeNull();
    expect(screen.getByText("3 min")).toBeTruthy();
    expect(screen.getByText("7 min")).toBeTruthy();
    cleanup();

    // The same itinerary with the coffee-to-dessert duration missing: that line is blank, never zero.
    const loaded = await openPage<ProposalPageProps>(ProposalPage, ProposalView, plan.planId, plan.organizer);
    const proposal = (loaded.props.initialProposal as { proposal: { legs: { duration_seconds: number }[] } }).proposal;
    expect(proposal.legs.map((leg) => leg.duration_seconds)).toEqual([180, 420]);
    const withoutLeg = {
      ...(loaded.props.initialProposal as object),
      proposal: { ...proposal, legs: proposal.legs.slice(0, 1) },
    };
    show(React.createElement(ProposalView, { planId: plan.planId, initialProposal: withoutLeg }));
    const coffee = screen.getByRole("heading", { name: "Coffee", level: 2 }).closest("li")!;
    const captions = coffee.querySelectorAll(".caption");
    const travel = captions[captions.length - 1];
    expect(travel?.textContent).toBe("");
    expect(within(coffee).queryByText(/^0/)).toBeNull();
    expect(screen.queryByText("0 min")).toBeNull();
    expect(screen.queryByText("7 min")).toBeNull();
    expect(screen.getByText("3 min")).toBeTruthy();
  });

  it("T-001-96/AC-3 T-001-28/AC-5 the share link and an invitations row for a locked plan land on the confirmed surface", async () => {
    const plan = await seedPlan("Locked Thursday", 2);
    // An account invited while the plan collects.
    server.useCookies("");
    const inviteeEmail = `shipped-cov-lock-${randomBytes(6).toString("hex")}@example.com`;
    emails.push(inviteeEmail);
    expect(
      (await call("/api/v1/accounts", "POST", { email: inviteeEmail, password: "password1", display_name: "Dina" }))
        .status,
    ).toBe(201);
    const invitee = server.cookies();
    server.useCookies(plan.organizer);
    expect((await call(`/api/v1/plans/${plan.planId}/invitations`, "POST", { email: inviteeEmail })).status).toBe(200);
    for (const member of EVERYONE) {
      await joinAndAnswer(plan, member);
    }
    server.useCookies(plan.organizer);
    expect((await call(`/api/v1/plans/${plan.planId}/lock`, "POST", {})).status).toBe(200);
    const confirmedPath = `/plans/${plan.planId}/confirmed`;

    // The share link: a new browser opens /join/{token} and is sent to the confirmed surface.
    server.useCookies("");
    show(React.createElement(JoinPanel, { token: plan.token }));
    await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith(confirmedPath));
    expect(screen.queryByRole("button", { name: /join/i })).toBeNull();
    cleanup();
    const linkReader = server.cookies();
    expect(linkReader).toContain("hp_link=");
    const viaLink = await openPage<ConfirmedPageProps>(ConfirmedPage, ConfirmedView, plan.planId, linkReader);
    expect(redirectMock).not.toHaveBeenCalled();
    show(viaLink);
    expect(screen.getByRole("heading", { name: "Locked Thursday" })).toBeTruthy();
    expect(screen.getByText(en.confirmed.locked)).toBeTruthy();
    expect(screen.getByText(DINNER_A.name)).toBeTruthy();
    cleanup();

    // An invitations row: the invited account opens the row and is sent to the confirmed surface.
    server.useCookies(invitee);
    const inbox = await server.serve("/api/v1/invitations");
    expect(inbox.status).toBe(200);
    show(React.createElement(InvitationsList, { initialInbox: await inbox.json() }));
    fireEvent.click(await screen.findByRole("button", { name: /Locked Thursday/ }));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    expect(router.push).toHaveBeenCalledWith(confirmedPath);
    cleanup();
    const viaInvite = await openPage<ConfirmedPageProps>(ConfirmedPage, ConfirmedView, plan.planId, invitee);
    expect(redirectMock).not.toHaveBeenCalled();
    show(viaInvite);
    expect(screen.getByRole("heading", { name: "Locked Thursday" })).toBeTruthy();
    expect(screen.getByText(en.confirmed.locked)).toBeTruthy();
    expect(screen.getByText(DINNER_A.name)).toBeTruthy();
  });
});
