/**
 * T-001-87 — real-stack proof for shipped tickets T-001-07 (shell), T-001-09 (plan rules),
 * T-001-10 (plans HTTP) and T-001-12 (organizer plan). Plans are set up through the real route
 * handlers and Postgres with the route server; pages are rendered by calling their default
 * exports with `next/headers` returning the actor's cookies.
 */
import { randomBytes } from "node:crypto";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import en from "../messages/en.json";
import { OrganizerPlan } from "@/components/organizer-plan";
import OrganizerPlanPage from "@/app/plans/[planId]/page";
import RootLayout from "@/app/layout";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { closeDatabase as closeJoin } from "@/server/join/db";
import { closeDatabase as closeAttempt } from "@/server/proposal/attempt";
import { closeDatabase as closeInbox } from "@/server/invites/inbox";
import { cleanupThenClose } from "./db-cleanup";
import { createRouteServer, type RouteServer } from "./route-server";

const { cookieJar } = vi.hoisted(() => ({ cookieJar: { value: "" } }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
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

// The font loader is a build-time transform; outside `next build` it only needs to answer a class name.
vi.mock("next/font/local", () => ({ default: () => ({ variable: "font-var" }) }));

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}
const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

const emails: string[] = [];
const planIds: string[] = [];

let server: RouteServer;

type Json = Record<string, unknown>;

async function call(path: string, method: string, body?: unknown): Promise<Response> {
  return server.serve(path, {
    method,
    headers: { "content-type": "application/json", "x-hp-request": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function signUp(): Promise<string> {
  server.useCookies("");
  const email = `shipped-shell-${randomBytes(6).toString("hex")}@example.com`;
  emails.push(email);
  const account = await call("/api/v1/accounts", "POST", {
    email,
    password: "password1",
    display_name: "Omar",
  });
  expect(account.status).toBe(201);
  return server.cookies();
}

const validPlan = {
  title: "Thursday in Maadi",
  timezone: "Africa/Cairo",
  windows: [{ local_date: "2026-10-02", start_local: "18:00", end_local: "19:00" }],
  budget: { amount_minor: 50_000, currency: "EGP" },
  steps: [{ name: "Dinner", options: ["Koshary", "Grills"] }],
  threshold: 3,
};

/** A collecting plan owned by a new account (the server keeps that account's cookies). */
async function seedPlan(overrides: Json = {}): Promise<{ planId: string; organizer: string; joinPath: string }> {
  const organizer = await signUp();
  const created = await call("/api/v1/plans", "POST", { ...validPlan, ...overrides });
  expect(created.status).toBe(201);
  const plan = (await created.json()) as { id: string; join_path: string };
  planIds.push(plan.id);
  return { planId: plan.id, organizer, joinPath: plan.join_path };
}

type StoredPlan = {
  title: string;
  budget_amount_minor: number;
  currency: string;
  threshold: number;
  state: string;
  answered_count: number;
};

async function storedPlan(planId: string): Promise<StoredPlan> {
  const rows = await sql<StoredPlan[]>`
    SELECT title, budget_amount_minor, currency, threshold, state, answered_count
    FROM plans WHERE id = ${planId}
  `;
  return rows[0] as StoredPlan;
}

type Field = { path: string; code: string };

async function patchFrozen(planId: string, organizer: string, patch: Json): Promise<Field[]> {
  server.useCookies(organizer);
  const before = await storedPlan(planId);
  const response = await call(`/api/v1/plans/${planId}`, "PATCH", patch);
  expect(response.status).toBe(409);
  const body = (await response.json()) as { error: { code: string; reason: string; fields: Field[] } };
  expect(body.error).toMatchObject({ code: "conflict", reason: "field_frozen" });
  expect(await storedPlan(planId)).toEqual(before);
  return body.error.fields;
}

async function renderLayout(cookie: string): Promise<React.ReactElement<{ lang: string; dir: string }>> {
  cookieJar.value = cookie;
  const tree = await RootLayout({ children: null });
  return tree as React.ReactElement<{ lang: string; dir: string }>;
}

function show(element: React.ReactElement) {
  return render(React.createElement(NextIntlClientProvider, { locale: "en", messages: en }, element));
}

type PlanElement = React.ReactElement<{ planId: string; initialPlan: unknown }>;

async function openPage(planId: string, cookies: string): Promise<PlanElement> {
  cookieJar.value = cookies;
  const tree = await OrganizerPlanPage({ params: Promise.resolve({ planId }) });
  const stack: React.ReactNode[] = [tree];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!React.isValidElement(current)) {
      continue;
    }
    if (current.type === OrganizerPlan) {
      return current as PlanElement;
    }
    React.Children.forEach((current.props as { children?: React.ReactNode }).children, (child) =>
      stack.push(child),
    );
  }
  throw new Error("the page did not render OrganizerPlan");
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

describe("shipped shell, plan rules, plans HTTP and organizer plan, through the real stack", () => {
  it("T-001-87/AC-1 T-001-07/AC-3 dir and lang on html follow the hp_locale cookie: ar is rtl and en is ltr", async () => {
    const cases: [string, string, string][] = [
      ["hp_locale=ar", "ar", "rtl"],
      ["hp_locale=en", "en", "ltr"],
      ["", "en", "ltr"],
    ];
    for (const [cookie, lang, dir] of cases) {
      const html = await renderLayout(cookie);
      expect(html.type, cookie).toBe("html");
      expect(html.props.lang, cookie).toBe(lang);
      expect(html.props.dir, cookie).toBe(dir);
    }
  });

  it("T-001-87/AC-3 T-001-09/AC-5 a frozen key, an illegal budget change, a currency change while frozen or a threshold outside the mode is field_frozen and writes nothing", async () => {
    // A key frozen by state: a proposed plan accepts no timezone change.
    const proposed = await seedPlan();
    await sql`UPDATE plans SET state = 'proposed' WHERE id = ${proposed.planId}`;
    expect(await patchFrozen(proposed.planId, proposed.organizer, { timezone: "Europe/London" })).toEqual([
      { path: "timezone", code: "frozen" },
    ]);

    // Raise-only budget: once someone answered, a lower amount is illegal.
    const answered = await seedPlan();
    await sql`UPDATE plans SET answered_count = 1 WHERE id = ${answered.planId}`;
    expect(
      await patchFrozen(answered.planId, answered.organizer, { budget: { amount_minor: 40_000, currency: "EGP" } }),
    ).toEqual([{ path: "budget", code: "frozen" }]);

    // Currency is frozen from the first answer, even on a legal-looking amount.
    const fields = await patchFrozen(answered.planId, answered.organizer, {
      budget: { amount_minor: 60_000, currency: "USD" },
    });
    expect(fields).toContainEqual({ path: "currency", code: "frozen" });

    // Threshold outside the mode: "lower" only allows answered_count..stored, "any" only 1..100.
    expect(await patchFrozen(answered.planId, answered.organizer, { threshold: 5 })).toEqual([
      { path: "threshold", code: "frozen" },
    ]);
    const fresh = await seedPlan();
    expect(await patchFrozen(fresh.planId, fresh.organizer, { threshold: 0 })).toEqual([
      { path: "threshold", code: "frozen" },
    ]);
    expect(server.unserved).toEqual([]);
  });

  it("T-001-87/AC-4 T-001-10/AC-2 POST /v1/plans creates a collecting plan for the organizer and 400 names each invalid field without a row", async () => {
    const organizer = await signUp();
    const created = await call("/api/v1/plans", "POST", validPlan);
    expect(created.status).toBe(201);
    const plan = (await created.json()) as {
      id: string;
      state: string;
      answered_count: number;
      join_path: string;
      participants: unknown[];
    };
    planIds.push(plan.id);
    expect(plan).toMatchObject({
      title: "Thursday in Maadi",
      state: "collecting",
      answered_count: 0,
      threshold: 3,
      participants: [],
    });
    expect(plan.join_path).toMatch(/^\/join\/[A-Za-z0-9_-]+$/);

    const rows = await sql<{ join_token: string; organizer_account_id: string; answered_count: number }[]>`
      SELECT join_token, organizer_account_id, answered_count FROM plans WHERE id = ${plan.id}
    `;
    expect(rows).toHaveLength(1);
    expect(plan.join_path).toBe(`/join/${rows[0]?.join_token}`);
    expect(rows[0]?.answered_count).toBe(0);
    const account = await sql<{ id: string }[]>`
      SELECT a.id FROM accounts a JOIN sessions s ON s.account_id = a.id WHERE a.email = ${emails[emails.length - 1] ?? ""} LIMIT 1
    `;
    expect(rows[0]?.organizer_account_id).toBe(account[0]?.id);
    const participantRows = await sql`SELECT id FROM participants WHERE plan_id = ${plan.id}`;
    expect(participantRows).toHaveLength(0);

    // A second plan from the same caller gets its own join token.
    const second = (await (await call("/api/v1/plans", "POST", validPlan)).json()) as {
      id: string;
      join_path: string;
    };
    planIds.push(second.id);
    expect(second.join_path).not.toBe(plan.join_path);

    const before = await sql`SELECT id FROM plans WHERE organizer_account_id = ${rows[0]?.organizer_account_id ?? ""}`;
    server.useCookies(organizer);
    const invalid = await call("/api/v1/plans", "POST", {
      ...validPlan,
      title: "   ",
      threshold: 0,
      budget: { amount_minor: 0, currency: "EGP" },
    });
    expect(invalid.status).toBe(400);
    const body = (await invalid.json()) as { error: { code: string; fields: Field[] } };
    expect(body.error.code).toBe("validation_failed");
    const paths = body.error.fields.map((field) => field.path);
    expect(paths).toEqual(expect.arrayContaining(["title", "threshold"]));
    expect(paths.some((path) => path.startsWith("budget"))).toBe(true);
    const after = await sql`SELECT id FROM plans WHERE organizer_account_id = ${rows[0]?.organizer_account_id ?? ""}`;
    expect(after).toHaveLength(before.length);
    expect(server.unserved).toEqual([]);
  });

  it("T-001-87/AC-6 T-001-12/AC-1 the organizer plan page shows answered count, in-progress count, threshold and each participant with status", async () => {
    const { planId, organizer, joinPath } = await seedPlan();
    const token = joinPath.slice("/join/".length);
    for (const name of ["Hana", "Karim"]) {
      server.useCookies("");
      const joined = await call(`/api/v1/join/${token}`, "POST", { kind: "anonymous", display_name: name });
      expect(joined.status).toBe(201);
    }
    const [hana] = await sql<{ id: string }[]>`
      SELECT id FROM participants WHERE plan_id = ${planId} AND display_name = 'Hana'
    `;
    await sql`INSERT INTO responses (participant_id, complete, first_completed_at) VALUES (${hana?.id ?? ""}, true, now())`;
    await sql`UPDATE plans SET answered_count = 1 WHERE id = ${planId}`;

    const rendered = await openPage(planId, organizer);
    server.useCookies(organizer);
    show(rendered);

    expect(await screen.findByRole("heading", { level: 1, name: "Thursday in Maadi" })).toBeTruthy();
    expect(screen.getByText(en.plans.answered.replace("{answered}", "1").replace("{threshold}", "3"))).toBeTruthy();
    expect(screen.getByText(en.plans.inProgress.replace("{count}", "1"))).toBeTruthy();
    const items = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toContain(`Hana${en.plans.statusAnswered}`);
    expect(items).toContain(`Karim${en.plans.statusInProgress}`);
    expect(server.unserved).toEqual([]);
  });
});
