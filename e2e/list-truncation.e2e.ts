/**
 * T-001-49 — the home and invitations lists stop at 100 rows and say so.
 * The 101-row and 100-row cases are seeded in the test database in one insert per table;
 * the account signs in through the real route handlers and calls GET /api/v1/plans and
 * GET /api/v1/invitations in-process with the route server.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { generateId } from "@/server/ids";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { closeDatabase as closeJoin } from "@/server/join/db";
import { closeDatabase as closeAttempt } from "@/server/proposal/attempt";
import { closeDatabase as closeInbox } from "@/server/invites/inbox";
import { cleanupThenClose } from "./db-cleanup";
import { createRouteServer, type RouteServer } from "./route-server";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}
const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

const BASE = Date.UTC(2026, 0, 1);
const emails: string[] = [];
const planIds: string[] = [];

let server: RouteServer;

async function signUp(displayName: string): Promise<{ id: string; cookies: string }> {
  server.useCookies("");
  const email = `list-truncation-${randomBytes(6).toString("hex")}@example.com`;
  emails.push(email);
  const account = await server.serve("/api/v1/accounts", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hp-request": "1" },
    body: JSON.stringify({ email, password: "password1", display_name: displayName }),
  });
  expect(account.status).toBe(201);
  const body = (await account.json()) as { account: { id: string } };
  return { id: body.account.id, cookies: server.cookies() };
}

/** Insert `count` plans for the organizer in one statement; each id is also queued for cleanup. */
async function insertPlans(
  organizerId: string,
  rows: { id: string; updatedAt?: Date }[],
): Promise<void> {
  planIds.push(...rows.map((row) => row.id));
  await sql`
    INSERT INTO plans ${sql(
      rows.map((row) => ({
        id: row.id,
        organizer_account_id: organizerId,
        title: "Seeded plan",
        timezone: "Africa/Cairo",
        budget_amount_minor: 50_000,
        currency: "EGP",
        threshold: 3,
        state: "collecting",
        join_token: `jt_${row.id}`,
        ...(row.updatedAt ? { updated_at: row.updatedAt } : {}),
      })),
    )}
  `;
}

/** Plan i is updated i seconds after the base; the two newest share a timestamp. Ids in list order. */
async function seedOrganizedPlans(organizerId: string, count: number): Promise<string[]> {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: generateId("pln_"),
    updatedAt: new Date(BASE + Math.min(i, count - 2) * 1000),
  }));
  await insertPlans(organizerId, rows);
  return [...rows]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || (a.id < b.id ? 1 : -1))
    .map((row) => row.id);
}

/** One invitation to each of `count` new plans; the two newest share a timestamp. Plan ids in list order. */
async function seedInvitations(
  organizerId: string,
  inviteeId: string,
  count: number,
): Promise<string[]> {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: generateId("pln_"),
    invitationId: generateId("inv_"),
    createdAt: new Date(BASE + Math.min(i, count - 2) * 1000),
  }));
  await insertPlans(organizerId, rows);
  await sql`
    INSERT INTO invitations ${sql(
      rows.map((row) => ({
        id: row.invitationId,
        plan_id: row.id,
        account_id: inviteeId,
        distinguisher: "k7m2",
        created_at: row.createdAt,
      })),
    )}
  `;
  return [...rows]
    .sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() ||
        (a.invitationId < b.invitationId ? 1 : -1),
    )
    .map((row) => row.id);
}

beforeEach(() => {
  server = createRouteServer();
  vi.stubGlobal("fetch", server.serve);
  process.env.HP_HASH_TEST = "1";
  return () => {
    vi.unstubAllGlobals();
    delete process.env.HP_HASH_TEST;
  };
});

async function deleteSeededRows(): Promise<void> {
  for (const planId of planIds) {
    const participants = sql`SELECT id FROM participants WHERE plan_id = ${planId}`;
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

describe("lists stop at 100 rows and say so", () => {
  it("T-001-49/AC-1 GET /api/v1/plans answers 100 plans and truncated true for 101 plans, in updated_at then id descending order", async () => {
    const organizer = await signUp("Omar");
    const expected = await seedOrganizedPlans(organizer.id, 101);

    server.useCookies(organizer.cookies);
    const response = await server.serve("/api/v1/plans");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { plans: { id: string }[]; truncated: boolean };
    expect(body.truncated).toBe(true);
    expect(body.plans).toHaveLength(100);
    expect(body.plans.map((plan) => plan.id)).toEqual(expected.slice(0, 100));
    expect(server.unserved).toEqual([]);
  });

  it("T-001-49/AC-1 GET /api/v1/plans answers 100 plans and truncated false for exactly 100 plans", async () => {
    const organizer = await signUp("Omar");
    const expected = await seedOrganizedPlans(organizer.id, 100);

    server.useCookies(organizer.cookies);
    const response = await server.serve("/api/v1/plans");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { plans: { id: string }[]; truncated: boolean };
    expect(body.truncated).toBe(false);
    expect(body.plans.map((plan) => plan.id)).toEqual(expected);
  });

  it("T-001-49/AC-2 GET /api/v1/invitations answers 100 rows and truncated true for 101 invitations, in created_at then id descending order", async () => {
    const organizer = await signUp("Omar");
    const invitee = await signUp("Hana");
    const expected = await seedInvitations(organizer.id, invitee.id, 101);

    server.useCookies(invitee.cookies);
    const response = await server.serve("/api/v1/invitations");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      invitations: { plan_id: string }[];
      truncated: boolean;
    };
    expect(body.truncated).toBe(true);
    expect(body.invitations).toHaveLength(100);
    expect(body.invitations.map((row) => row.plan_id)).toEqual(expected.slice(0, 100));
    expect(server.unserved).toEqual([]);
  });

  it("T-001-49/AC-2 GET /api/v1/invitations answers 100 rows and truncated false for exactly 100 invitations", async () => {
    const organizer = await signUp("Omar");
    const invitee = await signUp("Hana");
    const expected = await seedInvitations(organizer.id, invitee.id, 100);

    server.useCookies(invitee.cookies);
    const response = await server.serve("/api/v1/invitations");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      invitations: { plan_id: string }[];
      truncated: boolean;
    };
    expect(body.truncated).toBe(false);
    expect(body.invitations.map((row) => row.plan_id)).toEqual(expected);
  });
});
