/**
 * T-001-32, T-001-66 — the UI's requests reach real route handlers. Each component renders with
 * `fetch` routed to the route module Next.js would serve the path from (route server), against the
 * real database. A request to a path no route serves fails the test. Each test registers its own
 * account and starts with no cookies.
 */
import { randomBytes } from "node:crypto";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import en from "../messages/en.json";
import { AccountGate } from "@/components/account-gate";
import { CreateForm } from "@/components/create-form";
import { HomeList } from "@/components/home-list";
import { InvitationsList } from "@/components/invite-panel";
import { JoinPanel } from "@/components/join-panel";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { closeDatabase as closeJoin } from "@/server/join/db";
import { closeDatabase as closeAttempt } from "@/server/proposal/attempt";
import { closeDatabase as closeInbox } from "@/server/invites/inbox";
import { cleanupThenClose } from "./db-cleanup";
import { teardownThenAssertServed } from "./teardown";
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

function show(element: React.ReactElement) {
  return render(React.createElement(NextIntlClientProvider, { locale: "en", messages: en }, element));
}

/** Register a new account; the server keeps its session cookie. */
async function register(displayName: string): Promise<{ email: string; cookies: string }> {
  server.useCookies("");
  const email = `ui-paths-${randomBytes(6).toString("hex")}@example.com`;
  emails.push(email);
  const response = await call("/api/v1/accounts", "POST", {
    email,
    password: "password1",
    display_name: displayName,
  });
  expect(response.status).toBe(201);
  expect(server.cookies()).toMatch(/^hp_session=/);
  return { email, cookies: server.cookies() };
}

/** A collecting plan owned by the signed-in account; returns its id and join token. */
async function createPlan(title: string): Promise<{ planId: string; token: string }> {
  const created = await call("/api/v1/plans", "POST", {
    title,
    timezone: "Africa/Cairo",
    windows: [{ local_date: "2026-10-02", start_local: "18:00", end_local: "19:00" }],
    budget: { amount_minor: 50_000, currency: "EGP" },
    steps: [{ name: "Dinner", options: ["Koshary", "Grills"] }],
    threshold: 3,
  });
  expect(created.status).toBe(201);
  const plan = (await created.json()) as { id: string; join_path: string };
  planIds.push(plan.id);
  return { planId: plan.id, token: plan.join_path.slice("/join/".length) };
}

