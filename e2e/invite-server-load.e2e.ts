/**
 * T-001-41 — the invite page loads the share link and invitations on the server (ADR-0007).
 * Plans are set up through the real route handlers and database with the route server. The
 * page's default export is called directly (no HTTP rendering until Playwright) with
 * `next/headers` returning that actor's cookies and `redirect` mocked.
 */
import { randomBytes } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import en from "../messages/en.json";
import { InvitePanel } from "@/components/invite-panel";
import InvitePage from "@/app/plans/[planId]/invite/page";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { closeDatabase as closeJoin } from "@/server/join/db";
import { closeDatabase as closeAttempt } from "@/server/proposal/attempt";
import { closeDatabase as closeInbox } from "@/server/invites/inbox";
import { cleanupThenClose } from "./db-cleanup";
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

let server: RouteServer;

type PanelElement = React.ReactElement<{ planId: string; initialInvite: unknown }>;

async function call(path: string, method: string, body: unknown): Promise<Response> {
  return server.serve(path, {
    method,
    headers: { "content-type": "application/json", "x-hp-request": "1" },
    body: JSON.stringify(body),
  });
}

async function signUp(displayName: string): Promise<{ email: string; cookies: string }> {
  server.useCookies("");
  const email = `invite-load-${randomBytes(6).toString("hex")}@example.com`;
  emails.push(email);
  const account = await call("/api/v1/accounts", "POST", {
    email,
    password: "password1",
    display_name: displayName,
  });
  expect(account.status).toBe(201);
  return { email, cookies: server.cookies() };
}

type Seeded = {
  planId: string;
  joinPath: string;
  organizer: string;
  participant: string;
  linkReader: string;
  invited: string;
};

/** A collecting plan owned by a new account, with a participant, a link reader and an invited account. */
async function seedPlan(title: string): Promise<Seeded> {
  const { cookies: organizer } = await signUp("Omar");
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
  const plan = (await created.json()) as { id: string; join_path: string };
  planIds.push(plan.id);
  const token = plan.join_path.slice("/join/".length);

  const { email: inviteeEmail, cookies: invited } = await signUp("Hana");
  server.useCookies(organizer);
  const sent = await call(`/api/v1/plans/${plan.id}/invitations`, "POST", { email: inviteeEmail });
  expect(sent.status).toBe(200);

  server.useCookies("");
  const joined = await call(`/api/v1/join/${token}`, "POST", {
    kind: "anonymous",
    display_name: "Nour",
  });
  expect(joined.status).toBe(201);
  const participant = server.cookies();

  server.useCookies("");
  const opened = await server.serve(`/api/v1/join/${token}`);
  expect(opened.status).toBe(200);
  const linkReader = server.cookies();
  return { planId: plan.id, joinPath: plan.join_path, organizer, participant, linkReader, invited };
}

async function setState(planId: string, state: string): Promise<void> {
  if (state === "locked") {
    await sql`UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${planId}`;
    return;
  }
  await sql`UPDATE plans SET state = ${state} WHERE id = ${planId}`;
}

function show(element: React.ReactElement) {
  return render(React.createElement(NextIntlClientProvider, { locale: "en", messages: en }, element));
}

/** Call the page as the actor with these cookies; return the InvitePanel element it renders. */
async function openPage(planId: string, cookies: string): Promise<PanelElement> {
  cookieJar.value = cookies;
  const tree = await InvitePage({ params: Promise.resolve({ planId }) });
  const stack: React.ReactNode[] = [tree];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!React.isValidElement(current)) {
      continue;
    }
    if (current.type === InvitePanel) {
      return current as PanelElement;
    }
    React.Children.forEach((current.props as { children?: React.ReactNode }).children, (child) =>
      stack.push(child),
    );
  }
  throw new Error("the page did not render InvitePanel");
}

