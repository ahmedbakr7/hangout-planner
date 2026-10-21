/**
 * T-001-78 — ConfirmedView's Retry reloads in one guarded effect. The plan, the not-locked answer
 * and the opening come from the real route handlers and database (route server); only the first
 * render's failure (an unparseable initialDoc) and the timing of the opening's answer are injected
 * at `fetch`.
 */
import { randomBytes } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import en from "../messages/en.json";
import { ConfirmedView } from "@/components/confirmed-view";
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

/** A collecting (not locked) plan; the route server keeps its organizer's cookies. */
async function seedOrganizerPlan(): Promise<string> {
  server.useCookies("");
  const email = `confirmed-retry-${randomBytes(6).toString("hex")}@example.com`;
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
  return plan.id;
}

/** Everything is served for real; only the opening's answer waits until release(). */
function holdOpening(planId: string): {
  requests: () => number;
  release: () => void;
  answer: () => Promise<Response>;
} {
  const openingPath = `/api/v1/plans/${planId}/opening`;
  let requests = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let answer: Promise<Response> | null = null;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) !== openingPath) {
      return server.serve(input, init);
    }
    requests += 1;
    answer = gate.then(() => server.serve(input, init));
    return answer;
  });
  return { requests: () => requests, release, answer: () => answer! };
}

function renderView(planId: string): ReturnType<typeof render> {
  return render(
    React.createElement(
      NextIntlClientProvider,
      { locale: "en", messages: en },
      React.createElement(ConfirmedView, { planId, initialDoc: { unparseable: true } }),
    ),
  );
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

describe("confirmed view retry", () => {
  it("T-001-78/AC-1 a retry answered after unmount, for an unlocked plan whose opening names another page, does not navigate", async () => {
    const planId = await seedOrganizerPlan();
    const held = holdOpening(planId);

    const view = renderView(planId);
    fireEvent.click(await screen.findByRole("button", { name: en.common.retry }));
    await waitFor(() => expect(held.requests()).toBe(1));

    view.unmount();
    held.release();
    const answer = await held.answer();
    // The real handler answers the organizer of this unlocked plan with next "organizer".
    expect(((await answer.clone().json()) as { next: string }).next).toBe("organizer");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(server.unserved).toEqual([]);
  });

  it("while mounted, the same reload sends the viewer to the opening's page", async () => {
    const planId = await seedOrganizerPlan();
    const held = holdOpening(planId);

    renderView(planId);
    fireEvent.click(await screen.findByRole("button", { name: en.common.retry }));
    await waitFor(() => expect(held.requests()).toBe(1));
    held.release();

    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
    expect(router.replace.mock.calls[0]?.[0]).toBe(`/plans/${planId}`);
    expect(server.unserved).toEqual([]);
  });
});
