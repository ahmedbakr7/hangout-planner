import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { POST as createAccount } from "@/app/api/v1/accounts/route";
import { POST as createPlan } from "@/app/api/v1/plans/route";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { generateCookieToken, hashCookieToken } from "@/server/auth/session";
import { generateId } from "@/server/ids";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { loadProposalPage } from "@/server/proposal/page-data";

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
  distinguisher: string,
): Promise<string> {
  const id = generateId("prt_");
  await sql`
    INSERT INTO participants (id, plan_id, account_id, guest_session_id, display_name, distinguisher)
    VALUES (${id}, ${planId}, ${accountId}, ${guestSessionId}, ${displayName}, ${distinguisher})
  `;
  return id;
}

async function seedProposal(planId: string, cohortIds: string[]): Promise<void> {
  const proposalId = `prp_${randomBytes(8).toString("hex")}`;
  const steps = await sql<{ id: string }[]>`
    SELECT id FROM plan_steps WHERE plan_id = ${planId} ORDER BY position
  `;
  const options = await sql<{ id: string }[]>`
    SELECT id FROM plan_options WHERE step_id = ${steps[0]!.id} ORDER BY position
  `;
  await sql`
    INSERT INTO proposals (id, plan_id, local_date, local_time, fairness_warning)
    VALUES (${proposalId}, ${planId}, '2026-10-02', '18:30', false)
  `;
  await sql`
    INSERT INTO proposal_steps (proposal_id, step_id, option_id, google_place_id, place_name, amount_minor)
    VALUES (${proposalId}, ${steps[0]!.id}, ${options[0]!.id}, 'ChIJ-abu-tarek', 'Abu Tarek', 12000)
  `;
  for (const participantId of cohortIds) {
    await sql`
      INSERT INTO proposal_cohort (proposal_id, participant_id, attending)
      VALUES (${proposalId}, ${participantId}, true)
    `;
  }
  await sql`UPDATE plans SET state = 'proposed' WHERE id = ${planId}`;
}

