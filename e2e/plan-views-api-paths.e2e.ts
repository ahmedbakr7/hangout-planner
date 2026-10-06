/**
 * T-001-33 — the organizer plan, response form, proposal view and confirmed view reach real
 * route handlers. Each component renders with `fetch` routed to the route module Next.js would
 * serve the path from, against the real database; Google is faked at the server's client
 * options, never on the network. A request to a path no route serves fails the test.
 */
import { randomBytes } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import en from "../messages/en.json";
import { OrganizerPlan } from "@/components/organizer-plan";
import { ResponseForm } from "@/components/response-form";
import { ProposalView } from "@/components/proposal-view";
import { ConfirmedView } from "@/components/confirmed-view";
import { PLACES_SEARCH_TEXT_URL, type FetchFn } from "@/server/google/places";
import { ROUTES_MATRIX_URL } from "@/server/google/routes";
import { setGoogleClientOptions as setResponseGoogle } from "@/server/response/google";
import { setGoogleClientOptions as setPlaceSearchGoogle } from "@/server/response/place-search";
import { setProposalAttemptGoogleOptions } from "@/server/proposal/trigger";
import { setGoogleClientOptions as setSwapGoogle } from "@/server/proposal/swap-google";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { closeDatabase as closeJoin } from "@/server/join/db";
import { closeDatabase as closeAttempt } from "@/server/proposal/attempt";
import { closeDatabase as closeInbox } from "@/server/invites/inbox";
import { createRouteServer, type RouteServer } from "./route-server";

