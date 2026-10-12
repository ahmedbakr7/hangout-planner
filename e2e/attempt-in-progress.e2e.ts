/**
 * T-001-34 — a write that commits but loses the proposal-attempt lock (409 attempt_in_progress,
 * ADR-0004) makes the response form and the organizer plan refetch instead of showing a save
 * error. Each component renders with `fetch` routed to the real route handlers against the real
 * database; the attempt lock is held by setting it on the plan row, so the handlers themselves
 * return the 409. Google is faked at the server's client options, never on the network.
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
import { PLACES_SEARCH_TEXT_URL, type FetchFn } from "@/server/google/places";
import { setGoogleClientOptions as setResponseGoogle } from "@/server/response/google";
import { setGoogleClientOptions as setPlaceSearchGoogle } from "@/server/response/place-search";
import { setProposalAttemptGoogleOptions } from "@/server/proposal/trigger";
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

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Place search and details answer with the one start place; no attempt reaches Google. */
const fakeGoogle: FetchFn = async (request) => {
  const url = typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
  return json(url === PLACES_SEARCH_TEXT_URL ? { places: [startPlace] } : startPlace);
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

/** A collecting plan with one window and one step, owned by a new account, joined by a guest. */
async function seedPlan(threshold: number): Promise<{ planId: string; organizer: string; guest: string }> {
  server.useCookies("");
  const email = `attempt-lock-${randomBytes(6).toString("hex")}@example.com`;
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
    steps: [{ name: "Dinner", options: ["Koshary", "Grills"] }],
    threshold,
  });
  expect(created.status).toBe(201);
  const plan = (await created.json()) as { id: string; join_path: string };
  planIds.push(plan.id);

  server.useCookies("");
  const joined = await call(`/api/v1/join/${plan.join_path.slice("/join/".length)}`, "POST", {
    kind: "anonymous",
    display_name: "Hana",
  });
  expect(joined.status).toBe(201);
  return { planId: plan.id, organizer, guest: server.cookies() };
}

/** Hold the plan's attempt lock as if another trigger were running. */
async function holdAttemptLock(planId: string): Promise<void> {
  await sql`UPDATE plans SET attempt_lock = true, attempt_lock_at = now() WHERE id = ${planId}`;
}

async function fillResponse(): Promise<void> {
  const window = (await screen.findByText("2026-10-02 18:00-19:00")).closest("fieldset");
  const dinner = screen.getByText("Dinner").closest("fieldset");
  if (!window || !dinner) {
    throw new Error("missing response fieldsets");
  }
  fireEvent.click(within(window).getByLabelText("Free"));
  fireEvent.change(within(window).getByLabelText("Earliest"), { target: { value: "18:00" } });
  fireEvent.change(within(window).getByLabelText("Latest"), { target: { value: "19:00" } });
  fireEvent.change(screen.getByLabelText(/approximate/i), { target: { value: "Maadi" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm this place" }));
  fireEvent.click(within(dinner).getByLabelText("Koshary"));
}

beforeEach(() => {
  server = createRouteServer();
  vi.stubGlobal("fetch", server.serve);
  process.env.HP_HASH_TEST = "1";
  setResponseGoogle({ apiKey: "test-places-key", fetch: fakeGoogle });
  setPlaceSearchGoogle({ apiKey: "test-places-key", fetch: fakeGoogle });
  setProposalAttemptGoogleOptions({ apiKey: "test-places-key", fetch: unavailableGoogle });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete process.env.HP_HASH_TEST;
  setResponseGoogle(undefined);
  setPlaceSearchGoogle(undefined);
  setProposalAttemptGoogleOptions(undefined);
  router.replace.mockReset();
});

afterAll(async () => {
  for (const planId of planIds) {
    const participants = sql`SELECT id FROM participants WHERE plan_id = ${planId}`;
    const guests = await sql<{ id: string }[]>`
      SELECT DISTINCT guest_session_id AS id FROM participants
      WHERE plan_id = ${planId} AND guest_session_id IS NOT NULL
    `;
    const linkSessions = await sql<{ id: string }[]>`
      SELECT DISTINCT link_session_id AS id FROM link_session_plans WHERE plan_id = ${planId}
    `;
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
    await sql`DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE email = ${email})`;
    await sql`DELETE FROM accounts WHERE email = ${email}`;
  }
  await sql.end();
  await Promise.all([closeAccounts(), closePlans(), closeJoin(), closeAttempt(), closeInbox()]);
});

describe("attempt_in_progress against the real route handlers", () => {
  it("T-001-34/AC-1 a PUT response that loses the attempt lock shows no save error, refetches the response and shows it", async () => {
    const { planId, guest } = await seedPlan(1);
    await holdAttemptLock(planId);
    server.useCookies(guest);
    const initialResponse: unknown = await (await server.serve(`/api/v1/plans/${planId}/response`)).json();
    server.requested.length = 0;

    show(React.createElement(ResponseForm, { planId, initialResponse }));
    await fillResponse();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(
        server.requested.filter((line) => line.startsWith("GET ") && line.includes("/response")),
      ).toHaveLength(1);
    });
    await waitFor(() => {
      const dinner = screen.getByText("Dinner").closest("fieldset") as HTMLElement;
      expect((within(dinner).getByLabelText("Koshary") as HTMLInputElement).checked).toBe(true);
    });
    expect(screen.queryByText("Answers could not be saved.")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(server.requested.filter((line) => line.startsWith("PUT "))).toEqual([
      `PUT /api/v1/plans/${planId}/response`,
    ]);
    expect(server.unserved).toEqual([]);
    const stored = await sql<{ complete: boolean }[]>`
      SELECT r.complete FROM responses r JOIN participants p ON p.id = r.participant_id
      WHERE p.plan_id = ${planId}
    `;
    expect(stored).toEqual([{ complete: true }]);
  });

  it("T-001-34/AC-2 a PATCH plan that loses the attempt lock shows no save error, refetches the plan and shows it", async () => {
    const { planId, organizer, guest } = await seedPlan(2);
    server.useCookies(guest);
    const initialResponse: unknown = await (await server.serve(`/api/v1/plans/${planId}/response`)).json();
    show(React.createElement(ResponseForm, { planId, initialResponse }));
    await fillResponse();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Answers saved.")).toBeTruthy();
    cleanup();

    await holdAttemptLock(planId);
    server.useCookies(organizer);
    const initialPlan: unknown = await (await server.serve(`/api/v1/plans/${planId}`)).json();
    server.requested.length = 0;
    show(React.createElement(OrganizerPlan, { planId, initialPlan }));
    const threshold = (await screen.findByLabelText("Answered threshold")) as HTMLInputElement;
    fireEvent.change(threshold, { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(server.requested.filter((line) => line === `GET /api/v1/plans/${planId}`)).toHaveLength(1);
    });
    await waitFor(() => {
      expect((screen.getByLabelText("Answered threshold") as HTMLInputElement).value).toBe("1");
    });
    expect(screen.queryByText("The plan could not be saved.")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(server.requested.filter((line) => line.startsWith("PATCH "))).toEqual([
      `PATCH /api/v1/plans/${planId}`,
    ]);
    expect(router.replace).not.toHaveBeenCalled();
    expect(server.unserved).toEqual([]);
    const stored = await sql<{ threshold: number }[]>`SELECT threshold FROM plans WHERE id = ${planId}`;
    expect(stored).toEqual([{ threshold: 1 }]);
  });
});
