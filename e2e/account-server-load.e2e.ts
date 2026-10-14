/**
 * T-001-48 — the account page loads the signed-in account on the server (ADR-0007).
 * Accounts are set up through the real route handlers and database with the route server.
 * The page's default export is called directly (no HTTP rendering until Playwright) with
 * `next/headers` returning that actor's cookies.
 */
import { randomBytes } from "node:crypto";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import en from "../messages/en.json";
import { AccountGate } from "@/components/account-gate";
import AccountPage from "@/app/account/page";
import { hashCookieToken } from "@/server/auth/session";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { createRouteServer, type RouteServer } from "./route-server";

const { router, cookieJar } = vi.hoisted(() => ({
  router: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
  cookieJar: { value: "" },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/account",
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

type GateElement = React.ReactElement<{ next?: string; initialAccount?: unknown }>;

async function call(path: string, method: string, body: unknown): Promise<Response> {
  return server.serve(path, {
    method,
    headers: { "content-type": "application/json", "x-hp-request": "1" },
    body: JSON.stringify(body),
  });
}

async function signUp(displayName: string): Promise<{ email: string; cookies: string }> {
  server.useCookies("");
  const email = `account-load-${randomBytes(6).toString("hex")}@example.com`;
  emails.push(email);
  const account = await call("/api/v1/accounts", "POST", {
    email,
    password: "password1",
    display_name: displayName,
  });
  expect(account.status).toBe(201);
  return { email, cookies: server.cookies() };
}

function show(element: React.ReactElement) {
  return render(React.createElement(NextIntlClientProvider, { locale: "en", messages: en }, element));
}

/** Call the page as the actor with these cookies; return the AccountGate element it renders. */
async function openPage(cookies: string, next?: string): Promise<GateElement> {
  cookieJar.value = cookies;
  const tree = await AccountPage({
    searchParams: Promise.resolve(next === undefined ? {} : { next }),
  });
  const stack: React.ReactNode[] = [tree];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!React.isValidElement(current)) {
      continue;
    }
    if (current.type === AccountGate) {
      return current as GateElement;
    }
    React.Children.forEach((current.props as { children?: React.ReactNode }).children, (child) =>
      stack.push(child),
    );
  }
  throw new Error("the page did not render AccountGate");
}

function sessionToken(cookies: string): string {
  const pair = cookies
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("hp_session="));
  if (!pair) {
    throw new Error("no hp_session cookie");
  }
  return pair.slice("hp_session=".length);
}

async function storedExpiry(token: string): Promise<number> {
  const rows = await sql<{ expires_at: Date }[]>`
    SELECT expires_at FROM sessions WHERE token_hash = ${hashCookieToken(token)}
  `;
  return new Date(rows[0]?.expires_at ?? 0).getTime();
}