const { router } = vi.hoisted(() => ({
  router: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}
const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

const emails: string[] = [];
const planIds: string[] = [];

const startPlace = {
  id: "ChIJ-start",
  displayName: { text: "Maadi, Cairo" },
  location: { latitude: 29.96, longitude: 31.25 },
};

function venue(id: string, name: string, lat: number, units: number) {
  return {
    id,
    displayName: { text: name },
    location: { latitude: lat, longitude: 31.24 },
    priceRange: { startPrice: { currencyCode: "EGP", units, nanos: 0 } },
  };
}

const venuesByLabel: Record<string, unknown[]> = {
  Koshary: [
    venue("ChIJ-dinner-a", "Abu Tarek", 30.01, 120),
    venue("ChIJ-dinner-b", "Koshary El Tahrir", 30.012, 90),
  ],
  Turkish: [
    venue("ChIJ-coffee-a", "Cilantro", 30.02, 40),
    venue("ChIJ-coffee-b", "Filter Room", 30.021, 35),
  ],
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function urlOf(request: Parameters<FetchFn>[0]): string {
  return typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
}

/** Places search answers by text query; the routes matrix answers 3 minutes for every pair. */
const fakeGoogle: FetchFn = async (request, init) => {
  const url = urlOf(request);
  const body = JSON.parse(String(init?.body ?? "{}")) as {
    textQuery?: string;
    origins?: unknown[];
    destinations?: unknown[];
  };
  if (url === PLACES_SEARCH_TEXT_URL) {
    return json({ places: venuesByLabel[body.textQuery ?? ""] ?? [startPlace] });
  }
  if (url === ROUTES_MATRIX_URL) {
    const elements: unknown[] = [];
    (body.origins ?? []).forEach((_, originIndex) => {
      (body.destinations ?? []).forEach((__, destinationIndex) => {
        elements.push({
          originIndex,
          destinationIndex,
          status: { code: 0 },
          condition: "ROUTE_EXISTS",
          duration: "180s",
        });
      });
    });
    return json(elements);
  }
  return json(startPlace);
};

const unavailableGoogle: FetchFn = async () => {
  throw new Error("Google is unavailable");
};

let server: RouteServer;

function show(element: React.ReactElement) {
  return render(React.createElement(NextIntlClientProvider, { locale: "en", messages: en }, element));
}

async function call(path: string, method: string, body: unknown): Promise<Response> {
  return server.serve(path, {
    method,
    headers: { "content-type": "application/json", "x-hp-request": "1" },
    body: JSON.stringify(body),
  });
}

/** A collecting plan with one window and two steps, owned by a new account, joined by a guest. */
async function seedPlan(): Promise<{ planId: string; organizer: string; guest: string }> {
  server.useCookies("");
  const email = `plan-views-${randomBytes(6).toString("hex")}@example.com`;
  emails.push(email);
  const account = await call("/api/v1/accounts", "POST", {
    email,
    password: "password1",
    display_name: "Omar",
  });
  expect(account.status).toBe(201);
  const organizer = server.cookies();

  const created = await call("/api/v1/plans", "POST", {
    title: "Thursday in Maadi",
    timezone: "Africa/Cairo",
    windows: [{ local_date: "2026-10-02", start_local: "18:00", end_local: "19:00" }],
    budget: { amount_minor: 50_000, currency: "EGP" },
    steps: [
      { name: "Dinner", options: ["Koshary", "Grills"] },
      { name: "Coffee", options: ["Turkish", "Filter"] },
    ],
    threshold: 1,
  });
  expect(created.status).toBe(201);
  const plan = (await created.json()) as { id: string; join_path: string };
  planIds.push(plan.id);

  server.useCookies("");
  const token = plan.join_path.slice("/join/".length);
  const joined = await call(`/api/v1/join/${token}`, "POST", {
    kind: "anonymous",
    display_name: "Hana",
  });
  expect(joined.status).toBe(201);
  const guest = server.cookies();
  server.requested.length = 0;
  return { planId: plan.id, organizer, guest };
}

/** `METHOD /path` with ids replaced by the CONTRACTS parameter names. */
function contractShape(line: string, planId: string): string {
  return line
    .replace(/\?.*$/, "")
    .replace(planId, "{planId}")
    .replace(/\/steps\/[^/]+\//, "/steps/{stepId}/");
}

beforeEach(() => {
  server = createRouteServer();
  vi.stubGlobal("fetch", server.serve);
  process.env.HP_HASH_TEST = "1";
  setResponseGoogle({ apiKey: "test-places-key", fetch: fakeGoogle });
  setPlaceSearchGoogle({ apiKey: "test-places-key", fetch: fakeGoogle });
  setProposalAttemptGoogleOptions({ apiKey: "test-places-key", fetch: unavailableGoogle });
  setSwapGoogle({ apiKey: "test-routes-key", fetch: fakeGoogle });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete process.env.HP_HASH_TEST;
  setResponseGoogle(undefined);
  setPlaceSearchGoogle(undefined);
  setProposalAttemptGoogleOptions(undefined);
  setSwapGoogle(undefined);
  router.replace.mockReset();
});

afterAll(async () => {
  for (const planId of planIds) {
    const proposals = sql`SELECT id FROM proposals WHERE plan_id = ${planId}`;
    const participants = sql`SELECT id FROM participants WHERE plan_id = ${planId}`;
    const guests = await sql<{ id: string }[]>`
      SELECT DISTINCT guest_session_id AS id FROM participants
      WHERE plan_id = ${planId} AND guest_session_id IS NOT NULL
    `;
    await sql`DELETE FROM step_signals WHERE proposal_id IN (${proposals})`;
    await sql`DELETE FROM proposal_alternatives WHERE proposal_id IN (${proposals})`;
    await sql`DELETE FROM proposal_candidates WHERE proposal_id IN (${proposals})`;
    await sql`DELETE FROM proposal_legs WHERE proposal_id IN (${proposals})`;
    await sql`DELETE FROM proposal_steps WHERE proposal_id IN (${proposals})`;
    await sql`DELETE FROM proposal_cohort WHERE proposal_id IN (${proposals})`;
    await sql`DELETE FROM proposals WHERE plan_id = ${planId}`;
    await sql`DELETE FROM proposal_runs WHERE plan_id = ${planId}`;
    await sql`DELETE FROM response_picks WHERE participant_id IN (${participants})`;
    await sql`DELETE FROM response_windows WHERE participant_id IN (${participants})`;
    await sql`DELETE FROM responses WHERE participant_id IN (${participants})`;
    await sql`DELETE FROM participants WHERE plan_id = ${planId}`;
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
    await sql`DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE email = ${email})`;
    await sql`DELETE FROM accounts WHERE email = ${email}`;
  }
  await sql.end();
  await Promise.all([closeAccounts(), closePlans(), closeJoin(), closeAttempt(), closeInbox()]);
});

async function answerAsGuest(planId: string): Promise<void> {
  show(React.createElement(ResponseForm, { planId }));
  const window = (await screen.findByText("2026-10-02 18:00-19:00")).closest("fieldset");
  const dinner = screen.getByText("Dinner").closest("fieldset");
  const coffee = screen.getByText("Coffee").closest("fieldset");
  if (!window || !dinner || !coffee) {
    throw new Error("missing response fieldsets");
  }
  fireEvent.click(within(window).getByLabelText("Free"));
  fireEvent.change(within(window).getByLabelText("Earliest"), { target: { value: "18:00" } });
  fireEvent.change(within(window).getByLabelText("Latest"), { target: { value: "19:00" } });
  fireEvent.change(screen.getByLabelText(/approximate/i), { target: { value: "Maadi" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm this place" }));
  fireEvent.click(within(dinner).getByLabelText("Koshary"));
  fireEvent.click(within(coffee).getByLabelText("Turkish"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Answers saved.")).toBeTruthy();
}

describe("plan views against the real route handlers", () => {
  it("T-001-33/AC-2 the response form saves with a real PUT /api/v1/plans/{planId}/response and shows the saved state", async () => {
    const { planId, guest } = await seedPlan();
    server.useCookies(guest);

    await answerAsGuest(planId);

    const saves = server.requested.filter((line) => line.startsWith("PUT "));
    expect(saves).toEqual([`PUT /api/v1/plans/${planId}/response`]);
    const stored = await sql<{ complete: boolean }[]>`
      SELECT r.complete FROM responses r JOIN participants p ON p.id = r.participant_id
      WHERE p.plan_id = ${planId}
    `;
    expect(stored).toEqual([{ complete: true }]);
    expect(server.unserved).toEqual([]);
  });

  it("T-001-33/AC-1 every request the four views make through a whole plan is a CONTRACTS route under /api/v1/ that a handler serves", async () => {
    const { planId, organizer, guest } = await seedPlan();

    server.useCookies(organizer);
    show(React.createElement(ConfirmedView, { planId }));
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(`/plans/${planId}`);
    });
    cleanup();

    show(React.createElement(OrganizerPlan, { planId }));
    const title = (await screen.findByLabelText("Plan title")) as HTMLInputElement;
    fireEvent.change(title, { target: { value: "Thursday night in Maadi" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => {
      const rows = await sql<{ title: string }[]>`SELECT title FROM plans WHERE id = ${planId}`;
      expect(rows[0]?.title).toBe("Thursday night in Maadi");
    });
    cleanup();

    server.useCookies(guest);
    await answerAsGuest(planId);
    cleanup();

    server.useCookies(organizer);
    setProposalAttemptGoogleOptions({ apiKey: "test-places-key", fetch: fakeGoogle });
    show(React.createElement(ProposalView, { planId }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Abu Tarek")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Use this place" })[0] as HTMLElement);
    await waitFor(
      () => {
        expect(screen.getByText("Dinner").closest("li")?.textContent).toMatch(
          /^DinnerKosharyKoshary El Tahrir90\.00 EGP/,
        );
      },
      { timeout: 10_000 },
    );
    cleanup();

    server.useCookies(guest);
    show(React.createElement(ProposalView, { planId }));
    await screen.findByText("Koshary El Tahrir");
    fireEvent.click(screen.getAllByRole("button", { name: "Like" })[0] as HTMLElement);
    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: "Like" })[0]?.getAttribute("aria-pressed"),
      ).toBe("true");
    });
    cleanup();

    server.useCookies(organizer);
    show(React.createElement(ProposalView, { planId }));
    fireEvent.click(await screen.findByRole("button", { name: "Lock this outing" }));
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(`/plans/${planId}/confirmed`);
    });
    cleanup();

    show(React.createElement(ConfirmedView, { planId }));
    expect(await screen.findByText("Koshary El Tahrir")).toBeTruthy();
    expect(screen.getByText("Thursday night in Maadi")).toBeTruthy();

    expect(server.unserved).toEqual([]);
    for (const line of server.requested) {
      expect(line).toMatch(/^[A-Z]+ \/api\/v1\//);
    }
    expect(new Set(server.requested.map((line) => contractShape(line, planId)))).toEqual(
      new Set([
        "GET /api/v1/plans/{planId}/confirmed",
        "GET /api/v1/plans/{planId}/opening",
        "GET /api/v1/plans/{planId}",
        "PATCH /api/v1/plans/{planId}",
        "GET /api/v1/plans/{planId}/response",
        "GET /api/v1/plans/{planId}/place-searches",
        "PUT /api/v1/plans/{planId}/response",
        "GET /api/v1/plans/{planId}/proposal",
        "POST /api/v1/plans/{planId}/proposal-attempts",
        "POST /api/v1/plans/{planId}/steps/{stepId}/swap",
        "PUT /api/v1/plans/{planId}/steps/{stepId}/signal",
        "POST /api/v1/plans/{planId}/lock",
      ]),
    );
  });
});
