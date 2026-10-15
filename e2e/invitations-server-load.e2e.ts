/**
 * T-001-47 — the invitations page loads the inbox on the server (ADR-0007).
 * Accounts, plans and invitations are set up through the real route handlers and database
 * with the route server. The page's default export is called directly (no HTTP rendering
 * until Playwright) with `next/headers` returning that actor's cookies.
 */
import { randomBytes } from "node:crypto";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import en from "../messages/en.json";
import { InvitationsList } from "@/components/invite-panel";
import InvitationsPage from "@/app/invitations/page";
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
  usePathname: () => "/invitations",
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

type ListElement = React.ReactElement<{ initialInbox: unknown }>;

async function call(path: string, method: string, body: unknown): Promise<Response> {
  return server.serve(path, {
    method,
    headers: { "content-type": "application/json", "x-hp-request": "1" },
    body: JSON.stringify(body),
  });
}

async function signUp(displayName: string): Promise<{ email: string; cookies: string }> {
  server.useCookies("");
  const email = `invitations-load-${randomBytes(6).toString("hex")}@example.com`;
  emails.push(email);
  const account = await call("/api/v1/accounts", "POST", {
    email,
    password: "password1",
    display_name: displayName,
  });
  expect(account.status).toBe(201);
  return { email, cookies: server.cookies() };
}

/** A plan owned by `organizer`; returns its id. */
async function createPlan(organizer: string, title: string): Promise<string> {
  server.useCookies(organizer);
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

async function invite(organizer: string, planId: string, email: string): Promise<void> {
  server.useCookies(organizer);
  const sent = await call(`/api/v1/plans/${planId}/invitations`, "POST", { email });
  expect(sent.status).toBe(200);
}

function show(element: React.ReactElement) {
  return render(React.createElement(NextIntlClientProvider, { locale: "en", messages: en }, element));
}

/** Call the page as the actor with these cookies; return the InvitationsList element it renders. */
async function openPage(cookies: string): Promise<ListElement> {
  cookieJar.value = cookies;
  const tree = await InvitationsPage();
  const stack: React.ReactNode[] = [tree];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!React.isValidElement(current)) {
      continue;
    }
    if (current.type === InvitationsList) {
      return current as ListElement;
    }
    React.Children.forEach((current.props as { children?: React.ReactNode }).children, (child) =>
      stack.push(child),
    );
  }
  throw new Error("the page did not render InvitationsList");
}

function inboxRequests(): string[] {
  return server.requested.filter((entry) => entry.startsWith("GET /api/v1/invitations"));
}

