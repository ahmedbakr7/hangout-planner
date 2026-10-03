/**
 * T-001-32 — the UI's requests reach real route handlers.
 * Every fetch a component makes is routed by URL path to the route module Next.js would
 * serve it from (src/app/<path>/route.ts, [param] directories as dynamic segments) and run
 * against the real database. A request to a path no route serves fails the test.
 */
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import en from "../messages/en.json";
import { AccountGate } from "@/components/account-gate";
import { HomeList } from "@/components/home-list";
import { InvitationsList } from "@/components/invite-panel";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { closeDatabase as closeInbox } from "@/server/invites/inbox";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}
const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

const APP_DIR = resolve(process.cwd(), "src/app");

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

/** The route module and params Next.js would serve `pathname` from, or null when none does. */
function routeFor(pathname: string): { file: string; params: Record<string, string> } | null {
  let dir = APP_DIR;
  const params: Record<string, string> = {};
  for (const segment of pathname.split("/").filter(Boolean)) {
    if (existsSync(join(dir, segment))) {
      dir = join(dir, segment);
      continue;
    }
    const dynamic = readdirSync(dir).find((name) => /^\[[^.\]]+\]$/.test(name));
    if (!dynamic) {
      return null;
    }
    params[dynamic.slice(1, -1)] = decodeURIComponent(segment);
    dir = join(dir, dynamic);
  }
  const file = join(dir, "route.ts");
  return existsSync(file) ? { file, params } : null;
}

const requested: string[] = [];
const unserved: string[] = [];
let cookieJar = "";

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input), "http://localhost");
  const method = (init?.method ?? "GET").toUpperCase();
  requested.push(`${method} ${url.pathname}`);
  const route = routeFor(url.pathname);
  const handler = route ? ((await import(route.file)) as Record<string, Handler>)[method] : undefined;
  if (!route || !handler) {
    unserved.push(`${method} ${url.pathname}`);
    return new Response("not found", { status: 404 });
  }
  const headers = new Headers(init?.headers);
  if (cookieJar) {
    headers.set("cookie", cookieJar);
  }
  const response = await handler(
    new Request(url, { method, headers, body: init?.body ?? undefined }),
    { params: Promise.resolve(route.params) },
  );
  const session = (response.headers.getSetCookie?.() ?? []).find((line) => line.startsWith("hp_session="));
  if (session) {
    cookieJar = session.split(";", 1)[0] ?? "";
  }
  return response;
}

function show(element: React.ReactElement) {
  return render(React.createElement(NextIntlClientProvider, { locale: "en", messages: en }, element));
}

const email = `ui-paths-${randomBytes(6).toString("hex")}@example.com`;

async function register(): Promise<void> {
  const response = await serve("/api/v1/accounts", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hp-request": "1" },
    body: JSON.stringify({ email, password: "password1", display_name: "Nour" }),
  });
  expect(response.status).toBe(201);
  expect(cookieJar).toMatch(/^hp_session=/);
}

beforeEach(() => {
  requested.length = 0;
  unserved.length = 0;
  vi.stubGlobal("fetch", serve);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await sql`DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE email = ${email})`;
  await sql`DELETE FROM accounts WHERE email = ${email}`;
  await sql.end();
  await Promise.all([closeAccounts(), closePlans(), closeInbox()]);
});

describe("UI requests against the real route handlers", () => {
  it("T-001-32/AC-2 the account gate shows sign-in on a real 401 from GET /api/v1/me", async () => {
    cookieJar = "";
    show(React.createElement(AccountGate, { next: "/plans/new" }));
    expect(await screen.findByText("An account is required to organize a plan.")).toBeTruthy();
    expect(requested).toContain("GET /api/v1/me");
    expect(unserved).toEqual([]);
  });

  it("T-001-32/AC-2 the account gate shows the account on a real 200 from GET /api/v1/me", async () => {
    await register();
    show(React.createElement(AccountGate, { next: "/plans/new" }));
    expect(await screen.findByText("Signed in as Nour")).toBeTruthy();
    expect(unserved).toEqual([]);
  });

  it("T-001-32/AC-1 home and invitations request only served /api/v1 paths", async () => {
    if (!cookieJar) {
      await register();
    }
    requested.length = 0;
    show(React.createElement(HomeList));
    await screen.findByRole("link", { name: "Create a plan" });
    cleanup();
    show(React.createElement(InvitationsList));
    await vi.waitFor(() => expect(requested.some((r) => r.endsWith("/api/v1/invitations"))).toBe(true));
    expect(requested.length).toBeGreaterThan(0);
    expect(requested.every((r) => r.split(" ")[1]?.startsWith("/api/v1/"))).toBe(true);
    expect(unserved).toEqual([]);
  });
});
