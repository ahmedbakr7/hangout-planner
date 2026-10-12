import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { POST as createAccount } from "@/app/api/v1/accounts/route";
import { POST as createPlan } from "@/app/api/v1/plans/route";
import { GET as getResponse } from "@/app/api/v1/plans/[planId]/response/route";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { generateCookieToken, hashCookieToken } from "@/server/auth/session";
import { generateId } from "@/server/ids";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { loadResponsePage } from "@/server/response/page-data";

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
const extraGuestIds: string[] = [];

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

async function addParticipant(
  planId: string,
  accountId: string | null,
  guestSessionId: string | null,
  displayName: string,
): Promise<string> {
  const id = generateId("prt_");
  await sql`
    INSERT INTO participants (id, plan_id, account_id, guest_session_id, display_name, distinguisher)
    VALUES (${id}, ${planId}, ${accountId}, ${guestSessionId}, ${displayName}, 'a3k9')
  `;
  return id;
}

async function addGuest(): Promise<{ id: string; token: string }> {
  const token = generateCookieToken();
  const id = `gst_${randomBytes(8).toString("hex")}`;
  extraGuestIds.push(id);
  await sql`
    INSERT INTO guest_sessions (id, token_hash, expires_at)
    VALUES (${id}, ${hashCookieToken(token)}, ${new Date("2099-01-01T00:00:00.000Z")})
  `;
  return { id, token };
}

async function saveResponse(planId: string, participantId: string): Promise<void> {
  const windows = await sql<{ id: string }[]>`SELECT id FROM plan_windows WHERE plan_id = ${planId}`;
  const steps = await sql<{ id: string }[]>`SELECT id FROM plan_steps WHERE plan_id = ${planId}`;
  const options = await sql<{ id: string }[]>`
    SELECT id FROM plan_options WHERE step_id = ${steps[0]!.id} ORDER BY position
  `;
  await sql`
    INSERT INTO responses (participant_id, start_google_place_id, start_name, start_lat, start_lng, complete)
    VALUES (${participantId}, 'ChIJ-maadi', 'Maadi, Cairo', 29.96, 31.25, true)
  `;
  await sql`
    INSERT INTO response_windows (participant_id, window_id, kind, earliest_local, latest_local)
    VALUES (${participantId}, ${windows[0]!.id}, 'free', '18:30', '21:00')
  `;
  await sql`
    INSERT INTO response_picks (participant_id, step_id, option_id)
    VALUES (${participantId}, ${steps[0]!.id}, ${options[1]!.id})
  `;
}

async function wipePlan(planId: string): Promise<void> {
  const guestRows = await sql<{ id: string }[]>`
    SELECT DISTINCT guest_session_id AS id
    FROM participants
    WHERE plan_id = ${planId} AND guest_session_id IS NOT NULL
  `;
  const members = sql`SELECT id FROM participants WHERE plan_id = ${planId}`;
  await sql`DELETE FROM response_picks WHERE participant_id IN (${members})`;
  await sql`DELETE FROM response_windows WHERE participant_id IN (${members})`;
  await sql`DELETE FROM responses WHERE participant_id IN (${members})`;
  await sql`DELETE FROM proposal_runs WHERE plan_id = ${planId}`;
  await sql`DELETE FROM link_session_plans WHERE plan_id = ${planId}`;
  await sql`DELETE FROM invitations WHERE plan_id = ${planId}`;
  await sql`DELETE FROM participants WHERE plan_id = ${planId}`;
  await sql`DELETE FROM plan_options WHERE step_id IN (SELECT id FROM plan_steps WHERE plan_id = ${planId})`;
  await sql`DELETE FROM plan_steps WHERE plan_id = ${planId}`;
  await sql`DELETE FROM plan_windows WHERE plan_id = ${planId}`;
  await sql`DELETE FROM plans WHERE id = ${planId}`;
  for (const row of guestRows) {
    await sql`DELETE FROM guest_sessions WHERE id = ${row.id}`;
  }
}

async function forget(email: string): Promise<void> {
  const accounts = await sql<{ id: string }[]>`SELECT id FROM accounts WHERE email = ${email}`;
  for (const account of accounts) {
    const planRows = await sql<{ id: string }[]>`
      SELECT id FROM plans WHERE organizer_account_id = ${account.id}
    `;
    for (const plan of planRows) {
      await wipePlan(plan.id);
    }
    await sql`DELETE FROM invitations WHERE account_id = ${account.id}`;
    await sql`DELETE FROM participants WHERE account_id = ${account.id}`;
    await sql`DELETE FROM sessions WHERE account_id = ${account.id}`;
    await sql`DELETE FROM accounts WHERE id = ${account.id}`;
  }
}

