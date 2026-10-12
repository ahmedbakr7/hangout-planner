import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { POST as createAccount } from "@/app/api/v1/accounts/route";
import { GET as getConfirmed } from "@/app/api/v1/plans/[planId]/confirmed/route";
import { POST as createPlan } from "@/app/api/v1/plans/route";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { generateCookieToken, hashCookieToken } from "@/server/auth/session";
import { generateId } from "@/server/ids";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { loadConfirmedPage, loadOrganizerPlanPage } from "@/server/plans/page-data";

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

async function openPlan(token: string): Promise<{ id: string; title: string }> {
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
  return (await response.json()) as { id: string; title: string };
}

function reader(cookies: Record<string, string>): (name: string) => string | null {
  return (name) => cookies[name] ?? null;
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

describe("loadOrganizerPlanPage", () => {
  it("T-001-36/AC-2 answers ok with the organizer view for the organizer's session cookie", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const plan = await openPlan(organizer.token);

    const result = await loadOrganizerPlanPage(plan.id, reader({ hp_session: organizer.token }));

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }
    expect(result.view.id).toBe(plan.id);
    expect(result.view.title).toBe("Thursday in Maadi");
    expect(result.view.threshold).toBe(3);
  });

  it("T-001-36/AC-3 answers organizer_only for a participant and not_found for a stranger, no cookie, and an unknown plan", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const member = await register(uniqueEmail("member"), "Nour");
    const stranger = await register(uniqueEmail("stranger"), "Ziad");
    const plan = await openPlan(organizer.token);
    await sql`
      INSERT INTO participants (id, plan_id, account_id, guest_session_id, display_name, distinguisher)
      VALUES (${generateId("prt_")}, ${plan.id}, ${member.id}, NULL, 'Nour', 'a3k9')
    `;

    expect(await loadOrganizerPlanPage(plan.id, reader({ hp_session: member.token }))).toEqual({
      kind: "organizer_only",
    });
    expect(await loadOrganizerPlanPage(plan.id, reader({ hp_session: stranger.token }))).toEqual({
      kind: "not_found",
    });
    expect(await loadOrganizerPlanPage(plan.id, reader({}))).toEqual({ kind: "not_found" });
    expect(
      await loadOrganizerPlanPage(generateId("pln_"), reader({ hp_session: organizer.token })),
    ).toEqual({ kind: "not_found" });
  });

  it("T-001-36/AC-3 answers organizer_only for a link reader's cookie", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const plan = await openPlan(organizer.token);
    const linkToken = generateCookieToken();
    const linkId = `lnk_${randomBytes(8).toString("hex")}`;
    extraLinkIds.push(linkId);
    await sql`
      INSERT INTO link_sessions (id, token_hash, expires_at)
      VALUES (${linkId}, ${hashCookieToken(linkToken)}, ${new Date("2099-01-01T00:00:00.000Z")})
    `;
    await sql`INSERT INTO link_session_plans (link_session_id, plan_id) VALUES (${linkId}, ${plan.id})`;

    expect(await loadOrganizerPlanPage(plan.id, reader({ hp_link: linkToken }))).toEqual({
      kind: "organizer_only",
    });
  });

  it("T-001-36/AC-3 answers locked for the organizer of a locked plan", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const plan = await openPlan(organizer.token);
    await sql`UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${plan.id}`;

    expect(await loadOrganizerPlanPage(plan.id, reader({ hp_session: organizer.token }))).toEqual({
      kind: "locked",
    });
  });
});

async function addParticipant(planId: string, accountId: string): Promise<void> {
  await sql`
    INSERT INTO participants (id, plan_id, account_id, guest_session_id, display_name, distinguisher)
    VALUES (${generateId("prt_")}, ${planId}, ${accountId}, NULL, 'Nour', 'a3k9')
  `;
}

async function lockPlan(planId: string): Promise<void> {
  await sql`UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${planId}`;
}

describe("GET /api/v1/plans/{planId}/confirmed", () => {
  async function get(planId: string, cookie?: string): Promise<Response> {
    return getConfirmed(
      new Request(`http://localhost/api/v1/plans/${planId}/confirmed`, {
        headers: cookie ? { cookie } : {},
      }),
      { params: Promise.resolve({ planId }) },
    );
  }

  it("T-001-38/AC-1 answers 200, 404 and 409 not_locked as before", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const stranger = await register(uniqueEmail("stranger"), "Ziad");
    const plan = await openPlan(organizer.token);

    const early = await get(plan.id, `hp_session=${organizer.token}`);
    expect(early.status).toBe(409);
    const earlyBody = (await early.json()) as { error: { code: string; reason: string } };
    expect(earlyBody.error.code).toBe("conflict");
    expect(earlyBody.error.reason).toBe("not_locked");
    expect((await get(plan.id, `hp_session=${stranger.token}`)).status).toBe(404);

    await lockPlan(plan.id);
    const ok = await get(plan.id, `hp_session=${organizer.token}`);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { title: string }).title).toBe("Thursday in Maadi");
    expect((await get(plan.id, `hp_session=${stranger.token}`)).status).toBe(404);
    expect((await get(generateId("pln_"), `hp_session=${organizer.token}`)).status).toBe(404);
  });
});