async function shortenExpiry(token: string): Promise<number> {
  const shortExpiry = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  await sql`UPDATE sessions SET expires_at = ${shortExpiry} WHERE token_hash = ${hashCookieToken(token)}`;
  return shortExpiry.getTime();
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

afterAll(async () => {
  for (const email of emails) {
    await sql`DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE email = ${email})`;
    await sql`DELETE FROM accounts WHERE email = ${email}`;
  }
  await sql.end();
  await closeAccounts();
});

describe("account page loads on the server", () => {
  it("T-001-48/AC-1 GET /api/v1/me answers the account and a renewed hp_session cookie that moves expires_at later, and the missing-session response without a session", async () => {
    const nour = await signUp("Nour");
    const token = sessionToken(nour.cookies);
    const before = await shortenExpiry(token);

    server.useCookies(nour.cookies);
    const ok = await server.serve("/api/v1/me");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      account: { id: expect.stringMatching(/^acc_/), email: nour.email, display_name: "Nour" },
    });
    expect(ok.headers.getSetCookie().some((line) => line.startsWith(`hp_session=${token}`))).toBe(true);
    expect(await storedExpiry(token)).toBeGreaterThan(before);

    for (const cookies of ["", "hp_guest=guest-only", "hp_session=not-a-real-token"]) {
      server.useCookies(cookies);
      const missing = await server.serve("/api/v1/me");
      expect(missing.status, cookies).toBe(401);
      expect(missing.headers.getSetCookie(), cookies).toEqual([]);
      expect(await missing.json(), cookies).toMatchObject({
        error: { code: "unauthenticated", reason: "missing_session", fields: [] },
      });
    }
    expect(server.unserved).toEqual([]);
  });

  it("T-001-48/AC-2 the page renders AccountGate with the signed-in account as initial data and never the session token, and the gate shows the name and sends only the slide request", async () => {
    const nour = await signUp("Nour");
    const token = sessionToken(nour.cookies);

    const rendered = await openPage(nour.cookies);
    expect(rendered.props.initialAccount).toEqual({
      account: { id: expect.stringMatching(/^acc_/), email: nour.email, display_name: "Nour" },
    });
    expect(JSON.stringify(rendered.props)).not.toContain(token);

    server.useCookies(nour.cookies);
    server.requested.length = 0;
    show(rendered);
    expect(await screen.findByText(en.Account.signedInAs.replace("{name}", "Nour"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: en.Account.submitSignIn })).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(server.requested).toEqual(["GET /api/v1/me"]);
  });

  it("T-001-48/AC-3 the gate given initial data sends exactly one GET /api/v1/me after mount that renews the session, and given null sends none", async () => {
    const nour = await signUp("Nour");
    const token = sessionToken(nour.cookies);
    const before = await shortenExpiry(token);

    const rendered = await openPage(nour.cookies);
    expect(await storedExpiry(token)).toBe(before);
    server.useCookies(nour.cookies);
    server.requested.length = 0;
    show(rendered);
    await vi.waitFor(async () => expect(await storedExpiry(token)).toBeGreaterThan(before));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(server.requested).toEqual(["GET /api/v1/me"]);
    cleanup();

    const signedOut = await openPage("");
    server.useCookies("");
    server.requested.length = 0;
    show(signedOut);
    expect(await screen.findByRole("button", { name: en.Account.submitSignIn })).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(server.requested).toEqual([]);
  });

  it("T-001-48/AC-4 the page renders AccountGate with null initial data for no cookie and an invalid hp_session, shows the sign-in form, and keeps the next handling", async () => {
    const nour = await signUp("Nour");

    for (const [label, cookies] of [
      ["no cookie", ""],
      ["invalid hp_session", "hp_session=not-a-real-token"],
      ["guest only", "hp_guest=guest-only"],
    ] as const) {
      const rendered = await openPage(cookies, "/plans/new");
      expect(rendered.props.initialAccount, label).toBeNull();
      expect(rendered.props.next, label).toBe("/plans/new");
      server.useCookies(cookies);
      server.requested.length = 0;
      router.push.mockClear();
      show(rendered);
      expect(await screen.findByRole("button", { name: en.Account.submitSignIn }), label).toBeTruthy();
      expect(screen.queryByRole("alert"), label).toBeNull();
      expect(document.body.textContent, label).not.toContain("Signed in as");
      expect(screen.queryByText(en.Account.joinWithoutAccount), label).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(server.requested, label).toEqual([]);

      fireEvent.change(screen.getByLabelText(en.Account.email), { target: { value: nour.email } });
      fireEvent.change(screen.getByLabelText(en.Account.password), { target: { value: "password1" } });
      fireEvent.click(screen.getByRole("button", { name: en.Account.submitSignIn }));
      await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith("/plans/new"));
      cleanup();
    }

    // A join next keeps the join-without-account link.
    const rendered = await openPage("", `/join/jt_${"a".repeat(43)}`);
    expect(rendered.props.initialAccount).toBeNull();
    server.useCookies("");
    show(rendered);
    expect(await screen.findByText(en.Account.joinWithoutAccount)).toBeTruthy();
  });

  it("T-001-48/AC-5 the gate rendered with no initialAccount prop keeps its first-load GET /api/v1/me", async () => {
    const nour = await signUp("Nour");

    server.useCookies(nour.cookies);
    server.requested.length = 0;
    show(React.createElement(AccountGate, {}));
    expect(await screen.findByText(en.Account.signedInAs.replace("{name}", "Nour"))).toBeTruthy();
    expect(server.requested).toEqual(["GET /api/v1/me"]);
    cleanup();

    server.useCookies("");
    server.requested.length = 0;
    show(React.createElement(AccountGate, {}));
    expect(await screen.findByRole("button", { name: en.Account.submitSignIn })).toBeTruthy();
    expect(server.requested).toEqual(["GET /api/v1/me"]);
  });

  it("T-001-48/AC-7 signing in from the account page goes to the allow-listed next path, and a wrong password leaves the person signed out", async () => {
    const nour = await signUp("Nour");

    server.useCookies("");
    show(await openPage("", "/invitations"));
    fireEvent.change(await screen.findByLabelText(en.Account.email), { target: { value: nour.email } });
    fireEvent.change(screen.getByLabelText(en.Account.password), { target: { value: "password1" } });
    fireEvent.click(screen.getByRole("button", { name: en.Account.submitSignIn }));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith("/invitations"));
    expect(sessionToken(server.cookies())).not.toBe("");
    cleanup();
    router.push.mockClear();

    server.useCookies("");
    show(await openPage("", "https://evil.example/"));
    fireEvent.change(await screen.findByLabelText(en.Account.email), { target: { value: nour.email } });
    fireEvent.change(screen.getByLabelText(en.Account.password), { target: { value: "wrong-password" } });
    fireEvent.click(screen.getByRole("button", { name: en.Account.submitSignIn }));
    expect((await screen.findByRole("alert", {}, { timeout: 3000 })).textContent).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
    expect(server.cookies()).not.toContain("hp_session");
  });

  it("T-001-48/AC-7 registering from the account page creates the account, signs in and goes to the allow-listed next path", async () => {
    const email = `account-load-${randomBytes(6).toString("hex")}@example.com`;
    emails.push(email);

    server.useCookies("");
    show(await openPage("", "/plans/new"));
    fireEvent.click(await screen.findByRole("tab", { name: en.Account.register }));
    fireEvent.change(screen.getByLabelText(en.Account.email), { target: { value: email } });
    fireEvent.change(screen.getByLabelText(en.Account.password), { target: { value: "password1" } });
    fireEvent.change(screen.getByLabelText(en.Account.displayName), { target: { value: "Hana" } });
    fireEvent.click(screen.getByRole("button", { name: en.Account.submitRegister }));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith("/plans/new"));

    const me = await server.serve("/api/v1/me");
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ account: { email, display_name: "Hana" } });
  });
});