function routeGet(planId: string, cookie: string): Promise<Response> {
  return getResponse(
    new Request(`http://localhost/api/v1/plans/${planId}/response`, {
      headers: { cookie },
    }),
    { params: Promise.resolve({ planId }) },
  );
}

beforeAll(async () => {
  await sql`SELECT pg_advisory_lock(60140)`;
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
    await sql`SELECT pg_advisory_unlock(60140)`;
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
  for (const id of extraGuestIds.splice(0, extraGuestIds.length)) {
    await sql`DELETE FROM guest_sessions WHERE id = ${id}`;
  }
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
  await closePlans();
  await closeAccounts();
});

describe("loadResponsePage", () => {
  it("T-001-40/AC-1 answers ok with the plan and an empty response for a participant with no saved response", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const member = await register(uniqueEmail("member"), "Nour");
    const plan = await openPlan(organizer.token);
    await addParticipant(plan.id, member.id, null, "Nour");

    const result = await loadResponsePage(plan.id, reader({ hp_session: member.token }));

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }
    expect(result.view.title).toBe("Thursday in Maadi");
    expect(result.view.plan_state).toBe("collecting");
    expect(result.view.budget).toEqual({ amount_minor: 50_000, currency: "EGP" });
    expect(result.view.timezone).toBe("Africa/Cairo");
    expect(result.view.windows).toHaveLength(1);
    expect(result.view.steps[0]?.options.map((option) => option.label)).toEqual([
      "Koshary",
      "Grills",
    ]);
    expect(result.view.response).toEqual({
      complete: false,
      windows: [],
      start: null,
      picks: [],
    });
  });

  it("T-001-40/AC-1 answers ok with the saved windows, picks and start for a participant who saved", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const member = await register(uniqueEmail("member"), "Nour");
    const plan = await openPlan(organizer.token);
    const memberId = await addParticipant(plan.id, member.id, null, "Nour");
    await saveResponse(plan.id, memberId);

    const result = await loadResponsePage(plan.id, reader({ hp_session: member.token }));

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }
    const window = result.view.windows[0];
    const step = result.view.steps[0];
    expect(result.view.response).toEqual({
      complete: true,
      windows: [
        {
          window_id: window?.id,
          kind: "free",
          earliest_local: "18:30",
          latest_local: "21:00",
        },
      ],
      start: { name: "Maadi, Cairo" },
      picks: [{ step_id: step?.id, option_id: step?.options[1]?.id }],
    });
    expect(JSON.stringify(result.view)).not.toContain("ChIJ-maadi");
    expect(JSON.stringify(result.view)).not.toContain("29.96");
  });

  it("T-001-40/AC-2 answers ok for a guest participant from the hp_guest cookie", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const plan = await openPlan(organizer.token);
    const guest = await addGuest();
    const guestId = await addParticipant(plan.id, null, guest.id, "Guest");
    await saveResponse(plan.id, guestId);

    const result = await loadResponsePage(plan.id, reader({ hp_guest: guest.token }));

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }
    expect(result.view.title).toBe("Thursday in Maadi");
    expect(result.view.response.start).toEqual({ name: "Maadi, Cairo" });
  });

  it("T-001-40/AC-1 answers ok with the blocked state while blocked", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const member = await register(uniqueEmail("member"), "Nour");
    const plan = await openPlan(organizer.token);
    await addParticipant(plan.id, member.id, null, "Nour");
    await sql`UPDATE plans SET state = 'blocked' WHERE id = ${plan.id}`;

    const result = await loadResponsePage(plan.id, reader({ hp_session: member.token }));

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.view.plan_state).toBe("blocked");
    }
  });

  it("T-001-40/AC-1 answers proposed while proposed and locked while locked", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const member = await register(uniqueEmail("member"), "Nour");
    const plan = await openPlan(organizer.token);
    await addParticipant(plan.id, member.id, null, "Nour");
    const cookies = reader({ hp_session: member.token });

    await sql`UPDATE plans SET state = 'proposed' WHERE id = ${plan.id}`;
    expect(await loadResponsePage(plan.id, cookies)).toEqual({ kind: "proposed" });

    await sql`UPDATE plans SET state = 'locked' WHERE id = ${plan.id}`;
    expect(await loadResponsePage(plan.id, cookies)).toEqual({ kind: "locked" });
  });

  it("T-001-40/AC-4 answers not_found for the organizer, a stranger, no cookie and an unknown plan", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const stranger = await register(uniqueEmail("stranger"), "Sam");
    const plan = await openPlan(organizer.token);

    expect(await loadResponsePage(plan.id, reader({ hp_session: organizer.token }))).toEqual({
      kind: "not_found",
    });
    expect(await loadResponsePage(plan.id, reader({ hp_session: stranger.token }))).toEqual({
      kind: "not_found",
    });
    expect(await loadResponsePage(plan.id, reader({}))).toEqual({ kind: "not_found" });
    expect(
      await loadResponsePage("pln_doesnotexist", reader({ hp_session: organizer.token })),
    ).toEqual({ kind: "not_found" });
  });

  it("T-001-40/AC-4 answers not_found for a participant of another plan", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const member = await register(uniqueEmail("member"), "Nour");
    const plan = await openPlan(organizer.token);
    const other = await openPlan(organizer.token);
    await addParticipant(other.id, member.id, null, "Nour");

    expect(await loadResponsePage(plan.id, reader({ hp_session: member.token }))).toEqual({
      kind: "not_found",
    });
  });
});