beforeEach(() => {
  server = createRouteServer();
  vi.stubGlobal("fetch", server.serve);
  process.env.HP_HASH_TEST = "1";
  router.push.mockClear();
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

describe("invitations page loads on the server", () => {
  it("T-001-47/AC-1 GET /api/v1/invitations answers the account's invitation rows, and the missing-session response without a session", async () => {
    const organizer = await signUp("Omar");
    const invitee = await signUp("Hana");
    const other = await signUp("Salma");
    const first = await createPlan(organizer.cookies, "Thursday in Maadi");
    const second = await createPlan(organizer.cookies, "Friday in Zamalek");
    const unrelated = await createPlan(organizer.cookies, "Not invited here");
    await invite(organizer.cookies, first, invitee.email);
    await invite(organizer.cookies, second, invitee.email);
    await invite(organizer.cookies, unrelated, other.email);
    // A further invitation to the same plan keeps a single row (F-001-18).
    await invite(organizer.cookies, first, invitee.email);

    server.useCookies(invitee.cookies);
    const ok = await server.serve("/api/v1/invitations");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      invitations: [
        { plan_id: second, title: "Friday in Zamalek", organizer_display_name: "Omar" },
        { plan_id: first, title: "Thursday in Maadi", organizer_display_name: "Omar" },
      ],
      truncated: false,
    });

    for (const cookies of ["", "hp_session=not-a-real-token"]) {
      server.useCookies(cookies);
      const missing = await server.serve("/api/v1/invitations");
      expect(missing.status, cookies).toBe(401);
      expect(await missing.json(), cookies).toMatchObject({
        error: { code: "unauthenticated", reason: "missing_session", fields: [] },
      });
    }
    expect(server.unserved).toEqual([]);
  });

  it("T-001-47/AC-2 the page renders InvitationsList with the account's invitations as initial data, and the list shows each row and fetches no inbox on first render", async () => {
    const organizer = await signUp("Omar");
    const invitee = await signUp("Hana");
    const other = await signUp("Salma");
    const planId = await createPlan(organizer.cookies, "Thursday in Maadi");
    const unrelated = await createPlan(organizer.cookies, "Someone else's plan");
    await invite(organizer.cookies, planId, invitee.email);
    await invite(organizer.cookies, unrelated, other.email);

    const rendered = await openPage(invitee.cookies);
    expect(rendered.props.initialInbox).toEqual({
      invitations: [
        { plan_id: planId, title: "Thursday in Maadi", organizer_display_name: "Omar" },
      ],
      truncated: false,
    });

    server.useCookies(invitee.cookies);
    server.requested.length = 0;
    show(rendered);
    expect(await screen.findByText("Thursday in Maadi")).toBeTruthy();
    expect(screen.getByText(en.invitations.organizedBy.replace("{name}", "Omar"))).toBeTruthy();
    expect(document.body.textContent).not.toContain("Someone else's plan");
    expect(screen.queryByRole("alert")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(inboxRequests()).toEqual([]);
  });

  it("T-001-47/AC-2 an account with no invitations gets an empty inbox as initial data and sees the empty text", async () => {
    const lonely = await signUp("Hana");

    const rendered = await openPage(lonely.cookies);
    expect(rendered.props.initialInbox).toEqual({ invitations: [], truncated: false });

    server.useCookies(lonely.cookies);
    server.requested.length = 0;
    show(rendered);
    expect(await screen.findByText(en.invitations.empty)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(inboxRequests()).toEqual([]);
  });

  it("T-001-47/AC-3 the list given initial data sends exactly one GET /api/v1/me after mount, and the signed-out gate sends its own single one", async () => {
    const organizer = await signUp("Omar");
    const invitee = await signUp("Hana");
    const planId = await createPlan(organizer.cookies, "Thursday in Maadi");
    await invite(organizer.cookies, planId, invitee.email);

    const rendered = await openPage(invitee.cookies);
    server.useCookies(invitee.cookies);
    server.requested.length = 0;
    show(rendered);
    expect(await screen.findByText("Thursday in Maadi")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(server.requested.filter((line) => line === "GET /api/v1/me")).toHaveLength(1);
    expect(server.requested).toEqual(["GET /api/v1/me"]);
    cleanup();

    const signedOut = await openPage("");
    server.useCookies("");
    server.requested.length = 0;
    show(signedOut);
    expect(await screen.findByRole("button", { name: en.Account.submitSignIn })).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(server.requested).toEqual(["GET /api/v1/me"]);
  });

  it("T-001-47/AC-4 the page renders InvitationsList with no initial data and the account gate with next /invitations, for no cookie and an invalid hp_session", async () => {
    const organizer = await signUp("Omar");
    const invitee = await signUp("Hana");
    const planId = await createPlan(organizer.cookies, "Private Thursday");
    await invite(organizer.cookies, planId, invitee.email);

    for (const [label, cookies] of [
      ["no cookie", ""],
      ["invalid hp_session", "hp_session=not-a-real-token"],
    ] as const) {
      const rendered = await openPage(cookies);
      expect(rendered.props.initialInbox, label).toBeNull();
      cleanup();
      router.push.mockClear();
      server.useCookies(cookies);
      server.requested.length = 0;
      show(rendered);
      expect(await screen.findByRole("button", { name: en.Account.submitSignIn }), label).toBeTruthy();
      expect(screen.queryByRole("alert"), label).toBeNull();
      expect(document.body.textContent, label).not.toContain("Private Thursday");
      expect(screen.queryByText(en.invitations.empty), label).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(inboxRequests(), label).toEqual([]);

      // The gate's next is /invitations: signing in sends the person back there.
      fireEvent.change(screen.getByLabelText(en.Account.email), { target: { value: invitee.email } });
      fireEvent.change(screen.getByLabelText(en.Account.password), { target: { value: "password1" } });
      fireEvent.click(screen.getByRole("button", { name: en.Account.submitSignIn }));
      await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith("/invitations"));
    }
  });

  it("T-001-47/AC-5 the list given initial data that does not parse shows the inbox error state with the retry button, and retry loads the inbox", async () => {
    const organizer = await signUp("Omar");
    const invitee = await signUp("Hana");
    const planId = await createPlan(organizer.cookies, "Thursday in Maadi");
    await invite(organizer.cookies, planId, invitee.email);

    server.useCookies(invitee.cookies);
    server.requested.length = 0;
    show(React.createElement(InvitationsList, { initialInbox: { invitations: "not a list" } }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(en.invitations.loadError);
    expect(document.body.textContent).not.toContain("Thursday in Maadi");
    expect(inboxRequests()).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: en.invitations.retry }));
    expect(await screen.findByText("Thursday in Maadi")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(inboxRequests()).toEqual(["GET /api/v1/invitations"]);
  });

  it("T-001-47/AC-7 opening a row sends the account to that plan's opening target", async () => {
    const organizer = await signUp("Omar");
    const invitee = await signUp("Hana");
    const planId = await createPlan(organizer.cookies, "Thursday in Maadi");
    await invite(organizer.cookies, planId, invitee.email);

    const opening = await (async () => {
      server.useCookies(invitee.cookies);
      const response = await server.serve(`/api/v1/plans/${planId}/opening`);
      expect(response.status).toBe(200);
      return (await response.json()) as { next: string };
    })();
    expect(opening.next).toBe("join");

    show(await openPage(invitee.cookies));
    server.useCookies(invitee.cookies);
    fireEvent.click(await screen.findByRole("button", { name: /Thursday in Maadi/ }));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    expect(router.push).toHaveBeenCalledWith(`/plans/${planId}/join`);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
