/**
 * T-001-39 — the proposal page loads the proposal on the server (ADR-0007). Plans are set up
 * through the real route handlers and database with the route server. The page's default export
 * is called directly (no HTTP rendering until Playwright) with `next/headers` returning that
 * actor's cookies and `redirect` mocked, as e2e/organizer-plan-server-load.e2e.ts does.
 */
import { randomBytes } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import en from "../messages/en.json";
import { ProposalView } from "@/components/proposal-view";
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
const DINNER_A = { id: "ChIJ-dinner-a", name: "Abu Tarek", lat: 30.01, lng: 31.235, units: 120 };
const DINNER_B = { id: "ChIJ-dinner-b", name: "Koshary El Tahrir", lat: 30.012, lng: 31.236, units: 90 };

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function venue(place: typeof DINNER_A) {
  return {
    id: place.id,
    displayName: { text: place.name },
    location: { latitude: place.lat, longitude: place.lng },
    priceRange: { startPrice: { currencyCode: "EGP", units: place.units, nanos: 0 } },
  };
}

/** Google stand-in: two Koshary venues, and a 180 second route between every pair. */
const googleFetch: FetchFn = async (request, init) => {
  const url = typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
  if (url === PLACES_SEARCH_TEXT_URL) {
    return json({ places: [venue(DINNER_A), venue(DINNER_B)] });
  }
  if (url === ROUTES_MATRIX_URL) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { origins?: unknown[]; destinations?: unknown[] };
    const elements: unknown[] = [];
    for (let i = 0; i < (body.origins ?? []).length; i += 1) {
      for (let j = 0; j < (body.destinations ?? []).length; j += 1) {
        elements.push({
          originIndex: i,
          destinationIndex: j,
          status: { code: 0 },
          condition: "ROUTE_EXISTS",
          duration: "180s",
        });
      }
    }
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

async function newAccount(label: string, displayName: string): Promise<{ cookies: string; email: string }> {
  server.useCookies("");
  const email = `proposal-load-${label}-${randomBytes(6).toString("hex")}@example.com`;
  emails.push(email);
  const account = await call("/api/v1/accounts", "POST", { email, password: "password1", display_name: displayName });
  expect(account.status).toBe(201);
  return { cookies: server.cookies(), email };
}

type Plan = { planId: string; organizer: string; token: string };

/** A plan owned by a new account; threshold 1 so the first answer runs a proposal attempt. */
async function seedPlan(title: string, threshold = 1): Promise<Plan> {
  const { cookies } = await newAccount("org", "Omar");
  const created = await call("/api/v1/plans", "POST", {
    title,
    timezone: "Africa/Cairo",
    windows: [{ local_date: "2026-10-02", start_local: "18:00", end_local: "19:00" }],
    budget: { amount_minor: 50_000, currency: "EGP" },
    steps: [{ name: "Dinner", options: ["Koshary", "Grills"] }],
    threshold,
  });
  expect(created.status).toBe(201);
  const plan = (await created.json()) as { id: string; join_path: string };
  planIds.push(plan.id);
  return { planId: plan.id, organizer: cookies, token: plan.join_path.slice("/join/".length) };
}

/** An anonymous participant who has joined the plan; returns that browser's cookies. */
async function joinGuest(plan: Plan, name: string): Promise<string> {
  server.useCookies("");
  const joined = await call(`/api/v1/join/${plan.token}`, "POST", { kind: "anonymous", display_name: name });
  expect(joined.status).toBe(201);
  return server.cookies();
}

/** The guest answers through the real PUT. `busy` leaves no time that works, so the attempt blocks. */
async function answer(plan: Plan, guest: string, kind: "free" | "busy" = "free"): Promise<string> {
  server.useCookies(guest);
  const form = (await (await server.serve(`/api/v1/plans/${plan.planId}/response`)).json()) as {
    windows: { id: string }[];
    steps: { id: string; options: { id: string }[] }[];
  };
  setResponseGoogle({ apiKey: "test-places-key", fetch: async () => json(START) });
  setProposalAttemptGoogleOptions({ apiKey: "test-places-key", fetch: googleFetch });
  const saved = await call(`/api/v1/plans/${plan.planId}/response`, "PUT", {
    windows: [
      kind === "free"
        ? { window_id: form.windows[0]?.id, kind, earliest_local: "18:00", latest_local: "19:00" }
        : { window_id: form.windows[0]?.id, kind },
    ],
    start_place_id: START.id,
    picks: [{ step_id: form.steps[0]?.id, option_id: form.steps[0]?.options[0]?.id }],
  });
  expect(saved.status).toBe(200);
  const body = (await saved.json()) as { plan_state: string };
  return body.plan_state;
}

type Proposed = Plan & { cohort: string; visitor: string };

/** A proposed plan: the cohort member Hana answered, Dina joined afterwards and is outside the cohort. */
async function seedProposed(title: string): Promise<Proposed> {
  const plan = await seedPlan(title);
  const cohort = await joinGuest(plan, "Hana");
  expect(await answer(plan, cohort)).toBe("proposed");
  const visitor = await joinGuest(plan, "Dina");
  return { ...plan, cohort, visitor };
}

/** A blocked plan: the only answer is busy, so no time works. */
async function seedBlocked(title: string): Promise<Plan & { guest: string }> {
  const plan = await seedPlan(title);
  const guest = await joinGuest(plan, "Hana");
  expect(await answer(plan, guest, "busy")).toBe("blocked");
  return { ...plan, guest };
}

async function lockPlan(planId: string): Promise<void> {
  await sql`UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${planId}`;
}

async function getProposal(planId: string, cookies: string): Promise<Response> {
  server.useCookies(cookies);
  return server.serve(`/api/v1/plans/${planId}/proposal`);
}

function show(element: React.ReactElement) {
  return render(React.createElement(NextIntlClientProvider, { locale: "en", messages: en }, element));
}

type ProposalElement = React.ReactElement<{ planId: string; initialProposal: unknown }>;

/** Call the page as the actor with these cookies; return the ProposalView element it renders. */
async function openPage(planId: string, cookies: string): Promise<ProposalElement> {
  cookieJar.value = cookies;
  const tree = await ProposalPage({ params: Promise.resolve({ planId }) });
  const stack: React.ReactNode[] = [tree];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!React.isValidElement(current)) {
      continue;
    }
    if (current.type === ProposalView) {
      return current as ProposalElement;
    }
    React.Children.forEach((current.props as { children?: React.ReactNode }).children, (child) =>
      stack.push(child),
    );
  }
  throw new Error("the page did not render ProposalView");
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

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