describe("GET /api/v1/plans/{planId}/response", () => {
  it("T-001-40/AC-1 answers 200 with the loader's view, with and without a saved response", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const member = await register(uniqueEmail("member"), "Nour");
    const plan = await openPlan(organizer.token);
    const memberId = await addParticipant(plan.id, member.id, null, "Nour");
    const cookie = `hp_session=${member.token}`;

    const empty = await routeGet(plan.id, cookie);
    expect(empty.status).toBe(200);
    const emptyPage = await loadResponsePage(plan.id, reader({ hp_session: member.token }));
    expect(emptyPage.kind).toBe("ok");
    expect(await empty.json()).toEqual(emptyPage.kind === "ok" ? JSON.parse(JSON.stringify(emptyPage.view)) : null);

    await saveResponse(plan.id, memberId);
    const saved = await routeGet(plan.id, cookie);
    expect(saved.status).toBe(200);
    const savedBody = (await saved.json()) as { response: { complete: boolean; start: unknown } };
    expect(savedBody.response.complete).toBe(true);
    expect(savedBody.response.start).toEqual({ name: "Maadi, Cairo" });
  });

  it("T-001-40/AC-1 answers 409 responses_closed while proposed and 409 plan_locked while locked", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const member = await register(uniqueEmail("member"), "Nour");
    const plan = await openPlan(organizer.token);
    await addParticipant(plan.id, member.id, null, "Nour");
    const cookie = `hp_session=${member.token}`;

    await sql`UPDATE plans SET state = 'proposed' WHERE id = ${plan.id}`;
    const proposed = await routeGet(plan.id, cookie);
    expect(proposed.status).toBe(409);
    expect(((await proposed.json()) as { error: { code: string; reason: string } }).error).toMatchObject({
      code: "conflict",
      reason: "responses_closed",
    });

    await sql`UPDATE plans SET state = 'locked' WHERE id = ${plan.id}`;
    const locked = await routeGet(plan.id, cookie);
    expect(locked.status).toBe(409);
    expect(((await locked.json()) as { error: { code: string; reason: string } }).error).toMatchObject({
      code: "conflict",
      reason: "plan_locked",
    });
  });

  it("T-001-40/AC-1 answers 404 with the envelope only for the organizer, a stranger and an unknown plan", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const stranger = await register(uniqueEmail("stranger"), "Sam");
    const plan = await openPlan(organizer.token);

    for (const [planId, token] of [
      [plan.id, organizer.token],
      [plan.id, stranger.token],
      ["pln_doesnotexist", organizer.token],
    ] as const) {
      const response = await routeGet(planId, `hp_session=${token}`);
      expect(response.status).toBe(404);
      const body = (await response.json()) as { error: { code: string }; title?: unknown };
      expect(body.error.code).toBe("not_found");
      expect(Object.keys(body)).toEqual(["error"]);
    }
  });
});
