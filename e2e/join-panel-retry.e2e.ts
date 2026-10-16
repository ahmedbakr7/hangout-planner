/**
 * T-001-56 — JoinPanel's Retry shares the first load's guard. The plan, the participant and the
 * opening answer come from the real route handlers and database (route server); only the first
 * load's failure and the timing of the retry's answer are injected at `fetch`.
 */
import { randomBytes } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import en from "../messages/en.json";
import { JoinPanel } from "@/components/join-panel";
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

/** A collecting plan and a participant of it; returns the join token and the participant's cookies. */
async function seedParticipant(): Promise<{ token: string; participant: string }> {
  server.useCookies("");
  const email = `join-retry-${randomBytes(6).toString("hex")}@example.com`;
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
  const plan = (await created.json()) as { id: string; join_path: string };
  planIds.push(plan.id);
  const token = plan.join_path.slice("/join/".length);

  server.useCookies("");
  const joined = await call(`/api/v1/join/${token}`, "POST", {
    kind: "anonymous",
    display_name: "Hana",
  });
  expect(joined.status).toBe(201);
  return { token, participant: server.cookies() };
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

describe("join panel retry", () => {
  it("T-001-56/AC-3 a retry answered after unmount, for an opening whose next is respond, does not navigate", async () => {
    const { token, participant } = await seedParticipant();
    server.useCookies(participant);

    const openingPath = `/api/v1/join/${token}`;
    let openingRequests = 0;
    let releaseRetry: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    let retryAnswer: Promise<Response> | null = null;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== openingPath) {
        return server.serve(input, init);
      }
      openingRequests += 1;
      if (openingRequests === 1) {
        return Promise.reject(new TypeError("network down"));
      }
      retryAnswer = held.then(() => server.serve(input, init));
      return retryAnswer;
    });

    const view = render(
      React.createElement(
        NextIntlClientProvider,
        { locale: "en", messages: en },
        React.createElement(JoinPanel, { token }),
      ),
    );
    fireEvent.click(await screen.findByRole("button", { name: en.common.retry }));
    await waitFor(() => expect(openingRequests).toBe(2));

    view.unmount();
    releaseRetry();
    const answer = await retryAnswer!;
    // The real handler answers this participant with next "respond".
    expect(((await answer.clone().json()) as { next: string }).next).toBe("respond");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(server.unserved).toEqual([]);
  });
});