describe("loadConfirmedPage", () => {
  it("T-001-38/AC-2 answers ok with the confirmed document for any caller with a role on a locked plan", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const member = await register(uniqueEmail("member"), "Nour");
    const invitee = await register(uniqueEmail("invitee"), "Hana");
    const plan = await openPlan(organizer.token);
    await addParticipant(plan.id, member.id);
    await sql`
      INSERT INTO invitations (id, plan_id, account_id, distinguisher)
      VALUES (${generateId("inv_")}, ${plan.id}, ${invitee.id}, 'k7m2')
    `;
    await lockPlan(plan.id);

    for (const token of [organizer.token, member.token, invitee.token]) {
      const result = await loadConfirmedPage(plan.id, reader({ hp_session: token }));
      expect(result.kind).toBe("ok");
      if (result.kind === "ok") {
        expect(result.doc.plan_id).toBe(plan.id);
        expect(result.doc.title).toBe("Thursday in Maadi");
        expect(result.doc.state).toBe("locked");
      }
    }
  });

  it("T-001-38/AC-1 answers ok for a link reader on a locked plan", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const plan = await openPlan(organizer.token);
    await lockPlan(plan.id);
    const linkToken = generateCookieToken();
    const linkId = `lnk_${randomBytes(8).toString("hex")}`;
    extraLinkIds.push(linkId);
    await sql`
      INSERT INTO link_sessions (id, token_hash, expires_at)
      VALUES (${linkId}, ${hashCookieToken(linkToken)}, ${new Date("2099-01-01T00:00:00.000Z")})
    `;
    await sql`INSERT INTO link_session_plans (link_session_id, plan_id) VALUES (${linkId}, ${plan.id})`;

    const result = await loadConfirmedPage(plan.id, reader({ hp_link: linkToken }));
    expect(result.kind).toBe("ok");
  });

  it("T-001-38/AC-1 answers not_found for a stranger, no cookie and an unknown plan", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const stranger = await register(uniqueEmail("stranger"), "Ziad");
    const plan = await openPlan(organizer.token);
    await lockPlan(plan.id);

    expect(await loadConfirmedPage(plan.id, reader({ hp_session: stranger.token }))).toEqual({
      kind: "not_found",
    });
    expect(await loadConfirmedPage(plan.id, reader({}))).toEqual({ kind: "not_found" });
    expect(
      await loadConfirmedPage(generateId("pln_"), reader({ hp_session: organizer.token })),
    ).toEqual({ kind: "not_found" });
  });

  it("T-001-38/AC-3 answers not_locked with the surface /opening names for each role and state", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const member = await register(uniqueEmail("member"), "Nour");
    const invitee = await register(uniqueEmail("invitee"), "Hana");
    const plan = await openPlan(organizer.token);
    await addParticipant(plan.id, member.id);
    await sql`
      INSERT INTO invitations (id, plan_id, account_id, distinguisher)
      VALUES (${generateId("inv_")}, ${plan.id}, ${invitee.id}, 'k7m2')
    `;
    const linkToken = generateCookieToken();
    const linkId = `lnk_${randomBytes(8).toString("hex")}`;
    extraLinkIds.push(linkId);
    await sql`
      INSERT INTO link_sessions (id, token_hash, expires_at)
      VALUES (${linkId}, ${hashCookieToken(linkToken)}, ${new Date("2099-01-01T00:00:00.000Z")})
    `;
    await sql`INSERT INTO link_session_plans (link_session_id, plan_id) VALUES (${linkId}, ${plan.id})`;

    const next = async (cookies: Record<string, string>) =>
      loadConfirmedPage(plan.id, reader(cookies));

    expect(await next({ hp_session: organizer.token })).toEqual({
      kind: "not_locked",
      next: "organizer",
    });
    expect(await next({ hp_session: member.token })).toEqual({
      kind: "not_locked",
      next: "respond",
    });
    expect(await next({ hp_session: invitee.token })).toEqual({
      kind: "not_locked",
      next: "join",
    });
    expect(await next({ hp_link: linkToken })).toEqual({ kind: "not_locked", next: "join" });

    await sql`UPDATE plans SET state = 'blocked' WHERE id = ${plan.id}`;
    expect(await next({ hp_session: member.token })).toEqual({
      kind: "not_locked",
      next: "respond",
    });
    await sql`UPDATE plans SET state = 'proposed' WHERE id = ${plan.id}`;
    expect(await next({ hp_session: member.token })).toEqual({
      kind: "not_locked",
      next: "proposal",
    });
    expect(await next({ hp_session: organizer.token })).toEqual({
      kind: "not_locked",
      next: "organizer",
    });
  });
});
