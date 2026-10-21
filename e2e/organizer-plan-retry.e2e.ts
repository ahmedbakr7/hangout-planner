/**
 * T-001-77 — OrganizerPlan's Retry reloads inside the guarded effect. The plan and its lock come
 * from the real route handlers and database (route server); only the first render's failure
 * (an `initialPlan` that fails to parse) and the timing of the reload's answer are injected at
 * `fetch`.
 */
import { randomBytes } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import en from "../messages/en.json";
import { OrganizerPlan } from "@/components/organizer-plan";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { closeDatabase as closeJoin } from "@/server/join/db";
import { closeDatabase as closeAttempt } from "@/server/proposal/attempt";
import { closeDatabase as closeInbox } from "@/server/invites/inbox";
import { cleanupThenClose } from "./db-cleanup";
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

let server: RouteServer;

async function call(path: string, method: string, body: unknown): Promise<Response> {
  return server.serve(path, {
    method,
    headers: { "content-type": "application/json", "x-hp-request": "1" },
    body: JSON.stringify(body),
  });
}

/** A collecting plan owned by a new account; returns its id and the organizer's cookies. */
async function seedPlan(): Promise<{ planId: string; organizer: string }> {
  server.useCookies("");
  const email = `organizer-retry-${randomBytes(6).toString("hex")}@example.com`;
  emails.push(email);
  const account = await call("/api/v1/accounts", "POST", {
    email,
    password: "password1",
    display_name: "Omar",
  });
  expect(account.status).toBe(201);
  const created = await call("/api/v1/plans", "POST", {
    title: "Thursday in Maadi",
    timezone: "Africa/Cairo",
    windows: [{ local_date: "2026-10-02", start_local: "18:00", end_local: "19:00" }],
    budget: { amount_minor: 50_000, currency: "EGP" },
    steps: [{ name: "Dinner", options: ["Koshary", "Grills"] }],
    threshold: 3,
  });
  expect(created.status).toBe(201);
  const plan = (await created.json()) as { id: string };
  planIds.push(plan.id);
  return { planId: plan.id, organizer: server.cookies() };
}

async function lockPlan(planId: string): Promise<void> {
  await sql`UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${planId}`;
}

beforeEach(() => {
  server = createRouteServer();
  process.env.HP_HASH_TEST = "1";
  router.push.mockClear();
  router.replace.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete process.env.HP_HASH_TEST;
});

async function deleteSeededRows(): Promise<void> {
  for (const planId of planIds) {
    const participants = sql`SELECT id FROM participants WHERE plan_id = ${planId}`;
    const guests = await sql<{ id: string }[]>`
      SELECT DISTINCT guest_session_id AS id FROM participants
      WHERE plan_id = ${planId} AND guest_session_id IS NOT NULL
    `;
    await sql`DELETE FROM response_picks WHERE participant_id IN (${participants})`;
    await sql`DELETE FROM response_windows WHERE participant_id IN (${participants})`;
    await sql`DELETE FROM responses WHERE participant_id IN (${participants})`;
    await sql`DELETE FROM participants WHERE plan_id = ${planId}`;
    const links = await sql<{ id: string }[]>`
      SELECT link_session_id AS id FROM link_session_plans WHERE plan_id = ${planId}
    `;
    await sql`DELETE FROM link_session_plans WHERE plan_id = ${planId}`;
    for (const link of links) {
      await sql`DELETE FROM link_session_plans WHERE link_session_id = ${link.id}`;
      await sql`DELETE FROM link_sessions WHERE id = ${link.id}`;
    }
    await sql`DELETE FROM invitations WHERE plan_id = ${planId}`;
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

/**
 * Render OrganizerPlan with a first render that failed to parse and press Retry. The plan is
 * locked in the database first; the reload's answer is held until `release`.
 */
async function pressRetryOnLockedPlan() {
  const { planId, organizer } = await seedPlan();
  server.useCookies(organizer);
  await lockPlan(planId);

  const planPath = `/api/v1/plans/${planId}`;
  let planRequests = 0;
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let answered: Promise<Response> | null = null;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) !== planPath) {
      return server.serve(input, init);
    }
    planRequests += 1;
    const real = held.then(() => server.serve(input, init));
    // Keep a copy: the component consumes the body it is given.
    answered = real.then((response) => response.clone());
    return real;
  });

  const view = render(
    React.createElement(
      NextIntlClientProvider,
      { locale: "en", messages: en },
      React.createElement(OrganizerPlan, { planId, initialPlan: { unparseable: true } }),
    ),
  );
  fireEvent.click(await screen.findByRole("button", { name: en.common.retry }));
  await waitFor(() => expect(planRequests).toBe(1));
  return {
    planId,
    view,
    release,
    settled: async () => {
      const response = await answered!;
      // The real handler says the plan is locked.
      expect(response.status).toBe(409);
      expect(((await response.json()) as { error: { reason: string } }).error.reason).toBe(
        "plan_locked",
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
    },
  };
}

describe("organizer plan retry", () => {
  it("T-001-77/AC-1 a reload answered after unmount, for a locked plan, does not navigate", async () => {
    const run = await pressRetryOnLockedPlan();

    run.view.unmount();
    run.release();
    await run.settled();

    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(server.unserved).toEqual([]);
  });

  it("a reload of a locked plan answered while mounted goes to the confirmed page", async () => {
    const run = await pressRetryOnLockedPlan();

    run.release();
    await run.settled();

    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(`/plans/${run.planId}/confirmed`),
    );
    expect(server.unserved).toEqual([]);
  });
});
