/**
 * T-001-44 — opening /plans/{planId}/join slides the account session again (ADR-0009).
 * The page's default export is called directly with `next/headers` returning the invited
 * account's cookies, and its JoinPanel is rendered with `fetch` routed to the real route
 * handlers and database. Limit: no test drives a real browser. AC-3 (join-panel.test.tsx)
 * proves the hook fires; this test proves the handler the hook calls moves the stored
 * `expires_at` later, which the page load alone does not.
 */
import { randomBytes } from "node:crypto";
import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import en from "../messages/en.json";
import { JoinPanel } from "@/components/join-panel";
import PlanJoinPage from "@/app/plans/[planId]/join/page";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { closeDatabase as closeJoin } from "@/server/join/db";
import { closeDatabase as closeAttempt } from "@/server/proposal/attempt";
import { closeDatabase as closeInbox } from "@/server/invites/inbox";
import { createRouteServer, type RouteServer } from "./route-server";

const { router, cookieJar } = vi.hoisted(() => ({
  router: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
  cookieJar: { value: "" },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  },
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

let server: RouteServer;

async function call(path: string, method: string, body: unknown): Promise<Response> {
  return server.serve(path, {
    method,
    headers: { "content-type": "application/json", "x-hp-request": "1" },
    body: JSON.stringify(body),
  });
}

async function createAccount(name: string): Promise<{ email: string; cookies: string }> {
  server.useCookies("");
  const email = `slide-${randomBytes(6).toString("hex")}@example.com`;
  emails.push(email);
  const response = await call("/api/v1/accounts", "POST", {
    email,
    password: "password1",
    display_name: name,
  });
  expect(response.status).toBe(201);
  return { email, cookies: server.cookies() };
}

beforeEach(() => {
  server = createRouteServer();
  vi.stubGlobal("fetch", server.serve);
  process.env.HP_HASH_TEST = "1";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete process.env.HP_HASH_TEST;
  cookieJar.value = "";
});

afterAll(async () => {
  for (const planId of planIds) {
    const links = await sql<{ id: string }[]>`
      SELECT link_session_id AS id FROM link_session_plans WHERE plan_id = ${planId}
    `;
    await sql`DELETE FROM link_session_plans WHERE plan_id = ${planId}`;
    for (const link of links) {
      await sql`DELETE FROM link_sessions WHERE id = ${link.id}`;
    }
    await sql`DELETE FROM proposal_runs WHERE plan_id = ${planId}`;
    await sql`DELETE FROM participants WHERE plan_id = ${planId}`;
    await sql`DELETE FROM invitations WHERE plan_id = ${planId}`;
    await sql`DELETE FROM plan_options WHERE step_id IN (SELECT id FROM plan_steps WHERE plan_id = ${planId})`;
    await sql`DELETE FROM plan_steps WHERE plan_id = ${planId}`;
    await sql`DELETE FROM plan_windows WHERE plan_id = ${planId}`;
    await sql`DELETE FROM plans WHERE id = ${planId}`;
  }
  for (const email of emails) {
    await sql`DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE email = ${email})`;
    await sql`DELETE FROM accounts WHERE email = ${email}`;
  }
  await sql.end();
  await Promise.all([closeAccounts(), closePlans(), closeJoin(), closeAttempt(), closeInbox()]);
});

describe("join page slides the account session", () => {
  it("T-001-44/AC-4 opening /plans/{planId}/join with an invited account's hp_session moves that session's expires_at later, as GET /api/v1/me does", async () => {
    const organizer = await createAccount("Omar");
    const invitee = await createAccount("Salma");

    server.useCookies(organizer.cookies);
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
    const invitation = await call(`/api/v1/plans/${plan.id}/invitations`, "POST", {
      email: invitee.email,
    });
    expect(invitation.status).toBe(200);

    const shortExpiry = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    await sql`
      UPDATE sessions SET expires_at = ${shortExpiry}
      WHERE account_id IN (SELECT id FROM accounts WHERE email = ${invitee.email})
    `;
    const storedExpiry = async (): Promise<number> => {
      const rows = await sql<{ expires_at: Date }[]>`
        SELECT expires_at FROM sessions
        WHERE account_id IN (SELECT id FROM accounts WHERE email = ${invitee.email})
      `;
      expect(rows).toHaveLength(1);
      return new Date(rows[0]!.expires_at).getTime();
    };

    // The page load reads the session and does not slide it.
    cookieJar.value = invitee.cookies;
    const tree = await PlanJoinPage({ params: Promise.resolve({ planId: plan.id }) });
    expect(await storedExpiry()).toBe(shortExpiry.getTime());

    // Rendering the page's JoinPanel sends the hook's GET /api/v1/me to the real handler.
    const stack: React.ReactNode[] = [tree];
    let panel: React.ReactElement | undefined;
    while (stack.length > 0 && !panel) {
      const current = stack.pop();
      if (!React.isValidElement(current)) {
        continue;
      }
      if (current.type === JoinPanel) {
        panel = current;
        break;
      }
      React.Children.forEach((current.props as { children?: React.ReactNode }).children, (child) =>
        stack.push(child),
      );
    }
    expect(panel, "the page renders JoinPanel").toBeTruthy();

    server.useCookies(invitee.cookies);
    server.requested.length = 0;
    render(React.createElement(NextIntlClientProvider, { locale: "en", messages: en }, panel));
    await vi.waitFor(async () => {
      expect(await storedExpiry()).toBeGreaterThan(shortExpiry.getTime());
    });
    expect(server.requested.filter((line) => line === "GET /api/v1/me")).toHaveLength(1);
    expect(server.unserved).toEqual([]);
  });
});
