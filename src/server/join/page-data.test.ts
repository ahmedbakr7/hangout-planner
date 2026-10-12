import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { POST as createAccount } from "@/app/api/v1/accounts/route";
import { GET as getOpening } from "@/app/api/v1/plans/[planId]/opening/route";
import { POST as createPlan } from "@/app/api/v1/plans/route";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { generateCookieToken, hashCookieToken } from "@/server/auth/session";
import { generateId } from "@/server/ids";
import { loadPlanJoinPage } from "@/server/join/page-data";
import { closeDatabase as closePlans } from "@/server/plans/http";

vi.mock("@/server/join/page-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/join/page-data")>();
  return { ...actual, loadPlanJoinPage: vi.fn(actual.loadPlanJoinPage) };
});

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

async function openPlan(token: string): Promise<{ id: string }> {
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
  return (await response.json()) as { id: string };
}

function reader(cookies: Record<string, string>): (name: string) => string | null {
  return (name) => cookies[name] ?? null;
}

async function invite(planId: string, accountId: string): Promise<void> {
  await sql`
    INSERT INTO invitations (id, plan_id, account_id, distinguisher)
    VALUES (${generateId("inv_")}, ${planId}, ${accountId}, 'k7m2')
  `;
}

async function addParticipant(planId: string, accountId: string): Promise<void> {
  await sql`
    INSERT INTO participants (id, plan_id, account_id, guest_session_id, display_name, distinguisher)
    VALUES (${generateId("prt_")}, ${planId}, ${accountId}, NULL, 'Nour', 'a3k9')
  `;
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
  await sql`SELECT pg_advisory_lock(60142)`;
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
    await sql`SELECT pg_advisory_unlock(60142)`;
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

const PREVIEW = {
  title: "Thursday in Maadi",
  organizer_display_name: "Omar",
  timezone: "Africa/Cairo",
  windows: [{ local_date: "2026-10-02", start_local: "18:00", end_local: "23:00" }],
  budget: { amount_minor: 50_000, currency: "EGP" },
  step_names: ["Dinner"],
};

describe("loadPlanJoinPage", () => {
  it("T-001-42/AC-2 answers ok with the join preview and signedIn for an invited account", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const invitee = await register(uniqueEmail("invitee"), "Hana");
    const plan = await openPlan(organizer.token);
    await invite(plan.id, invitee.id);

    expect(await loadPlanJoinPage(plan.id, reader({ hp_session: invitee.token }))).toEqual({
      kind: "ok",
      opening: { plan_id: plan.id, next: "join", preview: PREVIEW },
      signedIn: true,
    });
  });

  it("T-001-42/AC-3 answers the surface next names for the organizer, a participant and a locked plan", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const member = await register(uniqueEmail("member"), "Nour");
    const invitee = await register(uniqueEmail("invitee"), "Hana");
    const plan = await openPlan(organizer.token);
    await addParticipant(plan.id, member.id);
    await invite(plan.id, invitee.id);

    const nextFor = async (token: string): Promise<string | null> => {
      const page = await loadPlanJoinPage(plan.id, reader({ hp_session: token }));
      return page.kind === "ok" ? page.opening.next : null;
    };

    expect(await nextFor(organizer.token)).toBe("organizer");
    expect(await nextFor(member.token)).toBe("respond");
    await sql`UPDATE plans SET state = 'proposed' WHERE id = ${plan.id}`;
    expect(await nextFor(member.token)).toBe("proposal");
    await sql`UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${plan.id}`;
    expect(await nextFor(organizer.token)).toBe("confirmed");
    expect(await nextFor(member.token)).toBe("confirmed");
    expect(await nextFor(invitee.token)).toBe("confirmed");
  });

  it("T-001-42/AC-4 answers not_found for a stranger, a link reader, no cookie and an unknown plan", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const stranger = await register(uniqueEmail("stranger"), "Ziad");
    const plan = await openPlan(organizer.token);
    const linkToken = await addLinkReader(plan.id);

    expect(await loadPlanJoinPage(plan.id, reader({ hp_session: stranger.token }))).toEqual({
      kind: "not_found",
    });
    expect(await loadPlanJoinPage(plan.id, reader({ hp_link: linkToken }))).toEqual({
      kind: "not_found",
    });
    expect(await loadPlanJoinPage(plan.id, reader({}))).toEqual({ kind: "not_found" });
    expect(
      await loadPlanJoinPage(generateId("pln_"), reader({ hp_session: organizer.token })),
    ).toEqual({ kind: "not_found" });
  });
});

describe("GET /api/v1/plans/{planId}/opening", () => {
  async function get(planId: string, cookie?: string): Promise<Response> {
    return getOpening(
      new Request(`http://localhost/api/v1/plans/${planId}/opening`, {
        headers: cookie ? { cookie } : {},
      }),
      { params: Promise.resolve({ planId }) },
    );
  }

  it("T-001-42/AC-1 answers 200 with next and the preview for an invited account, organizer and participant", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const member = await register(uniqueEmail("member"), "Nour");
    const invitee = await register(uniqueEmail("invitee"), "Hana");
    const plan = await openPlan(organizer.token);
    await addParticipant(plan.id, member.id);
    await invite(plan.id, invitee.id);

    vi.mocked(loadPlanJoinPage).mockClear();
    const joined = await get(plan.id, `hp_session=${invitee.token}`);
    expect(joined.status).toBe(200);
    expect(loadPlanJoinPage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(loadPlanJoinPage).mock.calls[0]?.[0]).toBe(plan.id);
    expect(await joined.json()).toEqual({ plan_id: plan.id, next: "join", preview: PREVIEW });

    const asOrganizer = await get(plan.id, `hp_session=${organizer.token}`);
    expect(asOrganizer.status).toBe(200);
    expect(await asOrganizer.json()).toEqual({ plan_id: plan.id, next: "organizer", preview: null });

    const asMember = await get(plan.id, `hp_session=${member.token}`);
    expect(asMember.status).toBe(200);
    expect(await asMember.json()).toEqual({ plan_id: plan.id, next: "respond", preview: null });
  });

  it("T-001-42/AC-1 answers 404 with the envelope only for a link reader, a stranger and an unknown plan", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const stranger = await register(uniqueEmail("stranger"), "Ziad");
    const plan = await openPlan(organizer.token);
    const linkToken = await addLinkReader(plan.id);

    vi.mocked(loadPlanJoinPage).mockClear();
    const responses = [
      await get(plan.id, `hp_link=${linkToken}`),
      await get(plan.id, `hp_session=${stranger.token}`),
      await get(generateId("pln_"), `hp_session=${organizer.token}`),
    ];
    expect(loadPlanJoinPage).toHaveBeenCalledTimes(3);
    for (const response of responses) {
      expect(response.status).toBe(404);
      const body = (await response.json()) as { error: { code: string } };
      expect(Object.keys(body)).toEqual(["error"]);
      expect(body.error.code).toBe("not_found");
    }
  });
});
