/**
 * T-001-55 — a locked plan lands on /plans/{planId}/confirmed. Plans are set up through the real
 * route handlers and database with the route server. The confirmed page's default export is called
 * directly with `next/headers` returning that actor's cookies; InvitePanel and InvitationsList are
 * rendered against the route server with `next/navigation` mocked to record navigation.
 */
import { randomBytes } from "node:crypto";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import en from "../messages/en.json";
import { ConfirmedView } from "@/components/confirmed-view";
import { InvitationsList, InvitePanel } from "@/components/invite-panel";
import ConfirmedPage from "@/app/plans/[planId]/confirmed/page";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { closeDatabase as closeJoin } from "@/server/join/db";
import { closeDatabase as closeAttempt } from "@/server/proposal/attempt";
import { closeDatabase as closeInbox } from "@/server/invites/inbox";
import { cleanupThenClose } from "./db-cleanup";
import { teardownThenAssertServed } from "./teardown";
import { createRouteServer, type RouteServer } from "./route-server";

const { router, cookieJar } = vi.hoisted(() => ({
  router: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
  cookieJar: { value: "" },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/invitations",
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

type Seeded = {
  planId: string;
  organizer: string;
  participant: string;
  invited: string;
  inviteeEmail: string;
};

/** A collecting plan owned by a new account, joined by an anonymous participant and sent to an invited account. */
async function seedPlan(title: string): Promise<Seeded> {
  server.useCookies("");
  const email = `confirmed-landing-${randomBytes(6).toString("hex")}@example.com`;
  emails.push(email);
  const account = await call("/api/v1/accounts", "POST", {
    email,
    password: "password1",
    display_name: "Omar",
  });
  expect(account.status).toBe(201);
  const organizer = server.cookies();

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

  server.useCookies("");
  const joined = await call(`/api/v1/join/${token}`, "POST", {
    kind: "anonymous",
    display_name: "Hana",
  });
  expect(joined.status).toBe(201);
  const participant = server.cookies();

  server.useCookies("");
  const inviteeEmail = `confirmed-landing-${randomBytes(6).toString("hex")}@example.com`;
  emails.push(inviteeEmail);
  const invitee = await call("/api/v1/accounts", "POST", {
    email: inviteeEmail,
    password: "password1",
    display_name: "Salma",
  });
  expect(invitee.status).toBe(201);
  const invited = server.cookies();
  server.useCookies(organizer);
  const invitation = await call(`/api/v1/plans/${plan.id}/invitations`, "POST", {
    email: inviteeEmail,
  });
  expect(invitation.status).toBe(200);
  return { planId: plan.id, organizer, participant, invited, inviteeEmail };
}

async function lock(planId: string): Promise<void> {
  await sql`UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${planId}`;
}

function show(element: React.ReactElement) {
  return render(React.createElement(NextIntlClientProvider, { locale: "en", messages: en }, element));
}

/** Call the page as the actor with these cookies; return the ConfirmedView element it renders. */
async function openPage(planId: string, cookies: string): Promise<React.ReactElement<{ planId: string }>> {
  cookieJar.value = cookies;
  const tree = await ConfirmedPage({ params: Promise.resolve({ planId }) });
  const stack: React.ReactNode[] = [tree];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!React.isValidElement(current)) {
      continue;
    }
    if (current.type === ConfirmedView) {
      return current as React.ReactElement<{ planId: string }>;
    }
    React.Children.forEach((current.props as { children?: React.ReactNode }).children, (child) =>
      stack.push(child),
    );
  }
  throw new Error("the page did not render ConfirmedView");
}

beforeEach(() => {
  server = createRouteServer();
  vi.stubGlobal("fetch", server.serve);
  process.env.HP_HASH_TEST = "1";
  router.push.mockClear();
  router.replace.mockClear();
});

afterEach(() => {
  teardownThenAssertServed(
    server.unserved,
    () => cleanup(),
    () => vi.unstubAllGlobals(),
    () => {
      delete process.env.HP_HASH_TEST;
    },
    () => {
      cookieJar.value = "";
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
    const links = await sql<{ id: string }[]>`
      SELECT DISTINCT link_session_id AS id FROM link_session_plans WHERE plan_id = ${planId}
    `;
    await sql`DELETE FROM proposal_runs WHERE plan_id = ${planId}`;
    await sql`DELETE FROM response_picks WHERE participant_id IN (${participants})`;
    await sql`DELETE FROM response_windows WHERE participant_id IN (${participants})`;
    await sql`DELETE FROM responses WHERE participant_id IN (${participants})`;
    await sql`DELETE FROM participants WHERE plan_id = ${planId}`;
    await sql`DELETE FROM link_session_plans WHERE plan_id = ${planId}`;
    await sql`DELETE FROM invitations WHERE plan_id = ${planId}`;
    await sql`DELETE FROM plan_options WHERE step_id IN (SELECT id FROM plan_steps WHERE plan_id = ${planId})`;
    await sql`DELETE FROM plan_steps WHERE plan_id = ${planId}`;
    await sql`DELETE FROM plan_windows WHERE plan_id = ${planId}`;
    await sql`DELETE FROM plans WHERE id = ${planId}`;
    for (const link of links) {
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

describe("a locked plan lands on the confirmed surface", () => {
  it("T-001-55/AC-1 the /plans/{planId}/confirmed page renders ConfirmedView for that planId", async () => {
    const { planId, organizer, participant } = await seedPlan("Landing Thursday");
    const other = await seedPlan("Another plan");
    await lock(planId);
    await lock(other.planId);

    for (const cookies of [organizer, participant]) {
      const rendered = await openPage(planId, cookies);
      expect(rendered.props.planId).toBe(planId);
    }
    expect((await openPage(other.planId, other.organizer)).props.planId).toBe(other.planId);
  });

  it("T-001-55/AC-2 InvitePanel sends a locked plan to /plans/{planId}/confirmed when an invitation request answers plan_locked", async () => {
    const { planId, organizer, inviteeEmail } = await seedPlan("Locked while inviting");
    server.useCookies(organizer);
    const loaded = await server.serve(`/api/v1/plans/${planId}/invite`);
    expect(loaded.status).toBe(200);
    const initialInvite = await loaded.json();

    show(React.createElement(InvitePanel, { planId, initialInvite }));
    await lock(planId);
    fireEvent.change(await screen.findByLabelText(en.invite.email), {
      target: { value: inviteeEmail },
    });
    fireEvent.click(screen.getByRole("button", { name: en.invite.send }));

    await vi.waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
    expect(router.replace).toHaveBeenCalledWith(`/plans/${planId}/confirmed`);
    expect(server.requested).toContain(`POST /api/v1/plans/${planId}/invitations`);
  });

  it("T-001-55/AC-2 an invitations row for a locked plan opens /plans/{planId}/confirmed, from its own next and from opening", async () => {
    const { planId, invited } = await seedPlan("Locked invitation");
    await lock(planId);
    const row = (next?: string) => ({
      invitations: [
        {
          plan_id: planId,
          title: "Locked invitation",
          organizer_display_name: "Omar",
          ...(next ? { next } : {}),
        },
      ],
      truncated: false,
    });

    server.useCookies(invited);
    const listed = await server.serve("/api/v1/invitations");
    expect(listed.status).toBe(200);

    for (const initialInbox of [await listed.json(), row("confirmed"), row()]) {
      router.push.mockClear();
      show(React.createElement(InvitationsList, { initialInbox }));
      fireEvent.click(await screen.findByRole("button", { name: /Locked invitation/ }));
      await vi.waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
      expect(router.push).toHaveBeenCalledWith(`/plans/${planId}/confirmed`);
      cleanup();
    }
  });

  it("T-001-55/AC-3 GET /api/v1/plans/{planId}/opening for a locked plan gives next confirmed to the organizer and to a participant", async () => {
    const { planId, organizer, participant } = await seedPlan("Locked opening");
    await lock(planId);
    for (const [label, cookies] of [
      ["organizer", organizer],
      ["participant", participant],
    ] as const) {
      server.useCookies(cookies);
      const response = await server.serve(`/api/v1/plans/${planId}/opening`);
      expect(response.status, label).toBe(200);
      expect(await response.json(), label).toMatchObject({ plan_id: planId, next: "confirmed" });
    }
  });
});
