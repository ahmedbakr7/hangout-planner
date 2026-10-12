/**
 * T-001-46 — /plans/new loads the session and currency list on the server (ADR-0007).
 * Accounts are set up through the real route handlers and database with the route server.
 * The page's default export is called directly (no HTTP rendering until Playwright) with
 * `next/headers` returning that actor's cookies, and its CreateForm is rendered with `fetch`
 * routed to the real route handlers.
 */
import { randomBytes } from "node:crypto";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import en from "../messages/en.json";
import { CreateForm } from "@/components/create-form";
import CreatePlanPage from "@/app/plans/new/page";
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
  usePathname: () => "/plans/new",
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

let server: RouteServer;

type FormElement = React.ReactElement<{ initialCurrencies: unknown }>;

const CURRENCIES = {
  currencies: [
    { code: "EGP", exponent: 2 },
    { code: "USD", exponent: 2 },
    { code: "SAR", exponent: 2 },
    { code: "AED", exponent: 2 },
  ],
};

async function signUp(displayName: string): Promise<string> {
  server.useCookies("");
  const email = `create-load-${randomBytes(6).toString("hex")}@example.com`;
  emails.push(email);
  const account = await server.serve("/api/v1/accounts", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hp-request": "1" },
    body: JSON.stringify({ email, password: "password1", display_name: displayName }),
  });
  expect(account.status).toBe(201);
  return server.cookies();
}

function show(element: React.ReactElement) {
  return render(React.createElement(NextIntlClientProvider, { locale: "en", messages: en }, element));
}

/** Call the page as the actor with these cookies; return the CreateForm element it renders. */
async function openPage(cookies: string): Promise<FormElement> {
  cookieJar.value = cookies;
  const tree = await CreatePlanPage();
  const stack: React.ReactNode[] = [tree];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!React.isValidElement(current)) {
      continue;
    }
    if (current.type === CreateForm) {
      return current as FormElement;
    }
    React.Children.forEach((current.props as { children?: React.ReactNode }).children, (child) =>
      stack.push(child),
    );
  }
  throw new Error("the page did not render CreateForm");
}

function getRequests(): string[] {
  return server.requested.filter((entry) => entry.startsWith("GET "));
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
  for (const email of emails) {
    await sql`DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE email = ${email})`;
    await sql`DELETE FROM accounts WHERE email = ${email}`;
  }
  await sql.end();
  await Promise.all([closeAccounts(), closePlans(), closeJoin(), closeAttempt(), closeInbox()]);
});

describe("create page loads on the server", () => {
  it("T-001-46/AC-1 GET /api/v1/currencies answers the currency list for a signed-in account, and the missing-session response without a session", async () => {
    const mine = await signUp("Omar");

    server.useCookies(mine);
    const ok = await server.serve("/api/v1/currencies");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual(CURRENCIES);

    for (const cookies of ["", "hp_session=not-a-real-token"]) {
      server.useCookies(cookies);
      const missing = await server.serve("/api/v1/currencies");
      expect(missing.status, cookies).toBe(401);
      expect(await missing.json(), cookies).toMatchObject({
        error: { code: "unauthenticated", reason: "missing_session", fields: [] },
      });
    }
    expect(server.unserved).toEqual([]);
  });

  it("T-001-46/AC-2 the page renders CreateForm with the currency list as initial data, and the form shows those currencies with no first-load fetch beyond the slide", async () => {
    const mine = await signUp("Omar");

    const rendered = await openPage(mine);
    expect(rendered.props.initialCurrencies).toEqual(CURRENCIES);

    server.useCookies(mine);
    server.requested.length = 0;
    show(rendered);
    const field = (await screen.findByLabelText(en.Create.currency)) as HTMLSelectElement;
    expect(Array.from(field.options).map((option) => option.value)).toEqual([
      "EGP",
      "USD",
      "SAR",
      "AED",
    ]);
    expect(screen.getByLabelText(en.Create.planTitle)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => {
      expect(getRequests()).toEqual(["GET /api/v1/me"]);
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(getRequests()).toEqual(["GET /api/v1/me"]);
    expect(server.unserved).toEqual([]);
  });

  it("T-001-46/AC-4 the page renders CreateForm with no initial data and the account gate, for no cookie and an invalid hp_session", async () => {
    for (const [label, cookies] of [
      ["no cookie", ""],
      ["invalid hp_session", "hp_session=not-a-real-token"],
    ] as const) {
      const rendered = await openPage(cookies);
      expect(rendered.props.initialCurrencies, label).toBeNull();
      cleanup();
      server.useCookies(cookies);
      server.requested.length = 0;
      show(rendered);
      expect(await screen.findByText(en.Account.requiredToOrganize), label).toBeTruthy();
      expect(screen.queryByLabelText(en.Create.planTitle), label).toBeNull();
      expect(screen.queryByLabelText(en.Create.currency), label).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 100));
      // The gate's own mount check is the only request; the form's currency load is gone.
      expect(getRequests(), label).toEqual(["GET /api/v1/me"]);
    }
  });
});
