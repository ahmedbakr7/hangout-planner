/**
 * T-001-40 — the respond page loads the participant's response on the server (ADR-0007). Plans
 * are set up through the real route handlers and database with the route server. The page's
 * default export is called directly (no HTTP rendering until Playwright) with `next/headers`
 * returning that actor's cookies and `redirect` mocked.
 */
import { randomBytes } from "node:crypto";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import en from "../messages/en.json";
import { ResponseForm } from "@/components/response-form";
import RespondPage from "@/app/plans/[planId]/respond/page";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { closeDatabase as closeJoin } from "@/server/join/db";
import { closeDatabase as closeAttempt } from "@/server/proposal/attempt";
import { closeDatabase as closeInbox } from "@/server/invites/inbox";
import { setGoogleClientOptions as setResponseGoogle } from "@/server/response/google";
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
const TITLE = "Thursday in Maadi";

let server: RouteServer;

type FormElement = React.ReactElement<{ planId: string; initialResponse: unknown }>;

async function call(path: string, method: string, body: unknown): Promise<Response> {
  return server.serve(path, {
    method,
    headers: { "content-type": "application/json", "x-hp-request": "1" },
    body: JSON.stringify(body),
  });
}

async function newAccount(name: string): Promise<string> {
  server.useCookies("");
  const email = `respond-load-${randomBytes(6).toString("hex")}@example.com`;
  emails.push(email);
  const account = await call("/api/v1/accounts", "POST", {
    email,
    password: "password1",
    display_name: name,
  });
  expect(account.status).toBe(201);
  return server.cookies();
}

type Seeded = {
  planId: string;
  organizer: string;
  guest: string;
  member: string;
  stranger: string;
};

/** Answer the plan's questions as whoever the route server's cookies are. */
async function saveAnswers(planId: string, startId: string, free: [string, string]): Promise<void> {
  const place = { id: startId, displayName: { text: "Maadi, Cairo" }, location: { latitude: 29.96, longitude: 31.25 } };
  setResponseGoogle({
    apiKey: "test-places-key",
    fetch: async () =>
      new Response(JSON.stringify(place), { status: 200, headers: { "Content-Type": "application/json" } }),
  });
  const view = (await (await server.serve(`/api/v1/plans/${planId}/response`)).json()) as {
    windows: { id: string }[];
    steps: { id: string; options: { id: string }[] }[];
  };
  const saved = await call(`/api/v1/plans/${planId}/response`, "PUT", {
    windows: [{ window_id: view.windows[0]?.id, kind: "free", earliest_local: free[0], latest_local: free[1] }],
    start_place_id: startId,
    picks: [{ step_id: view.steps[0]?.id, option_id: view.steps[0]?.options[1]?.id }],
  });
  expect(saved.status).toBe(200);
  setResponseGoogle(undefined);
}

/**
 * A collecting plan owned by a new account, joined by an anonymous guest who has saved answers
 * and by an account member who has saved nothing; plus an account that has no part in it.
 */
async function seedPlan(): Promise<Seeded> {
  const organizer = await newAccount("Omar");
  const created = await call("/api/v1/plans", "POST", {
    title: TITLE,
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
  const joined = await call(`/api/v1/join/${token}`, "POST", { kind: "anonymous", display_name: "Hana" });
  expect(joined.status).toBe(201);
  const guest = server.cookies();
  await saveAnswers(plan.id, "ChIJ-guest-start", ["18:15", "18:45"]);

  const member = await newAccount("Nour");
  const memberJoin = await call(`/api/v1/join/${token}`, "POST", { kind: "account" });
  expect(memberJoin.status).toBe(201);

  const stranger = await newAccount("Sara");
  return { planId: plan.id, organizer, guest, member, stranger };
}

async function setState(planId: string, state: "proposed" | "locked"): Promise<void> {
  if (state === "locked") {
    await sql`UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${planId}`;
  } else {
    await sql`UPDATE plans SET state = 'proposed' WHERE id = ${planId}`;
  }
}

function show(element: React.ReactElement) {
  return render(React.createElement(NextIntlClientProvider, { locale: "en", messages: en }, element));
}

/** Call the page as the actor with these cookies; return the ResponseForm element it renders. */
async function openPage(planId: string, cookies: string): Promise<FormElement> {
  cookieJar.value = cookies;
  const tree = await RespondPage({ params: Promise.resolve({ planId }) });
  const stack: React.ReactNode[] = [tree];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!React.isValidElement(current)) {
      continue;
    }
    if (current.type === ResponseForm) {
      return current as FormElement;
    }
    React.Children.forEach((current.props as { children?: React.ReactNode }).children, (child) =>
      stack.push(child),
    );
  }
  throw new Error("the page did not render ResponseForm");
}

