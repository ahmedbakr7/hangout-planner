import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { POST as createAccount } from "@/app/api/v1/accounts/route";
import { GET as getInvite } from "@/app/api/v1/plans/[planId]/invite/route";
import { POST as createPlan } from "@/app/api/v1/plans/route";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { generateCookieToken, hashCookieToken } from "@/server/auth/session";
import { generateId } from "@/server/ids";
import { loadInvitePage } from "@/server/invites/page-data";
import { closeDatabase as closePlans } from "@/server/plans/http";

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

const createdEmails: string[] = [];
const extraLinkIds: string[] = [];

function uniqueEmail(label: string): string {
  const email = `${label}.${randomBytes(8).toString("hex")}@example.com`;
  createdEmails.push(email);
  return email;
}

function jsonRequest(path: string, body: unknown, cookie?: string): Request {
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

async function register(email: string, displayName: string): Promise<{ id: string; token: string }> {
  const response = await createAccount(
    jsonRequest("/v1/accounts", {
      email,
      password: "password1",
      display_name: displayName,
    }),
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

async function openPlan(token: string): Promise<{ id: string; join_path: string }> {
  const response = await createPlan(
    jsonRequest(
      "/v1/plans",
      {
        title: "Thursday in Maadi",
        timezone: "Africa/Cairo",
        windows: [{ local_date: "2026-10-02", start_local: "18:00", end_local: "23:00" }],
        budget: { amount_minor: 50_000, currency: "EGP" },
        steps: [{ name: "Dinner", options: ["Koshary", "Grills"] }],
        threshold: 3,
      },
      `hp_session=${token}`,
    ),
  );
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; join_path: string };
}

function reader(cookies: Record<string, string>): (name: string) => string | null {
  return (name) => cookies[name] ?? null;
}

async function addParticipant(planId: string, accountId: string): Promise<void> {
  await sql`
    INSERT INTO participants (id, plan_id, account_id, guest_session_id, display_name, distinguisher)
    VALUES (${generateId("prt_")}, ${planId}, ${accountId}, NULL, 'Nour', 'a3k9')
  `;
}

async function addInvitation(planId: string, accountId: string): Promise<void> {
  await sql`
    INSERT INTO invitations (id, plan_id, account_id, distinguisher)
    VALUES (${generateId("inv_")}, ${planId}, ${accountId}, 'k7m2')
  `;
}

async function lockPlan(planId: string): Promise<void> {
  await sql`UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${planId}`;
}

async function addLinkReader(planId: string): Promise<string> {
  const linkToken = generateCookieToken();
  const linkId = `lnk_${randomBytes(8).toString("hex")}`;
  extraLinkIds.push(linkId);
  await sql`
    INSERT INTO link_sessions (id, token_hash, expires_at)
    VALUES (${linkId}, ${hashCookieToken(linkToken)}, ${new Date("2099-01-01T00:00:00.000Z")})
  `;
  await sql`INSERT INTO link_session_plans (link_session_id, plan_id) VALUES (${linkId}, ${planId})`;
  return linkToken;
}

async function forget(email: string): Promise<void> {
  const accounts = await sql<{ id: string }[]>`SELECT id FROM accounts WHERE email = ${email}`;
  for (const account of accounts) {
    const planRows = await sql<{ id: string }[]>`
      SELECT id FROM plans WHERE organizer_account_id = ${account.id}
    `;
    for (const plan of planRows) {
      await sql`DELETE FROM link_session_plans WHERE plan_id = ${plan.id}`;
      await sql`DELETE FROM invitations WHERE plan_id = ${plan.id}`;
      await sql`DELETE FROM participants WHERE plan_id = ${plan.id}`;
      await sql`DELETE FROM plan_options WHERE step_id IN (SELECT id FROM plan_steps WHERE plan_id = ${plan.id})`;
      await sql`DELETE FROM plan_steps WHERE plan_id = ${plan.id}`;
      await sql`DELETE FROM plan_windows WHERE plan_id = ${plan.id}`;
      await sql`DELETE FROM plans WHERE id = ${plan.id}`;
    }
    await sql`DELETE FROM invitations WHERE account_id = ${account.id}`;
    await sql`DELETE FROM participants WHERE account_id = ${account.id}`;
    await sql`DELETE FROM sessions WHERE account_id = ${account.id}`;
    await sql`DELETE FROM accounts WHERE id = ${account.id}`;
  }
}

beforeAll(async () => {
  await sql`SELECT pg_advisory_lock(60136)`;
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
    await sql`SELECT pg_advisory_unlock(60136)`;
  }
});

beforeEach(() => {
  process.env.HP_HASH_TEST = "1";
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    throw new Error(`unit tests must not call the network: ${String(input)}`);
  });
});

afterEach(async () => {
  delete process.env.HP_HASH_TEST;
  vi.unstubAllGlobals();
  for (const email of createdEmails.splice(0, createdEmails.length)) {
    await forget(email);
  }
  for (const id of extraLinkIds.splice(0, extraLinkIds.length)) {
    await sql`DELETE FROM link_session_plans WHERE link_session_id = ${id}`;
    await sql`DELETE FROM link_sessions WHERE id = ${id}`;
  }
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
  await closePlans();
  await closeAccounts();
});

