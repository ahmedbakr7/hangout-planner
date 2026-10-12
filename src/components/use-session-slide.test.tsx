import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import postgres from "postgres";
import React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as createAccount } from "@/app/api/v1/accounts/route";
import { GET as getMe } from "@/app/api/v1/me/route";
import { POST as createPlan } from "@/app/api/v1/plans/route";
import { useSessionSlide } from "@/components/use-session-slide";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { hashCookieToken } from "@/server/auth/session";
import { generateId } from "@/server/ids";
import { loadPlanJoinPage } from "@/server/join/page-data";
import { closeDatabase as closePlans } from "@/server/plans/http";

function Probe({ signedIn }: { signedIn: boolean }) {
  useSessionSlide(signedIn);
  return <p>screen</p>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useSessionSlide", () => {
  it("T-001-44/AC-1 sends one same-origin GET /api/v1/me after mount when signed in", () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<Probe signedIn />);
    view.rerender(<Probe signedIn />);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/me", {
      credentials: "same-origin",
    });
  });

  it("T-001-44/AC-1 sends no request when not signed in", () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<Probe signedIn={false} />);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("T-001-44/AC-2 a rejected request changes nothing and throws nothing", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("network down");
    });
    vi.stubGlobal("fetch", fetchMock);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Probe signedIn />);
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.off("unhandledRejection", unhandled);
    expect(screen.getByText("screen")).toBeTruthy();
    expect(unhandled).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("T-001-44/AC-2 a 401 answer changes nothing the screen shows", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<Probe signedIn />);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("screen")).toBeTruthy();
  });
});

// AC-3 (join-panel.test.tsx) proves the hook fires GET /api/v1/me. This test
// proves what that request does: the page load leaves expires_at alone and the
// real handler the hook calls moves it later.
describe("session slide on the real stack", () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  const sql = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 0,
    connect_timeout: 10,
    onnotice: () => {},
  });
  const emails: string[] = [];

  function postJson(path: string, body: unknown, cookie?: string): Request {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-hp-request": "1",
    };
    if (cookie) {
      headers.cookie = cookie;
    }
    return new Request(`http://localhost${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  async function register(label: string): Promise<{ id: string; token: string }> {
    const email = `${label}.${randomBytes(8).toString("hex")}@example.com`;
    emails.push(email);
    const response = await createAccount(
      postJson("/v1/accounts", { email, password: "password1", display_name: label }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { account: { id: string } };
    const line = response.headers.getSetCookie().find((entry) => entry.startsWith("hp_session="));
    const pair = (line ?? "").split(";", 1)[0] ?? "";
    return {
      id: body.account.id,
      token: decodeURIComponent(pair.slice("hp_session=".length)),
    };
  }

  beforeAll(async () => {
    await sql`SELECT pg_advisory_lock(60144)`;
    try {
      const rows = await sql<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'accounts'
        ) AS exists
      `;
      if (!rows[0]?.exists) {
        await sql.file(resolve(process.cwd(), "drizzle/0001_init.sql"));
      }
    } finally {
      await sql`SELECT pg_advisory_unlock(60144)`;
    }
  });

  afterAll(async () => {
    for (const email of emails.splice(0, emails.length)) {
      const accounts = await sql<{ id: string }[]>`SELECT id FROM accounts WHERE email = ${email}`;
      for (const account of accounts) {
        const plans = await sql<{ id: string }[]>`
          SELECT id FROM plans WHERE organizer_account_id = ${account.id}
        `;
        for (const plan of plans) {
          await sql`DELETE FROM link_session_plans WHERE plan_id = ${plan.id}`;
          await sql`DELETE FROM invitations WHERE plan_id = ${plan.id}`;
          await sql`DELETE FROM participants WHERE plan_id = ${plan.id}`;
          await sql`DELETE FROM plan_options WHERE step_id IN (SELECT id FROM plan_steps WHERE plan_id = ${plan.id})`;
          await sql`DELETE FROM plan_steps WHERE plan_id = ${plan.id}`;
          await sql`DELETE FROM plan_windows WHERE plan_id = ${plan.id}`;
          await sql`DELETE FROM plans WHERE id = ${plan.id}`;
        }
        await sql`DELETE FROM invitations WHERE account_id = ${account.id}`;
        await sql`DELETE FROM sessions WHERE account_id = ${account.id}`;
        await sql`DELETE FROM accounts WHERE id = ${account.id}`;
      }
    }
    await sql.end({ timeout: 5 });
    await closePlans();
    await closeAccounts();
  });

  it("T-001-44/AC-4 the join page load keeps expires_at and GET /api/v1/me moves it later", async () => {
    process.env.HP_HASH_TEST = "1";
    try {
      const organizer = await register("org");
      const invitee = await register("invitee");
      const created = await createPlan(
        postJson(
          "/v1/plans",
          {
            title: "Thursday in Maadi",
            timezone: "Africa/Cairo",
            windows: [{ local_date: "2026-10-02", start_local: "18:00", end_local: "23:00" }],
            budget: { amount_minor: 50_000, currency: "EGP" },
            steps: [{ name: "Dinner", options: ["Koshary", "Grills"] }],
            threshold: 3,
          },
          `hp_session=${organizer.token}`,
        ),
      );
      expect(created.status).toBe(201);
      const plan = (await created.json()) as { id: string };
      await sql`
        INSERT INTO invitations (id, plan_id, account_id, distinguisher)
        VALUES (${generateId("inv_")}, ${plan.id}, ${invitee.id}, 'k7m2')
      `;

      const shortExpiry = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
      const tokenHash = hashCookieToken(invitee.token);
      await sql`UPDATE sessions SET expires_at = ${shortExpiry} WHERE token_hash = ${tokenHash}`;
      const storedExpiry = async (): Promise<number> => {
        const rows = await sql<{ expires_at: Date }[]>`
          SELECT expires_at FROM sessions WHERE token_hash = ${tokenHash}
        `;
        return new Date(rows[0]?.expires_at ?? 0).getTime();
      };

      const page = await loadPlanJoinPage(plan.id, (name) =>
        name === "hp_session" ? invitee.token : null,
      );
      expect(page.kind).toBe("ok");
      expect(await storedExpiry()).toBe(shortExpiry.getTime());

      // The stub answers the hook's fetch with the real handler and the
      // browser's cookie, as a same-origin request would carry it.
      const handled: number[] = [];
      vi.stubGlobal("fetch", async (input: string) => {
        const answer = await getMe(
          new Request(`http://localhost${input}`, {
            headers: { cookie: `hp_session=${invitee.token}` },
          }),
        );
        handled.push(answer.status);
        return answer;
      });
      render(<Probe signedIn />);
      await vi.waitFor(async () => {
        expect(await storedExpiry()).toBeGreaterThan(shortExpiry.getTime());
      });
      expect(handled).toEqual([200]);
    } finally {
      delete process.env.HP_HASH_TEST;
    }
  });
});