beforeEach(() => {
  server = createRouteServer();
  vi.stubGlobal("fetch", server.serve);
  process.env.HP_HASH_TEST = "1";
  redirectMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete process.env.HP_HASH_TEST;
  cookieJar.value = "";
});

afterAll(async () => {
  for (const planId of planIds) {
    const participants = sql`SELECT id FROM participants WHERE plan_id = ${planId}`;
    const guests = await sql<{ id: string }[]>`
      SELECT DISTINCT guest_session_id AS id FROM participants
      WHERE plan_id = ${planId} AND guest_session_id IS NOT NULL
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

describe("respond page loads on the server", () => {
  it("T-001-40/AC-1 GET /api/v1/plans/{planId}/response answers each caller and state as before", async () => {
    const open = await seedPlan();
    const closed = await seedPlan();
    const locked = await seedPlan();
    await setState(closed.planId, "proposed");
    await setState(locked.planId, "locked");

    server.useCookies(open.guest);
    const saved = await server.serve(`/api/v1/plans/${open.planId}/response`);
    expect(saved.status).toBe(200);
    const savedBody = (await saved.json()) as Record<string, unknown>;
    expect(savedBody).toMatchObject({
      plan_state: "collecting",
      budget: { amount_minor: 50_000, currency: "EGP" },
      timezone: "Africa/Cairo",
      response: {
        complete: true,
        windows: [{ kind: "free", earliest_local: "18:15", latest_local: "18:45" }],
        start: { name: "Maadi, Cairo" },
      },
    });
    expect(JSON.stringify(savedBody)).not.toContain("29.96");

    server.useCookies(open.member);
    const empty = await server.serve(`/api/v1/plans/${open.planId}/response`);
    expect(empty.status).toBe(200);
    expect(await empty.json()).toMatchObject({
      plan_state: "collecting",
      response: { complete: false, windows: [], start: null, picks: [] },
    });

    server.useCookies(closed.guest);
    const proposed = await server.serve(`/api/v1/plans/${closed.planId}/response`);
    expect(proposed.status).toBe(409);
    expect(await proposed.json()).toMatchObject({
      error: { code: "conflict", reason: "responses_closed", fields: [] },
    });

    server.useCookies(locked.guest);
    const lockedRead = await server.serve(`/api/v1/plans/${locked.planId}/response`);
    expect(lockedRead.status).toBe(409);
    expect(await lockedRead.json()).toMatchObject({
      error: { code: "conflict", reason: "plan_locked", fields: [] },
    });

    for (const cookies of [open.organizer, open.stranger]) {
      server.useCookies(cookies);
      const hidden = await server.serve(`/api/v1/plans/${open.planId}/response`);
      expect(hidden.status).toBe(404);
      const hiddenBody = await hidden.json();
      expect(hiddenBody).toMatchObject({ error: { code: "not_found", fields: [] } });
      expect(JSON.stringify(hiddenBody)).not.toContain(TITLE);
    }
    const unknown = await server.serve("/api/v1/plans/pln_does_not_exist/response");
    expect(unknown.status).toBe(404);

    server.useCookies(open.guest);
    const incomplete = await call(`/api/v1/plans/${open.planId}/response`, "PUT", { windows: [] });
    expect(incomplete.status).toBe(400);
    await saveAnswers(open.planId, "ChIJ-guest-start", ["18:20", "18:40"]);
    const replaced = await server.serve(`/api/v1/plans/${open.planId}/response`);
    expect(await replaced.json()).toMatchObject({
      response: { complete: true, windows: [{ earliest_local: "18:20", latest_local: "18:40" }] },
    });
    expect(server.unserved).toEqual([]);
  });

  it("T-001-40/AC-2 the page renders ResponseForm with the title and saved answers, and the form makes no first-render GET, for a guest and an account participant", async () => {
    const { planId, guest, member } = await seedPlan();

    const rendered = await openPage(planId, guest);
    expect(rendered.props.planId).toBe(planId);
    expect(rendered.props.initialResponse).toMatchObject({
      title: TITLE,
      plan_state: "collecting",
      response: { complete: true, start: { name: "Maadi, Cairo" } },
    });
    expect(redirectMock).not.toHaveBeenCalled();

    server.useCookies(guest);
    server.requested.length = 0;
    show(rendered);
    expect(await screen.findByRole("heading", { name: TITLE })).toBeTruthy();
    expect(screen.getByText("Maadi, Cairo")).toBeTruthy();
    expect((screen.getByLabelText("Earliest") as HTMLInputElement).value).toBe("18:15");
    expect((screen.getByLabelText("Latest") as HTMLInputElement).value).toBe("18:45");
    expect((screen.getByLabelText("Grills") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Koshary") as HTMLInputElement).checked).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(server.requested).toEqual([]);
    cleanup();

    const memberPage = await openPage(planId, member);
    expect(memberPage.props.initialResponse).toMatchObject({
      title: TITLE,
      response: { complete: false, start: null, picks: [] },
    });
    server.useCookies(member);
    server.requested.length = 0;
    show(memberPage);
    expect(await screen.findByRole("heading", { name: TITLE })).toBeTruthy();
    expect((screen.getByLabelText("Koshary") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("Grills") as HTMLInputElement).checked).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(server.requested).toEqual([]);
  });

  it("T-001-40/AC-3 the page redirects a proposed plan to its proposal page and a locked plan to its confirmed page", async () => {
    const proposed = await seedPlan();
    const locked = await seedPlan();
    await setState(proposed.planId, "proposed");
    await setState(locked.planId, "locked");

    await expect(openPage(proposed.planId, proposed.guest)).rejects.toThrow(
      `NEXT_REDIRECT /plans/${proposed.planId}/proposal`,
    );
    expect(redirectMock).toHaveBeenCalledWith(`/plans/${proposed.planId}/proposal`);

    await expect(openPage(locked.planId, locked.guest)).rejects.toThrow(
      `NEXT_REDIRECT /plans/${locked.planId}/confirmed`,
    );
    expect(redirectMock).toHaveBeenCalledWith(`/plans/${locked.planId}/confirmed`);
  });

  it("T-001-40/AC-4 the page renders ResponseForm with no initial data and the not-found text for no cookie, the organizer, a stranger and an unknown plan", async () => {
    const { planId, organizer, stranger } = await seedPlan();

    const cases: [string, string, string][] = [
      ["no cookie", planId, ""],
      ["organizer", planId, organizer],
      ["stranger", planId, stranger],
      ["unknown plan", "pln_does_not_exist", organizer],
    ];
    for (const [label, id, cookies] of cases) {
      const rendered = await openPage(id, cookies);
      expect(rendered.props.initialResponse, label).toBeNull();
      cleanup();
      server.useCookies(cookies);
      server.requested.length = 0;
      show(rendered);
      const alert = await screen.findByRole("alert");
      expect(alert.textContent, label).toBe(en.errors.code.not_found);
      expect(document.body.textContent, label).not.toContain(TITLE);
      expect(document.body.textContent, label).not.toContain("Maadi, Cairo");
      expect(screen.queryByLabelText("Earliest"), label).toBeNull();
      expect(server.requested, label).toEqual([]);
    }
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