/** Every request the test sent went to an /api/v1 path. */
function expectOnlyApiPaths(): void {
  expect(server.requested.length).toBeGreaterThan(0);
  for (const line of server.requested) {
    expect(line).toMatch(/^[A-Z]+ \/api\/v1\//);
  }
}

function fillValidForm(title: string): void {
  fireEvent.change(screen.getByLabelText(en.Create.planTitle), { target: { value: title } });
  fireEvent.change(screen.getByLabelText(en.Create.timezone), { target: { value: "Africa/Cairo" } });
  fireEvent.click(screen.getByRole("button", { name: en.Create.addWindow }));
  fireEvent.change(screen.getByLabelText(en.Create.date), { target: { value: "2026-10-02" } });
  fireEvent.change(screen.getByLabelText(en.Create.start), { target: { value: "18:00" } });
  fireEvent.change(screen.getByLabelText(en.Create.end), { target: { value: "23:00" } });
  fireEvent.change(screen.getByLabelText(en.Create.amount), { target: { value: "500.00" } });
  fireEvent.click(screen.getByRole("button", { name: en.Create.addStep }));
  fireEvent.change(screen.getByLabelText(en.Create.stepName), { target: { value: "Dinner" } });
  const options = screen.getAllByLabelText(en.Create.optionLabel);
  fireEvent.change(options[0] as HTMLElement, { target: { value: "Koshary" } });
  fireEvent.change(options[1] as HTMLElement, { target: { value: "Grills" } });
  fireEvent.change(screen.getByLabelText(en.Create.threshold), { target: { value: "3" } });
}

beforeEach(() => {
  server = createRouteServer();
  vi.stubGlobal("fetch", server.serve);
  process.env.HP_HASH_TEST = "1";
  router.push.mockClear();
  router.replace.mockClear();
  router.refresh.mockClear();
});

afterEach(() => {
  // Any request no route serves fails the test, as in e2e/plan-paths.e2e.ts.
  teardownThenAssertServed(
    server.unserved,
    () => cleanup(),
    () => vi.unstubAllGlobals(),
    () => {
      delete process.env.HP_HASH_TEST;
    },
  );
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

describe("UI requests against the real route handlers", () => {
  it("T-001-32/AC-2 the account gate shows sign-in on a real 401 from GET /api/v1/me", async () => {
    show(React.createElement(AccountGate, { next: "/plans/new" }));
    expect(await screen.findByText("An account is required to organize a plan.")).toBeTruthy();
    expect(server.requested).toContain("GET /api/v1/me");
  });

  it("T-001-32/AC-2 the account gate shows the account on a real 200 from GET /api/v1/me", async () => {
    await register("Nour");
    show(React.createElement(AccountGate, { next: "/plans/new" }));
    expect(await screen.findByText("Signed in as Nour")).toBeTruthy();
    expect(server.requested).toContain("GET /api/v1/me");
  });

  it("T-001-32/AC-1 T-001-66/AC-1 the home list retries against the real GET /api/v1/plans and shows the empty state", async () => {
    await register("Nour");
    server.requested.length = 0;
    show(React.createElement(HomeList, { initialPlans: { plans: "not a list" } }));
    fireEvent.click(await screen.findByRole("button", { name: en.Home.retry }));
    expect(await screen.findByText(en.Home.empty)).toBeTruthy();
    expect(server.requested).toContain("GET /api/v1/plans");
    expectOnlyApiPaths();
  });

  it("T-001-32/AC-1 T-001-66/AC-2 the invitations list retries against the real GET /api/v1/invitations and shows the empty state", async () => {
    await register("Nour");
    server.requested.length = 0;
    show(React.createElement(InvitationsList, { initialInbox: { invitations: "not a list" } }));
    fireEvent.click(await screen.findByRole("button", { name: en.invitations.retry }));
    expect(await screen.findByText(en.invitations.empty)).toBeTruthy();
    expect(server.requested).toContain("GET /api/v1/invitations");
    expectOnlyApiPaths();
  });

  it("T-001-32/AC-1 T-001-66/AC-3 a valid create form submit posts to the real route, stores a collecting plan and opens it", async () => {
    await register("Omar");
    const currencies = await (await server.serve("/api/v1/currencies")).json();
    server.requested.length = 0;
    const title = `Create ${randomBytes(6).toString("hex")}`;
    show(React.createElement(CreateForm, { initialCurrencies: currencies }));
    fillValidForm(title);
    fireEvent.click(screen.getByRole("button", { name: en.Create.submit }));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    const target = String(router.push.mock.calls[0]?.[0]);
    expect(target).toMatch(/^\/plans\/pln_/);
    const planId = target.slice("/plans/".length);
    planIds.push(planId);
    const rows = await sql<{ state: string; answered_count: number; title: string }[]>`
      SELECT state, answered_count, title FROM plans WHERE id = ${planId}
    `;
    expect(rows).toEqual([{ state: "collecting", answered_count: 0, title }]);
    expect(server.requested.filter((line) => line === "POST /api/v1/plans")).toHaveLength(1);
    expectOnlyApiPaths();
  });

  it("T-001-66/AC-4 a create form submit without a session shows the real 401 text, keeps the title and stores no plan", async () => {
    await register("Omar");
    const currencies = await (await server.serve("/api/v1/currencies")).json();
    const title = `Gone ${randomBytes(6).toString("hex")}`;
    show(React.createElement(CreateForm, { initialCurrencies: currencies }));
    fillValidForm(title);
    server.useCookies("");
    server.requested.length = 0;
    fireEvent.click(screen.getByRole("button", { name: en.Create.submit }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(en.errors.reason.missing_session);
    expect((screen.getByLabelText(en.Create.planTitle) as HTMLInputElement).value).toBe(title);
    expect(router.push).not.toHaveBeenCalled();
    expect(server.requested).toContain("POST /api/v1/plans");
    const [{ count }] = await sql<{ count: string }[]>`SELECT count(*) FROM plans WHERE title = ${title}`;
    expect(Number(count)).toBe(0);
  });

  it("T-001-32/AC-1 T-001-66/AC-5 join without an account posts to the real route, stores the participant and opens the response", async () => {
    await register("Omar");
    const title = `Join ${randomBytes(6).toString("hex")}`;
    const { planId, token } = await createPlan(title);
    server.useCookies("");
    server.requested.length = 0;
    show(React.createElement(JoinPanel, { token }));
    expect(await screen.findByText(title)).toBeTruthy();
    expect(server.requested).toContain(`GET /api/v1/join/${token}`);
    expect(server.requested).toContain("GET /api/v1/me");
    fireEvent.change(screen.getByLabelText(en.join.displayName), { target: { value: "Hana" } });
    fireEvent.click(screen.getByRole("button", { name: en.join.joinWithoutAccount }));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(`/plans/${planId}/respond`));
    const rows = await sql<{ display_name: string; guest_session_id: string | null }[]>`
      SELECT display_name, guest_session_id FROM participants WHERE plan_id = ${planId}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.display_name).toBe("Hana");
    expect(rows[0]?.guest_session_id).toBeTruthy();
    expect(server.requested).toContain(`POST /api/v1/join/${token}`);
    expectOnlyApiPaths();
  });

  it("T-001-32/AC-1 T-001-66/AC-6 an invited account joins through the real POST /api/v1/plans/{planId}/join and opens the response", async () => {
    const organizer = await register("Omar");
    const { planId } = await createPlan(`Invited ${randomBytes(6).toString("hex")}`);
    const invitee = await register("Salma");
    server.useCookies(organizer.cookies);
    const invitation = await call(`/api/v1/plans/${planId}/invitations`, "POST", { email: invitee.email });
    expect(invitation.status).toBe(200);

    server.useCookies(invitee.cookies);
    const me = (await (await server.serve("/api/v1/me")).json()) as { account: { id: string } };
    const opening = (await (await server.serve(`/api/v1/plans/${planId}/opening`)).json()) as { next: string };
    expect(opening.next).toBe("join");
    server.requested.length = 0;
    show(React.createElement(JoinPanel, { planId, initialOpening: opening, initialSignedIn: true }));
    fireEvent.click(await screen.findByRole("button", { name: en.join.joinWithAccount }));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(`/plans/${planId}/respond`));
    const rows = await sql<{ account_id: string }[]>`
      SELECT account_id FROM participants WHERE plan_id = ${planId}
    `;
    expect(rows).toEqual([{ account_id: me.account.id }]);
    expect(server.requested).toContain(`POST /api/v1/plans/${planId}/join`);
    expectOnlyApiPaths();
  });

  it("T-001-32/AC-1 T-001-66/AC-7 a token no plan has gets the real 404 and the unknown-link text", async () => {
    const token = `jt_${randomBytes(32).toString("base64url")}`;
    show(React.createElement(JoinPanel, { token }));
    expect(await screen.findByText(en.join.unknownLink)).toBeTruthy();
    expect(server.requested).toContain(`GET /api/v1/join/${token}`);
    expectOnlyApiPaths();
  });
});