beforeEach(() => {
  server = createRouteServer();
  vi.stubGlobal("fetch", server.serve);
  process.env.HP_HASH_TEST = "1";
  redirectMock.mockClear();
  router.replace.mockClear();
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
      await sql`DELETE FROM link_session_plans WHERE link_session_id = ${link.id}`;
      await sql`DELETE FROM link_sessions WHERE id = ${link.id}`;
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

describe("invite page loads on the server", () => {
  it("T-001-41/AC-1 GET /api/v1/plans/{planId}/invite answers 200, 403, 404 and 409 plan_locked as before", async () => {
    const open = await seedPlan("Open Thursday");
    const locked = await seedPlan("Locked in Zamalek");
    await setState(locked.planId, "locked");

    server.useCookies(open.organizer);
    const ok = await server.serve(`/api/v1/plans/${open.planId}/invite`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      join_path: open.joinPath,
      invitations: [
        { display_name: "Hana", distinguisher: expect.any(String), status: "invited" },
      ],
    });

    for (const [label, cookies] of [
      ["participant", open.participant],
      ["invited account", open.invited],
      ["link reader", open.linkReader],
    ] as const) {
      server.useCookies(cookies);
      const denied = await server.serve(`/api/v1/plans/${open.planId}/invite`);
      expect(denied.status, label).toBe(403);
      expect(await denied.json(), label).toMatchObject({
        error: { code: "forbidden", reason: "organizer_only", fields: [] },
      });
    }

    server.useCookies(locked.organizer);
    const lockedResponse = await server.serve(`/api/v1/plans/${locked.planId}/invite`);
    expect(lockedResponse.status).toBe(409);
    expect(await lockedResponse.json()).toMatchObject({
      error: { code: "conflict", reason: "plan_locked", fields: [] },
    });

    server.useCookies(locked.organizer);
    const stranger = await server.serve(`/api/v1/plans/${open.planId}/invite`);
    expect(stranger.status).toBe(404);
    const strangerBody = await stranger.json();
    expect(strangerBody).toMatchObject({ error: { code: "not_found", fields: [] } });
    expect(JSON.stringify(strangerBody)).not.toContain("Open Thursday");

    server.useCookies(open.organizer);
    const unknown = await server.serve("/api/v1/plans/pln_does_not_exist/invite");
    expect(unknown.status).toBe(404);
    expect(server.unserved).toEqual([]);
  });

  it("T-001-41/AC-2 the page renders InvitePanel with the join path and invitations as initial data, and the panel fetches nothing on first render", async () => {
    const { planId, joinPath, organizer } = await seedPlan("Thursday in Maadi");

    const rendered = await openPage(planId, organizer);
    expect(rendered.props.planId).toBe(planId);
    expect(rendered.props.initialInvite).toEqual({
      join_path: joinPath,
      invitations: [
        { display_name: "Hana", distinguisher: expect.any(String), status: "invited" },
      ],
    });
    expect(redirectMock).not.toHaveBeenCalled();

    server.useCookies(organizer);
    server.requested.length = 0;
    show(rendered);
    expect(await screen.findByText(en.invite.linkLabel)).toBeTruthy();
    expect(document.body.textContent).toContain(joinPath);
    expect(screen.getByText("Hana")).toBeTruthy();
    expect(screen.getByText(en.invite.statusInvited)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(server.requested).toEqual([]);
  });

  it("T-001-41/AC-3 the page redirects the organizer of a locked plan to the confirmed page", async () => {
    const { planId, organizer } = await seedPlan("Locked Thursday");
    await setState(planId, "locked");

    await expect(openPage(planId, organizer)).rejects.toThrow(
      new Error(`NEXT_REDIRECT /plans/${planId}/confirmed`),
    );
    expect(redirectMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith(`/plans/${planId}/confirmed`);
  });

  it("T-001-41/AC-4 the page renders InvitePanel with no initial data, and the load error, for no cookie, a participant, a stranger and an unknown plan", async () => {
    const { planId, participant } = await seedPlan("Private Thursday");
    const other = await seedPlan("Someone else's plan");

    const cases: [string, string, string][] = [
      ["no cookie", planId, ""],
      ["participant", planId, participant],
      ["stranger", planId, other.organizer],
      ["unknown plan", "pln_does_not_exist", other.organizer],
    ];
    for (const [label, id, cookies] of cases) {
      const rendered = await openPage(id, cookies);
      expect(rendered.props.initialInvite, label).toBeNull();
      cleanup();
      server.useCookies(cookies);
      server.requested.length = 0;
      show(rendered);
      const alert = await screen.findByRole("alert");
      expect(alert.textContent, label).toBe(en.invite.loadError);
      expect(document.body.textContent, label).not.toContain("Private Thursday");
      expect(document.body.textContent, label).not.toContain("Hana");
      expect(document.body.textContent, label).not.toContain("/join/");
      expect(server.requested, label).toEqual([]);
    }
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("T-001-41/AC-6 sending an invitation and copying the link from the panel behave as before", async () => {
    const { planId, organizer, joinPath } = await seedPlan("Thursday in Maadi");
    const extra = await signUp("Salma");
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    server.useCookies(organizer);
    show(await openPage(planId, organizer));
    expect(await screen.findByText("Hana")).toBeTruthy();

    server.useCookies(organizer);
    fireEvent.change(screen.getByLabelText(en.invite.email), { target: { value: extra.email } });
    fireEvent.click(screen.getByRole("button", { name: en.invite.send }));
    expect(await screen.findByText("Salma")).toBeTruthy();
    expect(screen.getByText("Hana")).toBeTruthy();

    const list = (await (await server.serve(`/api/v1/plans/${planId}/invite`)).json()) as {
      invitations: { display_name: string }[];
    };
    expect(list.invitations.map((row) => row.display_name)).toEqual(["Hana", "Salma"]);

    fireEvent.click(screen.getByRole("button", { name: en.invite.copy }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = (writeText.mock.calls[0] as unknown as [string])[0];
    expect(copied.endsWith(joinPath)).toBe(true);
    expect(screen.queryByText(en.invite.copyFailed)).toBeNull();
  });
});
