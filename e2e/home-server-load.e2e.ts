/**
 * T-001-45 — the home page loads the organizer's plan list on the server (ADR-0007).
 * Accounts and plans are set up through the real route handlers and database with the route
 * server. The page's default export is called directly (no HTTP rendering until Playwright)
 * with `next/headers` returning that actor's cookies.
 */
import { randomBytes } from "node:crypto";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import en from "../messages/en.json";
import { HomeList } from "@/components/home-list";
import HomePage from "@/app/page";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { closeDatabase as closeJoin } from "@/server/join/db";
import { closeDatabase as closeAttempt } from "@/server/proposal/attempt";
import { closeDatabase as closeInbox } from "@/server/invites/inbox";
import { cleanupThenClose } from "./db-cleanup";
import { createRouteServer, type RouteServer } from "./route-server";

const { router, cookieJar } = vi.hoisted(() => ({
  router: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
  cookieJar: { value: "" },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/",
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

type ListElement = React.ReactElement<{ initialPlans: unknown }>;

async function call(path: string, method: string, body: unknown): Promise<Response> {
  return server.serve(path, {
    method,
    headers: { "content-type": "application/json", "x-hp-request": "1" },
    body: JSON.stringify(body),
  });
}

async function signUp(displayName: string): Promise<string> {
  server.useCookies("");
  const email = `home-load-${randomBytes(6).toString("hex")}@example.com`;
  emails.push(email);
  const account = await call("/api/v1/accounts", "POST", {
    email,
    password: "password1",
    display_name: displayName,
  });
  expect(account.status).toBe(201);
  return server.cookies();
}

async function createPlan(cookies: string, title: string): Promise<string> {
  server.useCookies(cookies);
  const created = await call("/api/v1/plans", "POST", {
    title,
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

function show(element: React.ReactElement) {
  return render(React.createElement(NextIntlClientProvider, { locale: "en", messages: en }, element));
}

/** Call the page as the actor with these cookies; return the HomeList element it renders. */
async function openPage(cookies: string): Promise<ListElement> {
  cookieJar.value = cookies;
  const tree = await HomePage();
  const stack: React.ReactNode[] = [tree];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!React.isValidElement(current)) {
      continue;
    }
    if (current.type === HomeList) {
      return current as ListElement;
    }
    React.Children.forEach((current.props as { children?: React.ReactNode }).children, (child) =>
      stack.push(child),
    );
  }
  throw new Error("the page did not render HomeList");
}

function planListRequests(): string[] {
  return server.requested.filter((entry) => entry.startsWith("GET /api/v1/plans"));
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

async function deleteSeededRows(): Promise<void> {
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

describe("home page loads on the server", () => {
  it("T-001-45/AC-1 GET /api/v1/plans answers the account's organized plans, and the missing-session response without a session", async () => {
    const mine = await signUp("Omar");
    const other = await signUp("Salma");
    const firstId = await createPlan(mine, "Thursday in Maadi");
    const secondId = await createPlan(mine, "Friday in Zamalek");
    await createPlan(other, "Someone else's plan");

    server.useCookies(mine);
    const ok = await server.serve("/api/v1/plans");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      plans: [
        { id: secondId, title: "Friday in Zamalek", answered_count: 0, threshold: 3, state: "collecting" },
        { id: firstId, title: "Thursday in Maadi", answered_count: 0, threshold: 3, state: "collecting" },
      ],
      truncated: false,
    });

    for (const cookies of ["", "hp_session=not-a-real-token"]) {
      server.useCookies(cookies);
      const missing = await server.serve("/api/v1/plans");
      expect(missing.status, cookies).toBe(401);
      expect(await missing.json(), cookies).toMatchObject({
        error: { code: "unauthenticated", reason: "missing_session", fields: [] },
      });
    }
    expect(server.unserved).toEqual([]);
  });

  it("T-001-45/AC-2 the page renders HomeList with the account's plans as initial data, and the list fetches no plans on first render", async () => {
    const mine = await signUp("Omar");
    const other = await signUp("Salma");
    const planId = await createPlan(mine, "Thursday in Maadi");
    await createPlan(other, "Someone else's plan");

    const rendered = await openPage(mine);
    expect(rendered.props.initialPlans).toEqual({
      plans: [
        { id: planId, title: "Thursday in Maadi", answered_count: 0, threshold: 3, state: "collecting" },
      ],
      truncated: false,
    });

    server.useCookies(mine);
    server.requested.length = 0;
    show(rendered);
    expect(await screen.findByText("Thursday in Maadi")).toBeTruthy();
    expect(screen.getByText(en.Home.state.collecting)).toBeTruthy();
    expect(document.body.textContent).not.toContain("Someone else's plan");
    expect(screen.queryByRole("alert")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(planListRequests()).toEqual([]);
  });

  it("T-001-45/AC-2 an account with no plans gets an empty list as initial data and sees the empty text", async () => {
    const mine = await signUp("Omar");

    const rendered = await openPage(mine);
    expect(rendered.props.initialPlans).toEqual({ plans: [], truncated: false });

    server.useCookies(mine);
    server.requested.length = 0;
    show(rendered);
    expect(await screen.findByText(en.Home.empty)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(planListRequests()).toEqual([]);
  });

  it("T-001-45/AC-4 the page renders HomeList with no initial data and the signed-out home, for no cookie and an invalid hp_session", async () => {
    const mine = await signUp("Omar");
    await createPlan(mine, "Private Thursday");

    for (const [label, cookies] of [
      ["no cookie", ""],
      ["invalid hp_session", "hp_session=not-a-real-token"],
    ] as const) {
      const rendered = await openPage(cookies);
      expect(rendered.props.initialPlans, label).toBeNull();
      cleanup();
      server.useCookies(cookies);
      server.requested.length = 0;
      show(rendered);
      expect(await screen.findByText(en.Home.signedOutFriends), label).toBeTruthy();
      expect(screen.getByRole("link", { name: en.Home.create }).getAttribute("href"), label).toBe(
        "/account?next=/plans/new",
      );
      expect(screen.queryByRole("alert"), label).toBeNull();
      expect(document.body.textContent, label).not.toContain("Private Thursday");
      expect(screen.queryByText(en.Home.empty), label).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(planListRequests(), label).toEqual([]);
    }
  });
});