async function wipePlan(planId: string): Promise<void> {
  const guestRows = await sql<{ id: string }[]>`
    SELECT DISTINCT guest_session_id AS id
    FROM participants
    WHERE plan_id = ${planId} AND guest_session_id IS NOT NULL
  `;
  await sql`DELETE FROM proposal_cohort WHERE proposal_id IN (SELECT id FROM proposals WHERE plan_id = ${planId})`;
  await sql`DELETE FROM proposal_steps WHERE proposal_id IN (SELECT id FROM proposals WHERE plan_id = ${planId})`;
  await sql`DELETE FROM proposals WHERE plan_id = ${planId}`;
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

beforeAll(async () => {
  await sql`SELECT pg_advisory_lock(60139)`;
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
    await sql`SELECT pg_advisory_unlock(60139)`;
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
  for (const id of extraGuestIds.splice(0, extraGuestIds.length)) {
    await sql`DELETE FROM guest_sessions WHERE id = ${id}`;
  }
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
  await closePlans();
  await closeAccounts();
});

describe("loadProposalPage", () => {
  it("T-001-39/AC-1 answers collecting for the organizer of a collecting plan", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const plan = await openPlan(organizer.token);

    expect(await loadProposalPage(plan.id, reader({ hp_session: organizer.token }))).toEqual({
      kind: "collecting",
    });
  });

  it("T-001-39/AC-2 answers ok with the blocked state and its block for the organizer of a blocked plan", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const plan = await openPlan(organizer.token);
    await sql`UPDATE plans SET state = 'blocked' WHERE id = ${plan.id}`;
    await sql`
      INSERT INTO proposal_runs (id, plan_id, started_at, outcome, block_time, block_budget, block_venue_data)
      VALUES (${`run_${randomBytes(8).toString("hex")}`},${plan.id}, now(), 'blocked', false, true, false)
    `;

    expect(await loadProposalPage(plan.id, reader({ hp_session: organizer.token }))).toEqual({
      kind: "ok",
      view: {
        state: "blocked",
        block: { time: false, budget: true, venue_data: false },
        proposal: null,
      },
    });
  });

  it("T-001-39/AC-2 answers ok with the organizer proposal for the organizer of a proposed plan", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const member = await register(uniqueEmail("member"), "Nour");
    const plan = await openPlan(organizer.token);
    const memberId = await addParticipant(plan.id, member.id, null, "Nour", "a3k9");
    await seedProposal(plan.id, [memberId]);

    const result = await loadProposalPage(plan.id, reader({ hp_session: organizer.token }));

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok" || result.view.state !== "proposed") {
      return;
    }
    expect(result.view.block).toBeNull();
    expect(result.view.proposal?.cohort_size).toBe(1);
    expect(result.view.proposal?.time).toEqual({
      local_date: "2026-10-02",
      local_time: "18:30",
      timezone: "Africa/Cairo",
    });
    expect(result.view.proposal?.steps[0]).toMatchObject({
      name: "Dinner",
      option_label: "Koshary",
      place: { name: "Abu Tarek", amount_minor: 12000, currency: "EGP" },
      like_count: 0,
      dislike_count: 0,
      alternatives: [],
    });
  });

  it("T-001-39/AC-2 gives a cohort member my_signal and a non-cohort participant neither signal nor counts", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const inCohort = await register(uniqueEmail("cohort"), "Nour");
    const outside = await register(uniqueEmail("outside"), "Hana");
    const plan = await openPlan(organizer.token);
    const cohortId = await addParticipant(plan.id, inCohort.id, null, "Nour", "a3k9");
    await addParticipant(plan.id, outside.id, null, "Hana", "k7m2");
    await seedProposal(plan.id, [cohortId]);

    const member = await loadProposalPage(plan.id, reader({ hp_session: inCohort.token }));
    expect(member.kind).toBe("ok");
    if (member.kind === "ok" && member.view.state === "proposed") {
      const step = member.view.proposal?.steps[0];
      expect(step).toHaveProperty("my_signal", "unset");
      expect(step).not.toHaveProperty("like_count");
      expect(step).not.toHaveProperty("alternatives");
    }

    const visitor = await loadProposalPage(plan.id, reader({ hp_session: outside.token }));
    expect(visitor.kind).toBe("ok");
    if (visitor.kind === "ok" && visitor.view.state === "proposed") {
      const step = visitor.view.proposal?.steps[0];
      expect(step).not.toHaveProperty("my_signal");
      expect(step).not.toHaveProperty("like_count");
      expect(step).not.toHaveProperty("alternatives");
    }
  });

  it("T-001-39/AC-1 answers not_proposed for a participant while collecting or blocked", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const member = await register(uniqueEmail("member"), "Nour");
    const plan = await openPlan(organizer.token);
    await addParticipant(plan.id, member.id, null, "Nour", "a3k9");

    expect(await loadProposalPage(plan.id, reader({ hp_session: member.token }))).toEqual({
      kind: "not_proposed",
    });
    await sql`UPDATE plans SET state = 'blocked' WHERE id = ${plan.id}`;
    expect(await loadProposalPage(plan.id, reader({ hp_session: member.token }))).toEqual({
      kind: "not_proposed",
    });
  });

  it("T-001-39/AC-1 answers locked for the organizer and a participant of a locked plan, and not_found for an invited account", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const member = await register(uniqueEmail("member"), "Nour");
    const invited = await register(uniqueEmail("invited"), "Ziad");
    const plan = await openPlan(organizer.token);
    await addParticipant(plan.id, member.id, null, "Nour", "a3k9");
    await sql`
      INSERT INTO invitations (id, plan_id, account_id, distinguisher)
      VALUES (${generateId("inv_")}, ${plan.id}, ${invited.id}, 'k7m2')
    `;
    await sql`UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${plan.id}`;

    expect(await loadProposalPage(plan.id, reader({ hp_session: organizer.token }))).toEqual({
      kind: "locked",
    });
    expect(await loadProposalPage(plan.id, reader({ hp_session: member.token }))).toEqual({
      kind: "locked",
    });
    expect(await loadProposalPage(plan.id, reader({ hp_session: invited.token }))).toEqual({
      kind: "not_found",
    });
  });

  it("T-001-39/AC-1 answers not_found for a stranger, no cookie, a link reader and an unknown plan", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const stranger = await register(uniqueEmail("stranger"), "Ziad");
    const plan = await openPlan(organizer.token);
    const linkToken = generateCookieToken();
    const linkId = `lnk_${randomBytes(8).toString("hex")}`;
    extraLinkIds.push(linkId);
    await sql`
      INSERT INTO link_sessions (id, token_hash, expires_at)
      VALUES (${linkId}, ${hashCookieToken(linkToken)}, ${new Date("2099-01-01T00:00:00.000Z")})
    `;
    await sql`INSERT INTO link_session_plans (link_session_id, plan_id) VALUES (${linkId}, ${plan.id})`;

    expect(await loadProposalPage(plan.id, reader({ hp_session: stranger.token }))).toEqual({
      kind: "not_found",
    });
    expect(await loadProposalPage(plan.id, reader({}))).toEqual({ kind: "not_found" });
    expect(await loadProposalPage(plan.id, reader({ hp_link: linkToken }))).toEqual({
      kind: "not_found",
    });
    expect(
      await loadProposalPage(generateId("pln_"), reader({ hp_session: organizer.token })),
    ).toEqual({ kind: "not_found" });
  });

  it("T-001-39/AC-2 reads a guest participant's cohort membership from the hp_guest cookie", async () => {
    const organizer = await register(uniqueEmail("org"), "Omar");
    const plan = await openPlan(organizer.token);
    const guestToken = generateCookieToken();
    const guestId = `gst_${randomBytes(8).toString("hex")}`;
    extraGuestIds.push(guestId);
    await sql`
      INSERT INTO guest_sessions (id, token_hash, expires_at)
      VALUES (${guestId}, ${hashCookieToken(guestToken)}, ${new Date("2099-01-01T00:00:00.000Z")})
    `;
    const guestParticipant = await addParticipant(plan.id, null, guestId, "Guest", "g1g1");
    await seedProposal(plan.id, [guestParticipant]);

    const result = await loadProposalPage(plan.id, reader({ hp_guest: guestToken }));

    expect(result.kind).toBe("ok");
    if (result.kind === "ok" && result.view.state === "proposed") {
      expect(result.view.proposal?.steps[0]).toHaveProperty("my_signal", "unset");
    }
  });
});