describe("loadInvitePage", () => {
  it("T-001-41/AC-1 T-001-41/AC-2 answers ok with the join path and the sent invitations for the organizer", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const invitee = await register(uniqueEmail("invitee"), "Hana");
    const plan = await openPlan(organizer.token);
    await addInvitation(plan.id, invitee.id);

    const result = await loadInvitePage(plan.id, reader({ hp_session: organizer.token }));

    expect(result).toEqual({
      kind: "ok",
      view: {
        join_path: plan.join_path,
        invitations: [{ display_name: "Hana", distinguisher: "k7m2", status: "invited" }],
      },
    });
  });

  it("T-001-41/AC-2 answers ok with an empty list when nobody was invited", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const plan = await openPlan(organizer.token);

    expect(await loadInvitePage(plan.id, reader({ hp_session: organizer.token }))).toEqual({
      kind: "ok",
      view: { join_path: plan.join_path, invitations: [] },
    });
  });

  it("T-001-41/AC-1 T-001-41/AC-4 answers organizer_only for a participant, an invited account and a link reader", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const member = await register(uniqueEmail("member"), "Nour");
    const invitee = await register(uniqueEmail("invitee"), "Hana");
    const plan = await openPlan(organizer.token);
    await addParticipant(plan.id, member.id);
    await addInvitation(plan.id, invitee.id);
    const linkToken = await addLinkReader(plan.id);

    const callers: Record<string, string>[] = [
      { hp_session: member.token },
      { hp_session: invitee.token },
      { hp_link: linkToken },
    ];
    for (const cookies of callers) {
      expect(await loadInvitePage(plan.id, reader(cookies))).toEqual({ kind: "organizer_only" });
    }
  });

  it("T-001-41/AC-1 T-001-41/AC-4 answers not_found for a stranger, no cookie and an unknown plan", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const stranger = await register(uniqueEmail("stranger"), "Ziad");
    const plan = await openPlan(organizer.token);

    expect(await loadInvitePage(plan.id, reader({ hp_session: stranger.token }))).toEqual({
      kind: "not_found",
    });
    expect(await loadInvitePage(plan.id, reader({}))).toEqual({ kind: "not_found" });
    expect(
      await loadInvitePage(generateId("pln_"), reader({ hp_session: organizer.token })),
    ).toEqual({ kind: "not_found" });
  });

  it("T-001-41/AC-1 T-001-41/AC-3 answers locked for the organizer of a locked plan", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const plan = await openPlan(organizer.token);
    await lockPlan(plan.id);

    expect(await loadInvitePage(plan.id, reader({ hp_session: organizer.token }))).toEqual({
      kind: "locked",
    });
  });

  it("T-001-41/AC-4 answers organizer_only or not_found, not locked, for other callers on a locked plan", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const member = await register(uniqueEmail("member"), "Nour");
    const stranger = await register(uniqueEmail("stranger"), "Ziad");
    const plan = await openPlan(organizer.token);
    await addParticipant(plan.id, member.id);
    await lockPlan(plan.id);

    expect(await loadInvitePage(plan.id, reader({ hp_session: member.token }))).toEqual({
      kind: "organizer_only",
    });
    expect(await loadInvitePage(plan.id, reader({ hp_session: stranger.token }))).toEqual({
      kind: "not_found",
    });
  });
});

describe("GET /api/v1/plans/{planId}/invite", () => {
  async function get(planId: string, cookie?: string): Promise<Response> {
    return getInvite(
      new Request(`http://localhost/api/v1/plans/${planId}/invite`, {
        headers: cookie ? { cookie } : {},
      }),
      { params: Promise.resolve({ planId }) },
    );
  }

  async function errorOf(response: Response): Promise<{ code: string; reason?: string }> {
    return ((await response.json()) as { error: { code: string; reason?: string } }).error;
  }

  it("T-001-41/AC-1 answers 200 with the join path and sent invitations for the organizer", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const invitee = await register(uniqueEmail("invitee"), "Hana");
    const plan = await openPlan(organizer.token);
    await addInvitation(plan.id, invitee.id);

    const response = await get(plan.id, `hp_session=${organizer.token}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(await response.json()).toEqual({
      join_path: plan.join_path,
      invitations: [{ display_name: "Hana", distinguisher: "k7m2", status: "invited" }],
    });
  });

  it("T-001-41/AC-1 answers 403 organizer_only for a participant, an invited account and a link reader", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const member = await register(uniqueEmail("member"), "Nour");
    const invitee = await register(uniqueEmail("invitee"), "Hana");
    const plan = await openPlan(organizer.token);
    await addParticipant(plan.id, member.id);
    await addInvitation(plan.id, invitee.id);
    const linkToken = await addLinkReader(plan.id);

    for (const cookie of [
      `hp_session=${member.token}`,
      `hp_session=${invitee.token}`,
      `hp_link=${linkToken}`,
    ]) {
      const response = await get(plan.id, cookie);
      expect(response.status).toBe(403);
      expect(await errorOf(response)).toMatchObject({ code: "forbidden", reason: "organizer_only" });
    }
  });

  it("T-001-41/AC-1 answers 404 for a stranger and an unknown plan", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const stranger = await register(uniqueEmail("stranger"), "Ziad");
    const plan = await openPlan(organizer.token);

    const hidden = await get(plan.id, `hp_session=${stranger.token}`);
    expect(hidden.status).toBe(404);
    expect(await errorOf(hidden)).toMatchObject({ code: "not_found" });
    expect((await get(plan.id)).status).toBe(404);
    expect((await get(generateId("pln_"), `hp_session=${organizer.token}`)).status).toBe(404);
  });

  it("T-001-41/AC-1 answers 409 plan_locked for the organizer on a locked plan", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const plan = await openPlan(organizer.token);
    await lockPlan(plan.id);

    const response = await get(plan.id, `hp_session=${organizer.token}`);

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toMatchObject({ code: "conflict", reason: "plan_locked" });
  });
});
