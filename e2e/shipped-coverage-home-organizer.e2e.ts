/**
 * T-001-93 — real-stack proof for shipped tickets T-001-11 (home and create) and T-001-12
 * (organizer plan). Accounts and plans are set up through the real route handlers and Postgres
 * with the route server; pages are rendered by calling their default exports with `next/headers`
 * returning the actor's cookies. Harness copied from e2e/shipped-plans-shell.e2e.ts (T-001-87).
 */
import { randomBytes } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import en from "../messages/en.json";
import { HomeList } from "@/components/home-list";
import { OrganizerPlan } from "@/components/organizer-plan";
import HomePage from "@/app/page";
import AccountPage from "@/app/account/page";
import CreatePlanPage from "@/app/plans/new/page";
import OrganizerPlanPage from "@/app/plans/[planId]/page";
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

type Json = Record<string, unknown>;

async function call(path: string, method: string, body?: unknown): Promise<Response> {
  return server.serve(path, {
    method,
    headers: { "content-type": "application/json", "x-hp-request": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function signUp(): Promise<{ cookies: string; email: string }> {
  server.useCookies("");
  const email = `shipped-home-${randomBytes(6).toString("hex")}@example.com`;
  emails.push(email);
  const account = await call("/api/v1/accounts", "POST", {
    email,
    password: "password1",
    display_name: "Omar",
  });
  expect(account.status).toBe(201);
  return { cookies: server.cookies(), email };
}

const validPlan = {
  title: "Thursday in Maadi",
  timezone: "Africa/Cairo",
  windows: [{ local_date: "2026-10-02", start_local: "18:00", end_local: "19:00" }],
  budget: { amount_minor: 50_000, currency: "EGP" },
  steps: [{ name: "Dinner", options: ["Koshary", "Grills"] }],
  threshold: 3,
};

/** A collecting plan owned by the account whose cookies the server holds. */
async function createPlan(organizer: string, overrides: Json = {}): Promise<string> {
  server.useCookies(organizer);
  const created = await call("/api/v1/plans", "POST", { ...validPlan, ...overrides });
  expect(created.status).toBe(201);
  const plan = (await created.json()) as { id: string };
  planIds.push(plan.id);
  return plan.id;
}

function show(element: React.ReactNode) {
  return render(React.createElement(NextIntlClientProvider, { locale: "en", messages: en }, element));
}

function findElement<P>(tree: React.ReactNode, type: unknown): React.ReactElement<P> {
  const stack: React.ReactNode[] = [tree];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!React.isValidElement(current)) {
      continue;
    }
    if (current.type === type) {
      return current as React.ReactElement<P>;
    }
    React.Children.forEach((current.props as { children?: React.ReactNode }).children, (child) =>
      stack.push(child),
    );
  }
  throw new Error("the page did not render the expected component");
}

async function openHome(cookies: string): Promise<React.ReactElement> {
  cookieJar.value = cookies;
  return findElement(await HomePage(), HomeList);
}

async function openPlan(planId: string, cookies: string): Promise<React.ReactElement> {
  cookieJar.value = cookies;
  const tree = await OrganizerPlanPage({ params: Promise.resolve({ planId }) });
  return findElement(tree, OrganizerPlan);
}

function classTokens(el: Element): string[] {
  return el.className.split(/\s+/);
}

function inputById(id: string): HTMLInputElement | HTMLSelectElement {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`no element #${id}`);
  }
  return el as HTMLInputElement | HTMLSelectElement;
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
  router.push.mockReset();
  router.refresh.mockReset();
  router.replace.mockReset();
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

describe("shipped home, create and organizer plan, through the real stack", () => {
  it("T-001-93/AC-1 T-001-11/AC-1 signed-out home shows a bg-primary create action that opens the account gate and no plan rows; signed-in empty copy uses text-muted-foreground and is distinct from the error", async () => {
    // Signed out: the page renders the signed-out home.
    show(await openHome(""));
    const create = screen.getByRole("link", { name: en.Home.create });
    expect(classTokens(create)).toContain("bg-primary");
    expect(create.getAttribute("href")).toBe("/account?next=/plans/new");
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(screen.queryByText(en.Home.empty)).toBeNull();
    expect(screen.queryByText(en.Home.loadError)).toBeNull();
    cleanup();

    // The create action's target is the account gate page.
    const target = new URL(create.getAttribute("href") ?? "", "http://localhost");
    expect(target.pathname).toBe("/account");
    cookieJar.value = "";
    server.useCookies("");
    show(await AccountPage({ searchParams: Promise.resolve({ next: target.searchParams.get("next") ?? undefined }) }));
    expect(await screen.findByText(en.Account.requiredToOrganize)).toBeTruthy();
    expect(screen.getByLabelText(en.Account.email)).toBeTruthy();
    expect(screen.getByLabelText(en.Account.password)).toBeTruthy();
    cleanup();

    // Signed in with no plans: the empty copy, muted and distinct from the load error.
    const { cookies } = await signUp();
    server.useCookies(cookies);
    show(await openHome(cookies));
    const empty = screen.getByText(en.Home.empty);
    expect(classTokens(empty)).toContain("text-muted-foreground");
    expect(classTokens(empty)).not.toContain("text-destructive");
    expect(empty.getAttribute("role")).toBeNull();
    expect(en.Home.empty).not.toBe(en.Home.loadError);
    expect(screen.queryByText(en.Home.loadError)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: en.Home.retry })).toBeNull();
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(server.unserved).toEqual([]);
  });

  it("T-001-93/AC-1 T-001-11/AC-3 a loaded row shows the authored title, answered count, threshold, and one state; collecting, blocked, and proposed open the organizer plan; locked opens confirmed", async () => {
    const { cookies } = await signUp();
    const rows = [
      { title: "Collecting in Maadi", state: "collecting", answered: 1, threshold: 3 },
      { title: "Blocked downtown", state: "blocked", answered: 2, threshold: 2 },
      { title: "Proposed walk", state: "proposed", answered: 4, threshold: 3 },
      { title: "Locked brunch", state: "locked", answered: 5, threshold: 4 },
    ] as const;
    const ids: string[] = [];
    for (const row of rows) {
      const id = await createPlan(cookies, { title: row.title, threshold: row.threshold });
      await sql`
        UPDATE plans SET state = ${row.state}, answered_count = ${row.answered},
          locked_at = ${row.state === "locked" ? sql`now()` : null}
        WHERE id = ${id}
      `;
      ids.push(id);
    }

    server.useCookies(cookies);
    show(await openHome(cookies));
    const states = Object.values(en.Home.state);
    rows.forEach((row, index) => {
      const link = screen.getByRole("link", { name: new RegExp(row.title) });
      const parts = Array.from(link.querySelectorAll("span")).map((span) => span.textContent);
      // authored title
      expect(parts).toContain(row.title);
      // answered count and threshold
      expect(parts).toContain(
        en.Home.answered
          .replace("{answered}", String(row.answered))
          .replace("{threshold}", String(row.threshold)),
      );
      // exactly one state, the stored one
      expect(parts.filter((part) => states.includes(part ?? ""))).toEqual([en.Home.state[row.state]]);
      // where the row opens
      const id = ids[index] ?? "";
      expect(link.getAttribute("href")).toBe(
        row.state === "locked" ? `/plans/${id}/confirmed` : `/plans/${id}`,
      );
    });
    cleanup();

    // Collecting, blocked and proposed rows open the organizer plan surface for that plan.
    for (const [index, row] of rows.entries()) {
      if (row.state === "locked") {
        continue;
      }
      show(await openPlan(ids[index] ?? "", cookies));
      expect(screen.getByRole("heading", { level: 1, name: row.title })).toBeTruthy();
      expect(screen.getByRole("link", { name: en.plans.invite })).toBeTruthy();
      cleanup();
    }
    // A locked plan does not open the organizer plan: it goes to confirmed.
    await expect(openPlan(ids[3] ?? "", cookies)).rejects.toThrow(`NEXT_REDIRECT /plans/${ids[3]}/confirmed`);
    expect(server.unserved).toEqual([]);
  });

  it("T-001-93/AC-1 T-001-11/AC-7 a signed-out open of create is the account gate with next=/plans/new", async () => {
    const { cookies, email } = await signUp();
    expect(cookies).not.toBe("");

    // Signed out, /plans/new renders the account gate and not the form.
    cookieJar.value = "";
    server.useCookies("");
    show(await CreatePlanPage());
    expect(await screen.findByText(en.Account.requiredToOrganize)).toBeTruthy();
    expect(screen.queryByLabelText(en.Create.planTitle)).toBeNull();
    expect(screen.queryByRole("heading", { name: en.Create.title })).toBeNull();

    // Signing in through that gate returns to next=/plans/new.
    fireEvent.change(screen.getByLabelText(en.Account.email), { target: { value: email } });
    fireEvent.change(screen.getByLabelText(en.Account.password), { target: { value: "password1" } });
    fireEvent.click(screen.getByRole("button", { name: en.Account.submitSignIn }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith("/plans/new");
    });
    expect(router.push).toHaveBeenCalledTimes(1);
    cleanup();

    // With the session that sign-in set, /plans/new is the create form.
    cookieJar.value = server.cookies();
    show(await CreatePlanPage());
    expect(screen.getByLabelText(en.Create.planTitle)).toBeTruthy();
    expect(screen.queryByText(en.Account.requiredToOrganize)).toBeNull();
    expect(server.unserved).toEqual([]);
  });

  it("T-001-93/AC-2 T-001-12/AC-5 edit controls follow editable for the current state, budget shows the currency, and a rejected edit leaves the stored value and says the field can no longer be changed", async () => {
    const { cookies } = await signUp();
    const controls = {
      title: "hp-title",
      timezone: "hp-timezone",
      windows: "hp-window-0-date",
      budget: "hp-amount",
      currency: "hp-currency",
      threshold: "hp-threshold",
      steps: "hp-step-0-name",
    } as const;
    type Editable = Record<keyof typeof controls, boolean | string>;

    async function expectControlsFollowEditable(planId: string, expected: Record<keyof typeof controls, boolean>) {
      server.useCookies(cookies);
      const view = (await (await call(`/api/v1/plans/${planId}`, "GET")).json()) as { editable: Editable };
      for (const [key, id] of Object.entries(controls) as [keyof typeof controls, string][]) {
        const flag = view.editable[key];
        const open = flag === true || flag === "any" || flag === "raise" || flag === "lower";
        expect(open, key).toBe(expected[key]);
        expect(inputById(id).disabled, key).toBe(!open);
      }
    }

    // Collecting with no answers: every field is editable.
    const fresh = await createPlan(cookies);
    show(await openPlan(fresh, cookies));
    await expectControlsFollowEditable(fresh, {
      title: true, timezone: true, windows: true, budget: true, currency: true, threshold: true, steps: true,
    });
    cleanup();

    // After the first answer: only title, budget (raise only) and threshold (lower only) stay open.
    const answered = await createPlan(cookies);
    await sql`UPDATE plans SET answered_count = 1 WHERE id = ${answered}`;
    show(await openPlan(answered, cookies));
    await expectControlsFollowEditable(answered, {
      title: true, timezone: false, windows: false, budget: true, currency: false, threshold: true, steps: false,
    });

    // Budget shows the currency.
    expect(inputById("hp-amount").value).toBe("500.00");
    expect(inputById("hp-currency").value).toBe("EGP");
    expect(within(inputById("hp-amount").closest("section") as HTMLElement).getByLabelText(en.Create.currency)).toBe(
      inputById("hp-currency"),
    );

    // A lower budget is rejected by the server: the stored value stays and the field says so.
    fireEvent.change(inputById("hp-amount"), { target: { value: "400.00" } });
    server.useCookies(cookies);
    fireEvent.click(screen.getByRole("button", { name: en.common.save }));
    await waitFor(() => {
      expect(inputById("hp-amount").disabled).toBe(true);
    });
    const [stored] = await sql<{ budget_amount_minor: string; currency: string }[]>`
      SELECT budget_amount_minor, currency FROM plans WHERE id = ${answered}
    `;
    expect(Number(stored?.budget_amount_minor)).toBe(50_000);
    expect(stored?.currency).toBe("EGP");
    expect(inputById("hp-amount").value).toBe("500.00");
    expect(inputById("hp-currency").value).toBe("EGP");
    expect(inputById("hp-amount").getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById("hp-amount-error")?.textContent).toBe(en.plans.frozen);
    expect(screen.getByRole("alert").textContent).toBe(en.plans.frozen);
    expect(server.requested).toContain(`PATCH /api/v1/plans/${answered}`);
    expect(server.unserved).toEqual([]);
  });

  it("T-001-93/AC-2 T-001-12/AC-7 a locked open shows the confirmed surface instead of this page", async () => {
    const { cookies } = await signUp();
    const planId = await createPlan(cookies, { title: "Locked brunch" });
    await sql`UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${planId}`;

    await expect(openPlan(planId, cookies)).rejects.toThrow(`NEXT_REDIRECT /plans/${planId}/confirmed`);
    expect(screen.queryByText("Locked brunch")).toBeNull();
    expect(screen.queryByRole("link", { name: en.plans.invite })).toBeNull();

    // The same plan before locking opens this page, so the redirect is the lock's doing.
    await sql`UPDATE plans SET state = 'collecting', locked_at = NULL WHERE id = ${planId}`;
    show(await openPlan(planId, cookies));
    expect(screen.getByRole("heading", { level: 1, name: "Locked brunch" })).toBeTruthy();
    expect(server.unserved).toEqual([]);
  });

  it("T-001-93/AC-2 T-001-12/AC-8 a load failure uses text-destructive and retry and omits any other plan's title, people, and places", async () => {
    // Plan A belongs to one account; plan B to another, who opens A.
    const owner = await signUp();
    const planA = await createPlan(owner.cookies, {
      title: "Plan A in Zamalek",
      steps: [{ name: "Brunch", options: ["Cafe Alpha", "Cafe Beta"] }],
    });
    const other = await signUp();
    const planB = await createPlan(other.cookies, {
      title: "Plan B in Heliopolis",
      steps: [{ name: "Dinner", options: ["Gamma Grill", "Delta Diner"] }],
    });
    const [tokenRow] = await sql<{ join_token: string }[]>`SELECT join_token FROM plans WHERE id = ${planA}`;
    server.useCookies("");
    const joined = await call(`/api/v1/join/${tokenRow?.join_token ?? ""}`, "POST", {
      kind: "anonymous",
      display_name: "Hana Person",
    });
    expect(joined.status).toBe(201);
    expect(planB).not.toBe(planA);

    function expectFailure(): void {
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toBe(en.plans.loadError);
      expect(classTokens(alert)).toContain("text-destructive");
      expect(screen.getByRole("button", { name: en.plans.retry })).toBeTruthy();
      for (const text of ["Plan A in Zamalek", "Plan B in Heliopolis"]) {
        expect(screen.queryByText(text)).toBeNull();
      }
      for (const person of ["Hana Person", "Omar"]) {
        expect(screen.queryByText(person)).toBeNull();
      }
      for (const place of ["Cafe Alpha", "Cafe Beta", "Gamma Grill", "Delta Diner", "Brunch", "Dinner"]) {
        expect(screen.queryByText(place)).toBeNull();
        expect(screen.queryByDisplayValue(place)).toBeNull();
      }
      expect(screen.queryByRole("listitem")).toBeNull();
    }

    show(await openPlan(planA, other.cookies));
    expectFailure();

    server.useCookies(other.cookies);
    fireEvent.click(screen.getByRole("button", { name: en.plans.retry }));
    await waitFor(() => {
      expect(server.requested).toContain(`GET /api/v1/plans/${planA}`);
    });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expectFailure();
    expect(router.replace).not.toHaveBeenCalled();
    expect(server.unserved).toEqual([]);
  });
});