afterAll(async () => {
  for (const planId of planIds) {
    const participants = sql`SELECT id FROM participants WHERE plan_id = ${planId}`;
    const proposalIds = sql`SELECT id FROM proposals WHERE plan_id = ${planId}`;
    const guests = await sql<{ id: string }[]>`
      SELECT DISTINCT guest_session_id AS id FROM participants
      WHERE plan_id = ${planId} AND guest_session_id IS NOT NULL
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
    for (const guest of guests) {
      await sql`DELETE FROM guest_sessions WHERE id = ${guest.id}`;
    }
  }
  for (const email of emails) {
    await sql`DELETE FROM invitations WHERE account_id IN (SELECT id FROM accounts WHERE email = ${email})`;
    await sql`DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE email = ${email})`;
    await sql`DELETE FROM accounts WHERE email = ${email}`;
  }
  await sql.end();
  await Promise.all([closeAccounts(), closePlans(), closeJoin(), closeAttempt(), closeInbox()]);
});

describe("proposal page loads on the server", () => {
  it("T-001-39/AC-1 GET /api/v1/plans/{planId}/proposal answers each caller as the contract says", async () => {
    const proposed = await seedProposed("Thursday in Maadi");
    const collecting = await seedPlan("Early Thursday", 3);
    const collectingGuest = await joinGuest(collecting, "Hana");
    const blocked = await seedBlocked("Blocked Thursday");
    const locked = await seedProposed("Locked in Zamalek");
    await lockPlan(locked.planId);

    // Organizer: collecting, blocked and proposed answer 200 with their state.
    const orgCollecting = await getProposal(collecting.planId, collecting.organizer);
    expect(orgCollecting.status).toBe(200);
    expect(await orgCollecting.json()).toEqual({ state: "collecting", block: null, proposal: null });

    const orgBlocked = await getProposal(blocked.planId, blocked.organizer);
    expect(orgBlocked.status).toBe(200);
    expect(await orgBlocked.json()).toEqual({
      state: "blocked",
      block: { time: true, budget: false, venue_data: false },
      proposal: null,
    });

    const orgProposed = await getProposal(proposed.planId, proposed.organizer);
    expect(orgProposed.status).toBe(200);
    const orgBody = (await orgProposed.json()) as {
      state: string;
      block: null;
      proposal: { steps: { alternatives: unknown[]; like_count: number }[] };
    };
    expect(orgBody).toMatchObject({ state: "proposed", block: null });
    expect(orgBody.proposal.steps[0]?.alternatives.length).toBeGreaterThan(0);
    expect(orgBody.proposal.steps[0]?.like_count).toBe(0);

    // Cohort member and non-cohort participant while proposed: 200, no alternatives or counts.
    const member = await getProposal(proposed.planId, proposed.cohort);
    expect(member.status).toBe(200);
    const memberStep = ((await member.json()) as { proposal: { steps: Record<string, unknown>[] } }).proposal
      .steps[0];
    expect(memberStep).toMatchObject({ name: "Dinner", my_signal: "unset" });
    expect(memberStep).not.toHaveProperty("alternatives");
    expect(memberStep).not.toHaveProperty("like_count");

    const visitor = await getProposal(proposed.planId, proposed.visitor);
    expect(visitor.status).toBe(200);
    const visitorStep = ((await visitor.json()) as { proposal: { steps: Record<string, unknown>[] } }).proposal
      .steps[0];
    expect(visitorStep).toMatchObject({ name: "Dinner" });
    expect(visitorStep).not.toHaveProperty("my_signal");
    expect(visitorStep).not.toHaveProperty("alternatives");

    // A participant while collecting or blocked: 409 not_proposed.
    for (const [label, planId, cookies] of [
      ["collecting", collecting.planId, collectingGuest],
      ["blocked", blocked.planId, blocked.guest],
    ] as const) {
      const response = await getProposal(planId, cookies);
      expect(response.status, label).toBe(409);
      expect(await response.json(), label).toMatchObject({
        error: { code: "conflict", reason: "not_proposed", fields: [] },
      });
    }

    // A locked plan: 409 plan_locked for the organizer and a participant.
    for (const [label, cookies] of [
      ["organizer", locked.organizer],
      ["participant", locked.cohort],
    ] as const) {
      const response = await getProposal(locked.planId, cookies);
      expect(response.status, label).toBe(409);
      expect(await response.json(), label).toMatchObject({
        error: { code: "conflict", reason: "plan_locked", fields: [] },
      });
    }

    // A stranger, an invited caller, a link caller and an unknown plan: 404 with the envelope only.
    const stranger = (await newAccount("stranger", "Ziad")).cookies;
    const invited = await newAccount("invited", "Hana");
    server.useCookies(proposed.organizer);
    const invitation = await call(`/api/v1/plans/${proposed.planId}/invitations`, "POST", { email: invited.email });
    expect(invitation.status).toBe(200);
    server.useCookies("");
    const link = await server.serve(`/api/v1/join/${proposed.token}`);
    expect(link.status).toBe(200);
    const linkCookies = server.cookies();
    expect(linkCookies).toContain("hp_link=");

    for (const [label, planId, cookies] of [
      ["stranger", proposed.planId, stranger],
      ["invited", proposed.planId, invited.cookies],
      ["link", proposed.planId, linkCookies],
      ["unknown plan", "pln_does_not_exist", proposed.organizer],
    ] as const) {
      const response = await getProposal(planId, cookies);
      expect(response.status, label).toBe(404);
      const body = await response.json();
      expect(body, label).toMatchObject({ error: { code: "not_found", fields: [] } });
      expect(JSON.stringify(body), label).not.toContain("Thursday in Maadi");
    }
    expect(server.unserved).toEqual([]);
  });

  it("T-001-39/AC-2 the page renders ProposalView with the proposal as initial data and the view makes no first-render GET", async () => {
    const plan = await seedProposed("Thursday in Maadi");

    const rendered = await openPage(plan.planId, plan.cohort);
    expect(rendered.props.planId).toBe(plan.planId);
    expect(rendered.props.initialProposal).toMatchObject({
      state: "proposed",
      block: null,
      proposal: { steps: [{ name: "Dinner", place: { name: expect.any(String) } }] },
    });
    expect(redirectMock).not.toHaveBeenCalled();

    server.useCookies(plan.cohort);
    server.requested.length = 0;
    show(rendered);
    expect(await screen.findByRole("button", { name: en.proposal.like })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    await settle();
    expect(server.requested).toEqual([]);
  });

  it("T-001-39/AC-2 for the organizer on a blocked plan the initial data holds the block and the view shows it with no first-render GET", async () => {
    const plan = await seedBlocked("Blocked Thursday");

    const rendered = await openPage(plan.planId, plan.organizer);
    expect(rendered.props.initialProposal).toEqual({
      state: "blocked",
      block: { time: true, budget: false, venue_data: false },
      proposal: null,
    });
    expect(redirectMock).not.toHaveBeenCalled();

    server.useCookies(plan.organizer);
    server.requested.length = 0;
    show(rendered);
    expect(await screen.findByText(en.proposal.timeBlocked)).toBeTruthy();
    expect(screen.queryByText(en.proposal.budgetBlocked)).toBeNull();
    await settle();
    expect(server.requested).toEqual([]);
  });

  it("T-001-39/AC-3 the page redirects a locked plan to its confirmed page for the organizer and a participant", async () => {
    const plan = await seedProposed("Locked in Zamalek");
    await lockPlan(plan.planId);

    for (const cookies of [plan.organizer, plan.cohort]) {
      redirectMock.mockClear();
      await expect(openPage(plan.planId, cookies)).rejects.toThrow(`NEXT_REDIRECT /plans/${plan.planId}/confirmed`);
      expect(redirectMock).toHaveBeenCalledWith(`/plans/${plan.planId}/confirmed`);
    }
  });

  it("T-001-39/AC-3 the page redirects the organizer to the plan while collecting, and a participant to respond while collecting or blocked", async () => {
    const collecting = await seedPlan("Early Thursday", 3);
    const collectingGuest = await joinGuest(collecting, "Hana");
    const blocked = await seedBlocked("Blocked Thursday");

    const cases: [string, string, string, string][] = [
      ["organizer collecting", collecting.planId, collecting.organizer, `/plans/${collecting.planId}`],
      ["participant collecting", collecting.planId, collectingGuest, `/plans/${collecting.planId}/respond`],
      ["participant blocked", blocked.planId, blocked.guest, `/plans/${blocked.planId}/respond`],
    ];
    for (const [label, planId, cookies, target] of cases) {
      redirectMock.mockClear();
      await expect(openPage(planId, cookies), label).rejects.toThrow(`NEXT_REDIRECT ${target}`);
      expect(redirectMock, label).toHaveBeenCalledWith(target);
    }
  });

  it("T-001-39/AC-4 the page renders ProposalView with no initial data and the load error for no cookie, a stranger and an unknown plan", async () => {
    const plan = await seedProposed("Private Thursday");
    const stranger = (await newAccount("stranger", "Ziad")).cookies;

    const cases: [string, string, string][] = [
      ["no cookie", plan.planId, ""],
      ["stranger", plan.planId, stranger],
      ["unknown plan", "pln_does_not_exist", plan.organizer],
    ];
    for (const [label, id, cookies] of cases) {
      const rendered = await openPage(id, cookies);
      expect(rendered.props.initialProposal, label).toBeNull();
      cleanup();
      server.useCookies(cookies);
      server.requested.length = 0;
      show(rendered);
      expect(await screen.findByText(en.proposal.loadError), label).toBeTruthy();
      expect(document.body.textContent, label).not.toContain("Private Thursday");
      expect(document.body.textContent, label).not.toContain(DINNER_A.name);
      await settle();
      expect(server.requested, label).toEqual([]);
    }
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("T-001-39/AC-6 the load-error retry refetches with GET /api/v1/plans/{planId}/proposal and shows the proposal", async () => {
    const plan = await seedProposed("Thursday in Maadi");

    // The page had no data for this render; the person's cookies are good, so the refetch succeeds.
    const rendered = await openPage("pln_does_not_exist", plan.organizer);
    expect(rendered.props.initialProposal).toBeNull();
    cleanup();
    server.useCookies(plan.organizer);
    server.requested.length = 0;
    show(React.createElement(ProposalView, { planId: plan.planId, initialProposal: null }));
    fireEvent.click(await screen.findByRole("button", { name: en.proposal.retry }));

    expect(await screen.findByRole("button", { name: en.proposal.lock })).toBeTruthy();
    expect(server.requested).toEqual([`GET /api/v1/plans/${plan.planId}/proposal`]);
  });

  it("T-001-39/AC-6 swap, signal, lock and retry-attempt from the proposal view reach their routes and the view follows the answers", async () => {
    // Signal: a cohort member likes a step.
    const plan = await seedProposed("Thursday in Maadi");
    server.useCookies(plan.cohort);
    server.requested.length = 0;
    show(await openPage(plan.planId, plan.cohort));
    fireEvent.click(await screen.findByRole("button", { name: en.proposal.like }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: en.proposal.like }).getAttribute("aria-pressed")).toBe("true");
    });
    expect(server.requested.filter((line) => line.startsWith("PUT "))).toEqual([
      expect.stringMatching(new RegExp(`^PUT /api/v1/plans/${plan.planId}/steps/stp_[^/]+/signal$`)),
    ]);
    cleanup();

    // Swap: the organizer uses an alternative; the view shows the new place.
    const before = (await (await getProposal(plan.planId, plan.organizer)).json()) as {
      proposal: { steps: { place: { name: string }; alternatives: { name: string }[] }[] };
    };
    const chosen = before.proposal.steps[0]!.alternatives[0]!.name;
    setSwapGoogle({ apiKey: "test-routes-key", fetch: googleFetch });
    server.useCookies(plan.organizer);
    server.requested.length = 0;
    show(await openPage(plan.planId, plan.organizer));
    fireEvent.click((await screen.findAllByRole("button", { name: en.proposal.swap }))[0]!);
    await waitFor(() => {
      expect(server.requested.filter((line) => line.startsWith("POST "))).toEqual([
        expect.stringMatching(new RegExp(`^POST /api/v1/plans/${plan.planId}/steps/stp_[^/]+/swap$`)),
      ]);
    });
    await waitFor(() => {
      expect(document.body.textContent).toContain(chosen);
    });
    cleanup();

    // Lock: the organizer locks and the view leaves for the confirmed page.
    server.useCookies(plan.organizer);
    server.requested.length = 0;
    show(await openPage(plan.planId, plan.organizer));
    fireEvent.click(await screen.findByRole("button", { name: en.proposal.lock }));
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(`/plans/${plan.planId}/confirmed`);
    });
    expect(server.requested).toEqual([`POST /api/v1/plans/${plan.planId}/lock`]);
    cleanup();

    // Retry-attempt: venue data was off when the guest answered; the organizer retries and gets a proposal.
    process.env.HP_PROPOSAL_ENABLED = "0";
    const stuck = await seedPlan("Venue-less Thursday");
    const guest = await joinGuest(stuck, "Hana");
    expect(await answer(stuck, guest)).toBe("blocked");
    delete process.env.HP_PROPOSAL_ENABLED;
    server.useCookies(stuck.organizer);
    server.requested.length = 0;
    show(await openPage(stuck.planId, stuck.organizer));
    fireEvent.click(await screen.findByRole("button", { name: en.proposal.retry }));
    await waitFor(() => {
      expect(screen.queryByText(en.proposal.venueData)).toBeNull();
    });
    expect(server.requested).toEqual([`POST /api/v1/plans/${stuck.planId}/proposal-attempts`]);
    expect(await screen.findByRole("button", { name: en.proposal.lock })).toBeTruthy();
    expect(server.unserved).toEqual([]);
  });
});
