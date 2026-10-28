import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { generateCookieToken, hashCookieToken } from "@/server/auth/session";
import { resetClock, setClock } from "@/server/clock";
import { generateId } from "@/server/ids";
import {
  PLACES_SEARCH_TEXT_URL,
  START_DETAILS_FIELD_MASK,
  type FetchFn,
} from "@/server/google/places";
import { ROUTES_MATRIX_URL } from "@/server/google/routes";
import { ATTEMPT_LOCK_MS, closeDatabase as closeAttempt } from "@/server/proposal/attempt";
import { POST as createAccount } from "../../../accounts/route";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { POST as createPlan } from "../../route";
import { closeDatabase as closePlans } from "@/server/plans/http";
import {
  PROPOSAL_ATTEMPT_HOUR_CAP,
  setProposalAttemptGoogleOptions,
} from "@/server/proposal/trigger";
import {
  GET,
  PUT,
} from "./route";
import { setGoogleClientOptions } from "@/server/response/google";
import { PATCH as patchPlanRoute } from "../route";
import { POST as postAttemptRoute } from "../proposal-attempts/route";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const migrationPath = resolve(process.cwd(), "drizzle/0001_init.sql");

const sql = postgres(databaseUrl, {
  max: 1,
  idle_timeout: 0,
  connect_timeout: 10,
  onnotice: () => {},
});

const createdEmails: string[] = [];
const extraGuestIds: string[] = [];
const originalProposalEnabled = process.env.HP_PROPOSAL_ENABLED;

const startCafe = {
  id: "ChIJ-start",
  displayName: { text: "Maadi, Cairo" },
  location: { latitude: 29.96, longitude: 31.25 },
};

const otherCafe = {
  id: "ChIJ-other",
  displayName: { text: "Zamalek Garden" },
  location: { latitude: 30.06, longitude: 31.22 },
};

function uniqueEmail(label = "user"): string {
  return `${label}.${randomBytes(8).toString("hex")}@example.com`;
}

function track(email: string): string {
  createdEmails.push(email);
  return email;
}

async function wipePlan(planId: string): Promise<void> {
  const guestRows = await sql<{ id: string }[]>`
    SELECT DISTINCT guest_session_id AS id
    FROM participants
    WHERE plan_id = ${planId} AND guest_session_id IS NOT NULL
  `;
  await sql`DELETE FROM step_signals WHERE proposal_id IN (SELECT id FROM proposals WHERE plan_id = ${planId})`;
  await sql`DELETE FROM proposal_alternatives WHERE proposal_id IN (SELECT id FROM proposals WHERE plan_id = ${planId})`;
  await sql`DELETE FROM proposal_candidates WHERE proposal_id IN (SELECT id FROM proposals WHERE plan_id = ${planId})`;
  await sql`DELETE FROM proposal_legs WHERE proposal_id IN (SELECT id FROM proposals WHERE plan_id = ${planId})`;
  await sql`DELETE FROM proposal_steps WHERE proposal_id IN (SELECT id FROM proposals WHERE plan_id = ${planId})`;
  await sql`DELETE FROM proposal_cohort WHERE proposal_id IN (SELECT id FROM proposals WHERE plan_id = ${planId})`;
  await sql`DELETE FROM proposals WHERE plan_id = ${planId}`;
  await sql`DELETE FROM proposal_runs WHERE plan_id = ${planId}`;
  await sql`DELETE FROM response_picks WHERE participant_id IN (SELECT id FROM participants WHERE plan_id = ${planId})`;
  await sql`DELETE FROM response_windows WHERE participant_id IN (SELECT id FROM participants WHERE plan_id = ${planId})`;
  await sql`DELETE FROM responses WHERE participant_id IN (SELECT id FROM participants WHERE plan_id = ${planId})`;
  await sql`DELETE FROM participants WHERE plan_id = ${planId}`;
  await sql`DELETE FROM invitations WHERE plan_id = ${planId}`;
  await sql`DELETE FROM link_session_plans WHERE plan_id = ${planId}`;
  await sql`DELETE FROM plan_options WHERE step_id IN (SELECT id FROM plan_steps WHERE plan_id = ${planId})`;
  await sql`DELETE FROM plan_steps WHERE plan_id = ${planId}`;
  await sql`DELETE FROM plan_windows WHERE plan_id = ${planId}`;
  await sql`DELETE FROM plans WHERE id = ${planId}`;
  for (const row of guestRows) {
    await sql`DELETE FROM guest_sessions WHERE id = ${row.id}`;
  }
}

async function forget(email: string): Promise<void> {
  const accountsRows = await sql<{ id: string }[]>`
    SELECT id FROM accounts WHERE email = ${email}
  `;
  for (const account of accountsRows) {
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
  await sql`SELECT pg_advisory_lock(60106)`;
  try {
    const rows = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'accounts'
      ) AS exists
    `;
    if (!rows[0]?.exists) {
      await sql.file(migrationPath);
    }
  } finally {
    await sql`SELECT pg_advisory_unlock(60106)`;
  }
});

beforeEach(() => {
  process.env.HP_HASH_TEST = "1";
  delete process.env.HP_PROPOSAL_ENABLED;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    throw new Error(`unit tests must not call the network: ${String(input)}`);
  });
  setGoogleClientOptions({
    apiKey: "test-places-key",
    fetch: detailsFetch(startCafe),
  });
  setProposalAttemptGoogleOptions(undefined);
});

afterEach(async () => {
  resetClock();
  delete process.env.HP_HASH_TEST;
  if (originalProposalEnabled === undefined) {
    delete process.env.HP_PROPOSAL_ENABLED;
  } else {
    process.env.HP_PROPOSAL_ENABLED = originalProposalEnabled;
  }
  setGoogleClientOptions(undefined);
  setProposalAttemptGoogleOptions(undefined);
  vi.unstubAllGlobals();
  const emails = createdEmails.splice(0, createdEmails.length);
  for (const email of emails) {
    await forget(email);
  }
  const guests = extraGuestIds.splice(0, extraGuestIds.length);
  for (const id of guests) {
    await sql`DELETE FROM response_picks WHERE participant_id IN (SELECT id FROM participants WHERE guest_session_id = ${id})`;
    await sql`DELETE FROM response_windows WHERE participant_id IN (SELECT id FROM participants WHERE guest_session_id = ${id})`;
    await sql`DELETE FROM responses WHERE participant_id IN (SELECT id FROM participants WHERE guest_session_id = ${id})`;
    await sql`DELETE FROM participants WHERE guest_session_id = ${id}`;
    await sql`DELETE FROM guest_sessions WHERE id = ${id}`;
  }
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
  await closeAttempt();
  await closePlans();
  await closeAccounts();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function detailsFetch(place: unknown, status = 200): FetchFn {
  return async () => jsonResponse(place, status);
}

function setCookieLines(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function cookieLine(response: Response, name: string): string | null {
  return setCookieLines(response).find((line) => line.startsWith(`${name}=`)) ?? null;
}

function cookieValue(line: string, name: string): string {
  const pair = line.split(";", 1)[0] ?? "";
  return decodeURIComponent(pair.slice(`${name}=`.length));
}

function sessionSetCookie(response: Response): string | null {
  return cookieLine(response, "hp_session");
}

function validPlan(overrides: Record<string, unknown> = {}) {
  return {
    title: "Thursday in Maadi",
    timezone: "Africa/Cairo",
    windows: [
      { local_date: "2026-10-02", start_local: "18:00", end_local: "23:00" },
      { local_date: "2026-10-03", start_local: "10:00", end_local: "14:00" },
    ],
    budget: { amount_minor: 50_000, currency: "EGP" },
    steps: [
      { name: "Dinner", options: ["Koshary", "Grills"] },
      { name: "Coffee", options: ["Turkish", "Filter"] },
    ],
    threshold: 3,
    ...overrides,
  };
}

function jsonRequest(
  path: string,
  method: string,
  body: unknown,
  init?: { csrf?: boolean; cookie?: string },
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (init?.csrf !== false) {
    headers["x-hp-request"] = "1";
  }
  if (init?.cookie) {
    headers.cookie = init.cookie;
  }
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
}

async function register(email: string, displayName = "Nour") {
  const response = await createAccount(
    jsonRequest("/v1/accounts", "POST", {
      email,
      password: "password1",
      display_name: displayName,
    }),
  );
  expect(response.status).toBe(201);
  const body = (await response.json()) as {
    account: { id: string; email: string; display_name: string };
  };
  const line = sessionSetCookie(response);
  expect(line).not.toBeNull();
  return { account: body.account, token: cookieValue(line!, "hp_session") };
}

async function openPlan(sessionToken: string, overrides: Record<string, unknown> = {}) {
  const response = await createPlan(
    jsonRequest("/v1/plans", "POST", validPlan(overrides), {
      cookie: `hp_session=${sessionToken}`,
    }),
  );
  expect(response.status).toBe(201);
  return (await response.json()) as {
    id: string;
    title: string;
    join_path: string;
  };
}

async function seedAccountParticipant(
  planId: string,
  accountId: string,
  displayName: string,
  distinguisher = "a3k9",
): Promise<string> {
  const participantId = generateId("prt_");
  await sql`
    INSERT INTO participants (
      id, plan_id, account_id, guest_session_id, display_name, distinguisher
    ) VALUES (
      ${participantId}, ${planId}, ${accountId}, NULL, ${displayName}, ${distinguisher}
    )
  `;
  return participantId;
}

async function seedGuestParticipant(
  planId: string,
  displayName: string,
  distinguisher: string,
): Promise<{ guestId: string; token: string; participantId: string }> {
  const token = generateCookieToken();
  const guestId = `gst_${randomBytes(8).toString("hex")}`;
  extraGuestIds.push(guestId);
  await sql`
    INSERT INTO guest_sessions (id, token_hash, expires_at)
    VALUES (
      ${guestId},
      ${hashCookieToken(token)},
      ${new Date("2027-01-01T00:00:00.000Z")}
    )
  `;
  const participantId = generateId("prt_");
  await sql`
    INSERT INTO participants (
      id, plan_id, account_id, guest_session_id, display_name, distinguisher
    ) VALUES (
      ${participantId}, ${planId}, NULL, ${guestId}, ${displayName}, ${distinguisher}
    )
  `;
  return { guestId, token, participantId };
}

type PlanShape = {
  windows: { id: string; local_date: string; start_local: string; end_local: string }[];
  steps: { id: string; name: string }[];
  options: { id: string; step_id: string; label: string }[];
};

async function planShape(planId: string): Promise<PlanShape> {
  const windows = await sql<PlanShape["windows"]>`
    SELECT id, local_date, start_local, end_local
    FROM plan_windows
    WHERE plan_id = ${planId}
    ORDER BY position
  `;
  const steps = await sql<PlanShape["steps"]>`
    SELECT id, name FROM plan_steps WHERE plan_id = ${planId} ORDER BY position
  `;
  const options = await sql<PlanShape["options"]>`
    SELECT id, step_id, label
    FROM plan_options
    WHERE step_id IN (SELECT id FROM plan_steps WHERE plan_id = ${planId})
    ORDER BY step_id, position
  `;
  return { windows, steps, options };
}

function optionFor(shape: PlanShape, stepId: string, label: string): string {
  const option = shape.options.find(
    (row) => row.step_id === stepId && row.label === label,
  );
  expect(option).toBeDefined();
  return option!.id;
}

function completeBody(shape: PlanShape, startPlaceId = startCafe.id) {
  return {
    windows: [
      { window_id: shape.windows[0]!.id, kind: "busy" },
      {
        window_id: shape.windows[1]!.id,
        kind: "free",
        earliest_local: "10:30",
        latest_local: "13:00",
      },
    ],
    start_place_id: startPlaceId,
    picks: [
      {
        step_id: shape.steps[0]!.id,
        option_id: optionFor(shape, shape.steps[0]!.id, "Koshary"),
      },
      {
        step_id: shape.steps[1]!.id,
        option_id: optionFor(shape, shape.steps[1]!.id, "Turkish"),
      },
    ],
  };
}

function responseGet(planId: string, cookie?: string) {
  const headers: Record<string, string> = {};
  if (cookie) {
    headers.cookie = cookie;
  }
  return GET(new Request(`http://localhost/v1/plans/${planId}/response`, { headers }), {
    params: Promise.resolve({ planId }),
  });
}

function responsePut(
  planId: string,
  body: unknown,
  init?: { csrf?: boolean; cookie?: string },
) {
  return PUT(
    jsonRequest(`/v1/plans/${planId}/response`, "PUT", body, init),
    { params: Promise.resolve({ planId }) },
  );
}

async function answeredCount(planId: string): Promise<number> {
  const rows = await sql<{ answered_count: number }[]>`
    SELECT answered_count FROM plans WHERE id = ${planId}
  `;
  return Number(rows[0]?.answered_count ?? 0);
}

async function planState(planId: string): Promise<string> {
  const rows = await sql<{ state: string }[]>`
    SELECT state FROM plans WHERE id = ${planId}
  `;
  return rows[0]?.state ?? "";
}

type GetBody = {
  title: string;
  plan_state: string;
  budget: { amount_minor: number; currency: string };
  timezone: string;
  windows: { id: string; local_date: string; start_local: string; end_local: string }[];
  steps: { id: string; name: string; options: { id: string; label: string }[] }[];
  response: {
    complete: boolean;
    windows: Record<string, unknown>[];
    start: { name: string } | null;
    picks: { step_id: string; option_id: string }[];
  };
};

describe("GET/PUT /v1/plans/{planId}/response", () => {
  it("an incomplete valid save by an incomplete caller returns 200 complete false and leaves answered_count unchanged; the first complete save returns 200 complete true, first_completion true, and increments answered_count by one in the same transaction as the write", async () => {
    const orgEmail = track(uniqueEmail("org"));
    const memberEmail = track(uniqueEmail("member"));
    const organizer = await register(orgEmail, "Omar");
    const member = await register(memberEmail, "Nour");
    const plan = await openPlan(organizer.token, { threshold: 2 });
    const participantId = await seedAccountParticipant(
      plan.id,
      member.account.id,
      "Nour",
    );
    const shape = await planShape(plan.id);
    const cookie = `hp_session=${member.token}`;

    const empty = await responseGet(plan.id, cookie);
    expect(empty.status).toBe(200);
    const emptyBody = (await empty.json()) as GetBody;
    expect(emptyBody.response.complete).toBe(false);
    expect(emptyBody.response.start).toBeNull();
    expect(emptyBody.response.windows).toEqual([]);
    expect(emptyBody.response.picks).toEqual([]);
    expect(await answeredCount(plan.id)).toBe(0);

    const draft = await responsePut(
      plan.id,
      {
        windows: [{ window_id: shape.windows[0]!.id, kind: "busy" }],
      },
      { cookie },
    );
    expect(draft.status).toBe(200);
    expect(await draft.json()).toEqual({
      complete: false,
      first_completion: false,
      plan_state: "collecting",
    });
    expect(await answeredCount(plan.id)).toBe(0);
    expect(await planState(plan.id)).toBe("collecting");
    const draftRows = await sql<{ complete: boolean }[]>`
      SELECT complete FROM responses WHERE participant_id = ${participantId}
    `;
    expect(draftRows[0]?.complete).toBe(false);

    const first = await responsePut(plan.id, completeBody(shape), { cookie });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      complete: true,
      first_completion: true,
      plan_state: "collecting",
    });
    expect(await answeredCount(plan.id)).toBe(1);
    expect(await planState(plan.id)).toBe("collecting");
    const stored = await sql<
      {
        complete: boolean;
        start_google_place_id: string | null;
        start_name: string | null;
        start_lat: number | null;
        start_lng: number | null;
      }[]
    >`
      SELECT complete, start_google_place_id, start_name, start_lat, start_lng
      FROM responses
      WHERE participant_id = ${participantId}
    `;
    expect(stored[0]?.complete).toBe(true);
    expect(stored[0]?.start_google_place_id).toBe(startCafe.id);
    expect(stored[0]?.start_name).toBe("Maadi, Cairo");
    expect(stored[0]?.start_lat).toBe(29.96);
    expect(stored[0]?.start_lng).toBe(31.25);
  });

  it("a later complete valid save returns first_completion false, replaces the stored answers, and does not increment the count; an incomplete or invalid body from a complete caller returns 400 and leaves the stored complete response", async () => {
    const orgEmail = track(uniqueEmail("host"));
    const memberEmail = track(uniqueEmail("member"));
    const organizer = await register(orgEmail, "Omar");
    const member = await register(memberEmail, "Nour");
    const plan = await openPlan(organizer.token);
    const participantId = await seedAccountParticipant(
      plan.id,
      member.account.id,
      "Nour",
    );
    const shape = await planShape(plan.id);
    const cookie = `hp_session=${member.token}`;

    const first = await responsePut(plan.id, completeBody(shape), { cookie });
    expect(first.status).toBe(200);
    expect(await answeredCount(plan.id)).toBe(1);

    setGoogleClientOptions({
      apiKey: "test-places-key",
      fetch: detailsFetch(otherCafe),
    });
    const laterBody = completeBody(shape, otherCafe.id);
    laterBody.windows[0] = {
      window_id: shape.windows[0]!.id,
      kind: "free",
      earliest_local: "18:00",
      latest_local: "20:00",
    };
    laterBody.picks[0] = {
      step_id: shape.steps[0]!.id,
      option_id: optionFor(shape, shape.steps[0]!.id, "Grills"),
    };
    const later = await responsePut(plan.id, laterBody, { cookie });
    expect(later.status).toBe(200);
    expect(await later.json()).toEqual({
      complete: true,
      first_completion: false,
      plan_state: "collecting",
    });
    expect(await answeredCount(plan.id)).toBe(1);

    const storedWindows = await sql<{ kind: string; window_id: string }[]>`
      SELECT kind, window_id FROM response_windows
      WHERE participant_id = ${participantId}
      ORDER BY window_id
    `;
    expect(storedWindows.some((row) => row.kind === "free")).toBe(true);
    const storedPicks = await sql<{ option_id: string; step_id: string }[]>`
      SELECT option_id, step_id FROM response_picks WHERE participant_id = ${participantId}
    `;
    expect(storedPicks).toContainEqual({
      step_id: shape.steps[0]!.id,
      option_id: optionFor(shape, shape.steps[0]!.id, "Grills"),
    });
    const start = await sql<{ start_name: string | null }[]>`
      SELECT start_name FROM responses WHERE participant_id = ${participantId}
    `;
    expect(start[0]?.start_name).toBe("Zamalek Garden");

    const incomplete = await responsePut(
      plan.id,
      { windows: [{ window_id: shape.windows[0]!.id, kind: "busy" }] },
      { cookie },
    );
    expect(incomplete.status).toBe(400);
    expect(await incomplete.json()).toMatchObject({
      error: { code: "validation_failed" },
    });

    const invalid = await responsePut(
      plan.id,
      {
        ...completeBody(shape),
        windows: [{ window_id: "win_notrealnotrealnotre", kind: "busy" }],
      },
      { cookie },
    );
    expect(invalid.status).toBe(400);

    expect(await answeredCount(plan.id)).toBe(1);
    const still = await sql<{ complete: boolean; start_name: string | null }[]>`
      SELECT complete, start_name FROM responses WHERE participant_id = ${participantId}
    `;
    expect(still[0]?.complete).toBe(true);
    expect(still[0]?.start_name).toBe("Zamalek Garden");
    const pickCount = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM response_picks WHERE participant_id = ${participantId}
    `;
    expect(Number(pickCount[0]?.count)).toBe(2);
  });

  it("an invalid window or pick returns 400 and writes nothing; a complete response requires every window, a stored start, and exactly one pick per step", async () => {
    const orgEmail = track(uniqueEmail("org"));
    const memberEmail = track(uniqueEmail("member"));
    const organizer = await register(orgEmail, "Omar");
    const member = await register(memberEmail, "Nour");
    const plan = await openPlan(organizer.token);
    const participantId = await seedAccountParticipant(
      plan.id,
      member.account.id,
      "Nour",
    );
    const shape = await planShape(plan.id);
    const cookie = `hp_session=${member.token}`;

    const outside = await responsePut(
      plan.id,
      {
        windows: [
          {
            window_id: shape.windows[0]!.id,
            kind: "free",
            earliest_local: "17:00",
            latest_local: "22:00",
          },
        ],
      },
      { cookie },
    );
    expect(outside.status).toBe(400);
    expect(await outside.json()).toMatchObject({
      error: {
        code: "validation_failed",
        fields: [{ path: "windows[0].earliest_local", code: "outside_window" }],
      },
    });
    const none = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM responses WHERE participant_id = ${participantId}
    `;
    expect(Number(none[0]?.count)).toBe(0);

    const badPick = await responsePut(
      plan.id,
      {
        windows: [{ window_id: shape.windows[0]!.id, kind: "busy" }],
        picks: [
          {
            step_id: shape.steps[0]!.id,
            option_id: optionFor(shape, shape.steps[1]!.id, "Turkish"),
          },
        ],
      },
      { cookie },
    );
    expect(badPick.status).toBe(400);
    expect(await badPick.json()).toMatchObject({
      error: {
        fields: [{ path: "picks[0].option_id", code: "unknown" }],
      },
    });

    const startOnly = await responsePut(
      plan.id,
      { start_place_id: startCafe.id },
      { cookie },
    );
    expect(startOnly.status).toBe(200);
    expect(await startOnly.json()).toMatchObject({ complete: false });
    expect(await answeredCount(plan.id)).toBe(0);

    const windowsAndPicks = await responsePut(
      plan.id,
      {
        windows: completeBody(shape).windows,
        picks: completeBody(shape).picks,
      },
      { cookie },
    );
    expect(windowsAndPicks.status).toBe(200);
    expect(await windowsAndPicks.json()).toEqual({
      complete: true,
      first_completion: true,
      plan_state: "collecting",
    });
    expect(await answeredCount(plan.id)).toBe(1);
  });

  it("a present start_place_id is resolved with Place Details; JSON includes the start name only; a Details failure is 503 upstream and writes nothing", async () => {
    const orgEmail = track(uniqueEmail("org"));
    const memberEmail = track(uniqueEmail("member"));
    const organizer = await register(orgEmail, "Omar");
    const member = await register(memberEmail, "Nour");
    const plan = await openPlan(organizer.token, { title: "Thursday in Maadi" });
    const participantId = await seedAccountParticipant(
      plan.id,
      member.account.id,
      "Nour",
    );
    const otherId = await seedAccountParticipant(
      plan.id,
      (await register(track(uniqueEmail("other")), "Hana")).account.id,
      "Hana",
      "k7m2",
    );
    await sql`
      INSERT INTO responses (
        participant_id, start_google_place_id, start_name, start_lat, start_lng, complete
      ) VALUES (
        ${otherId}, 'ChIJ-secret', 'Secret Dock', 1.23, 4.56, false
      )
    `;
    const shape = await planShape(plan.id);
    const cookie = `hp_session=${member.token}`;

    const captured: {
      url: string;
      method: string | undefined;
      fieldMask: string | undefined;
    }[] = [];
    setGoogleClientOptions({
      apiKey: "details-key",
      fetch: async (input, init) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const headers = init?.headers;
        const fieldMask =
          headers instanceof Headers
            ? (headers.get("X-Goog-FieldMask") ?? undefined)
            : headers && !Array.isArray(headers)
              ? headers["X-Goog-FieldMask"]
              : undefined;
        captured.push({ url, method: init?.method, fieldMask });
        return jsonResponse(startCafe);
      },
    });

    const saved = await responsePut(plan.id, completeBody(shape), { cookie });
    expect(saved.status).toBe(200);
    expect(captured.some((row) => row.url.includes("/places/ChIJ-start"))).toBe(
      true,
    );
    expect(captured.some((row) => row.method === "GET")).toBe(true);
    expect(captured.some((row) => row.fieldMask === START_DETAILS_FIELD_MASK)).toBe(
      true,
    );

    const got = await responseGet(plan.id, cookie);
    expect(got.status).toBe(200);
    const body = (await got.json()) as GetBody;
    expect(body.title).toBe("Thursday in Maadi");
    expect(body.steps[0]?.name).toBe("Dinner");
    expect(body.steps[0]?.options.map((option) => option.label)).toEqual([
      "Koshary",
      "Grills",
    ]);
    expect(body.response.start).toEqual({ name: "Maadi, Cairo" });
    expect(Object.keys(body.response.start!).sort()).toEqual(["name"]);
    const json = JSON.stringify(body);
    expect(json).not.toContain("answered_count");
    expect(json).not.toContain("threshold");
    expect(json).not.toContain("Secret Dock");
    expect(json).not.toContain("Hana");
    expect(json).not.toContain("ChIJ-start");
    expect(json).not.toContain("29.96");
    expect(json).not.toContain("31.25");
    expect(json).not.toContain(otherId);
    expect(body).not.toHaveProperty("answered_count");
    expect(body).not.toHaveProperty("threshold");
    expect(body).not.toHaveProperty("participants");

    const stored = await sql<
      { start_google_place_id: string | null; start_lat: number | null }[]
    >`
      SELECT start_google_place_id, start_lat FROM responses WHERE participant_id = ${participantId}
    `;
    expect(stored[0]?.start_google_place_id).toBe("ChIJ-start");
    expect(stored[0]?.start_lat).toBe(29.96);

    setGoogleClientOptions({
      apiKey: "details-key",
      fetch: async () => jsonResponse({ error: "nope" }, 500),
    });
    const failed = await responsePut(
      plan.id,
      completeBody(shape, "ChIJ-fail"),
      { cookie },
    );
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({
      error: {
        code: "upstream",
        message: "places upstream failed",
        fields: [],
      },
    });
    const afterFail = await sql<{ start_name: string | null }[]>`
      SELECT start_name FROM responses WHERE participant_id = ${participantId}
    `;
    expect(afterFail[0]?.start_name).toBe("Maadi, Cairo");
  });

  it("GET and PUT while proposed return 409 responses_closed, and while locked return 409 plan_locked", async () => {
    const orgEmail = track(uniqueEmail("org"));
    const memberEmail = track(uniqueEmail("member"));
    const organizer = await register(orgEmail, "Omar");
    const member = await register(memberEmail, "Nour");
    const plan = await openPlan(organizer.token);
    await seedAccountParticipant(plan.id, member.account.id, "Nour");
    const shape = await planShape(plan.id);
    const cookie = `hp_session=${member.token}`;

    await sql`UPDATE plans SET state = 'proposed' WHERE id = ${plan.id}`;
    const proposedGet = await responseGet(plan.id, cookie);
    expect(proposedGet.status).toBe(409);
    expect(await proposedGet.json()).toMatchObject({
      error: { code: "conflict", reason: "responses_closed", fields: [] },
    });
    const proposedPut = await responsePut(plan.id, completeBody(shape), {
      cookie,
    });
    expect(proposedPut.status).toBe(409);
    expect(await proposedPut.json()).toMatchObject({
      error: { reason: "responses_closed" },
    });
    expect(await answeredCount(plan.id)).toBe(0);

    await sql`UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${plan.id}`;
    const lockedGet = await responseGet(plan.id, cookie);
    expect(lockedGet.status).toBe(409);
    expect(await lockedGet.json()).toMatchObject({
      error: { code: "conflict", reason: "plan_locked", fields: [] },
    });
    const lockedPut = await responsePut(plan.id, completeBody(shape), { cookie });
    expect(lockedPut.status).toBe(409);
    expect(await lockedPut.json()).toMatchObject({
      error: { reason: "plan_locked" },
    });
  });

  it("a stranger gets 404 with the envelope only; missing X-HP-Request: 1 on PUT returns 403 csrf and writes nothing; completing save leaves plan_state unchanged", async () => {
    const orgEmail = track(uniqueEmail("org"));
    const memberEmail = track(uniqueEmail("member"));
    const organizer = await register(orgEmail, "Omar");
    const member = await register(memberEmail, "Nour");
    const stranger = await register(track(uniqueEmail("stranger")), "Ziad");
    const plan = await openPlan(organizer.token, {
      title: "Thursday in Maadi",
      threshold: 2,
    });
    const participantId = await seedAccountParticipant(
      plan.id,
      member.account.id,
      "Nour",
    );
    const shape = await planShape(plan.id);

    const strangerGet = await responseGet(plan.id, `hp_session=${stranger.token}`);
    expect(strangerGet.status).toBe(404);
    const strangerBody = await strangerGet.json();
    expect(strangerBody).toEqual({
      error: { code: "not_found", message: "plan not found", fields: [] },
    });
    expect(Object.keys(strangerBody)).toEqual(["error"]);
    const strangerJson = JSON.stringify(strangerBody);
    expect(strangerJson).not.toContain("Thursday in Maadi");
    expect(strangerJson).not.toContain("Nour");
    expect(strangerJson).not.toContain("Koshary");
    expect(strangerJson).not.toContain(plan.id);

    const organizerGet = await responseGet(
      plan.id,
      `hp_session=${organizer.token}`,
    );
    expect(organizerGet.status).toBe(404);

    const noSession = await responseGet(plan.id);
    expect(noSession.status).toBe(404);

    const csrf = await responsePut(plan.id, completeBody(shape), {
      cookie: `hp_session=${member.token}`,
      csrf: false,
    });
    expect(csrf.status).toBe(403);
    expect(await csrf.json()).toEqual({
      error: {
        code: "forbidden",
        reason: "csrf",
        message: "missing X-HP-Request",
        fields: [],
      },
    });
    const none = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM responses WHERE participant_id = ${participantId}
    `;
    expect(Number(none[0]?.count)).toBe(0);
    expect(await answeredCount(plan.id)).toBe(0);

    const first = await responsePut(plan.id, completeBody(shape), {
      cookie: `hp_session=${member.token}`,
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      complete: true,
      first_completion: true,
      plan_state: "collecting",
    });
    expect(await planState(plan.id)).toBe("collecting");
    expect(await answeredCount(plan.id)).toBe(1);

    await sql`UPDATE plans SET state = 'blocked' WHERE id = ${plan.id}`;
    const blocked = await responsePut(plan.id, completeBody(shape), {
      cookie: `hp_session=${member.token}`,
    });
    expect(blocked.status).toBe(200);
    expect(await blocked.json()).toEqual({
      complete: true,
      first_completion: false,
      plan_state: "blocked",
    });
    expect(await planState(plan.id)).toBe("blocked");
    expect(await answeredCount(plan.id)).toBe(1);

    const saveSource = await import("node:fs/promises").then((fs) =>
      fs.readFile(resolve(process.cwd(), "src/server/response/save.ts"), "utf8"),
    );
    expect(saveSource).not.toContain("runProposalAttempt");

    const guest = await seedGuestParticipant(plan.id, "Mona", "m2n4");
    const guestGet = await responseGet(plan.id, `hp_guest=${guest.token}`);
    expect(guestGet.status).toBe(200);
    expect(((await guestGet.json()) as GetBody).response.complete).toBe(false);
  });

  it("T-001-95/AC-1 T-001-20/AC-2 a later complete save returns first_completion false, replaces every stored answer and keeps the count; an incomplete or an invalid body from a complete caller returns 400 and leaves the stored complete response", async () => {
    const organizer = await register(track(uniqueEmail("org")), "Omar");
    const member = await register(track(uniqueEmail("member")), "Nour");
    const plan = await openPlan(organizer.token);
    const participantId = await seedAccountParticipant(plan.id, member.account.id, "Nour");
    const shape = await planShape(plan.id);
    const cookie = `hp_session=${member.token}`;

    const first = await responsePut(plan.id, completeBody(shape), { cookie });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      complete: true,
      first_completion: true,
      plan_state: "collecting",
    });
    expect(await answeredCount(plan.id)).toBe(1);

    setGoogleClientOptions({ apiKey: "test-places-key", fetch: detailsFetch(otherCafe) });
    const laterBody = {
      windows: [
        {
          window_id: shape.windows[0]!.id,
          kind: "free",
          earliest_local: "18:00",
          latest_local: "20:00",
        },
        { window_id: shape.windows[1]!.id, kind: "busy" },
      ],
      start_place_id: otherCafe.id,
      picks: [
        {
          step_id: shape.steps[0]!.id,
          option_id: optionFor(shape, shape.steps[0]!.id, "Grills"),
        },
        {
          step_id: shape.steps[1]!.id,
          option_id: optionFor(shape, shape.steps[1]!.id, "Filter"),
        },
      ],
    };
    const later = await responsePut(plan.id, laterBody, { cookie });
    expect(later.status).toBe(200);
    expect(await later.json()).toEqual({
      complete: true,
      first_completion: false,
      plan_state: "collecting",
    });
    expect(await answeredCount(plan.id)).toBe(1);

    // Every earlier answer is gone: windows, start and picks are exactly the later body.
    const replaced = await storedResponse(participantId);
    expect(replaced).toEqual({
      response: {
        complete: true,
        start_google_place_id: otherCafe.id,
        start_name: "Zamalek Garden",
        start_lat: 30.06,
        start_lng: 31.22,
      },
      windows: [
        {
          window_id: shape.windows[0]!.id,
          kind: "free",
          earliest_local: "18:00",
          latest_local: "20:00",
        },
        {
          window_id: shape.windows[1]!.id,
          kind: "busy",
          earliest_local: null,
          latest_local: null,
        },
      ].sort((a, b) => a.window_id.localeCompare(b.window_id)),
      picks: laterBody.picks
        .map((row) => ({ step_id: row.step_id, option_id: row.option_id }))
        .sort((a, b) => a.step_id.localeCompare(b.step_id)),
    });

    const incomplete = await responsePut(
      plan.id,
      { windows: [{ window_id: shape.windows[0]!.id, kind: "busy" }] },
      { cookie },
    );
    expect(incomplete.status).toBe(400);
    expect(await incomplete.json()).toMatchObject({
      error: { code: "validation_failed" },
    });
    expect(await storedResponse(participantId)).toEqual(replaced);
    expect(await answeredCount(plan.id)).toBe(1);

    const invalid = await responsePut(
      plan.id,
      {
        ...laterBody,
        windows: [{ window_id: "win_notrealnotrealnotre", kind: "busy" }],
      },
      { cookie },
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      error: { code: "validation_failed" },
    });
    expect(await storedResponse(participantId)).toEqual(replaced);
    expect(await answeredCount(plan.id)).toBe(1);
  });

  it("T-001-95/AC-1 T-001-20/AC-3 an invalid window or pick returns 400 and writes nothing; a response is complete only with every window, a stored start and exactly one pick per step", async () => {
    const organizer = await register(track(uniqueEmail("org")), "Omar");
    const plan = await openPlan(organizer.token);
    const shape = await planShape(plan.id);
    const full = completeBody(shape);
    const member = async (name: string, distinguisher: string) => {
      const account = await register(track(uniqueEmail(name)), name);
      const participantId = await seedAccountParticipant(
        plan.id,
        account.account.id,
        name,
        distinguisher,
      );
      return { participantId, cookie: `hp_session=${account.token}` };
    };

    // Invalid window and invalid pick: 400, and no row of any kind is written.
    const nour = await member("Nour", "a3k9");
    const outside = await responsePut(
      plan.id,
      {
        ...full,
        windows: [
          {
            window_id: shape.windows[0]!.id,
            kind: "free",
            earliest_local: "17:00",
            latest_local: "22:00",
          },
          full.windows[1]!,
        ],
      },
      { cookie: nour.cookie },
    );
    expect(outside.status).toBe(400);
    expect(await outside.json()).toMatchObject({
      error: {
        code: "validation_failed",
        fields: [{ path: "windows[0].earliest_local", code: "outside_window" }],
      },
    });
    expect(await storedResponse(nour.participantId)).toEqual({
      response: null,
      windows: [],
      picks: [],
    });

    const badPick = await responsePut(
      plan.id,
      {
        ...full,
        picks: [
          {
            step_id: shape.steps[0]!.id,
            option_id: optionFor(shape, shape.steps[1]!.id, "Turkish"),
          },
          full.picks[1]!,
        ],
      },
      { cookie: nour.cookie },
    );
    expect(badPick.status).toBe(400);
    expect(await badPick.json()).toMatchObject({
      error: {
        code: "validation_failed",
        fields: [{ path: "picks[0].option_id", code: "unknown" }],
      },
    });
    expect(await storedResponse(nour.participantId)).toEqual({
      response: null,
      windows: [],
      picks: [],
    });
    expect(await answeredCount(plan.id)).toBe(0);

    // Missing one window: stays incomplete.
    const missingWindow = await responsePut(
      plan.id,
      { ...full, windows: [full.windows[1]!] },
      { cookie: nour.cookie },
    );
    expect(missingWindow.status).toBe(200);
    expect(await missingWindow.json()).toEqual({
      complete: false,
      first_completion: false,
      plan_state: "collecting",
    });
    expect((await storedResponse(nour.participantId)).response?.complete).toBe(false);

    // No stored start: stays incomplete.
    const hana = await member("Hana", "k7m2");
    const noStart = await responsePut(
      plan.id,
      { windows: full.windows, picks: full.picks },
      { cookie: hana.cookie },
    );
    expect(noStart.status).toBe(200);
    expect(await noStart.json()).toMatchObject({ complete: false, first_completion: false });
    expect((await storedResponse(hana.participantId)).response).toMatchObject({
      complete: false,
      start_google_place_id: null,
    });

    // One step without a pick: stays incomplete; two picks for one step: 400, nothing written.
    const ziad = await member("Ziad", "z9q1");
    const onePick = await responsePut(
      plan.id,
      { ...full, picks: [full.picks[0]!] },
      { cookie: ziad.cookie },
    );
    expect(onePick.status).toBe(200);
    expect(await onePick.json()).toMatchObject({ complete: false, first_completion: false });
    const beforeDouble = await storedResponse(ziad.participantId);
    expect(beforeDouble.response?.complete).toBe(false);
    const doublePick = await responsePut(
      plan.id,
      {
        ...full,
        picks: [
          full.picks[0]!,
          {
            step_id: shape.steps[0]!.id,
            option_id: optionFor(shape, shape.steps[0]!.id, "Grills"),
          },
          full.picks[1]!,
        ],
      },
      { cookie: ziad.cookie },
    );
    expect(doublePick.status).toBe(400);
    expect(await doublePick.json()).toMatchObject({ error: { code: "validation_failed" } });
    expect(await storedResponse(ziad.participantId)).toEqual(beforeDouble);
    expect(await answeredCount(plan.id)).toBe(0);

    // Every window, a stored start and one pick per step: complete.
    const done = await responsePut(plan.id, full, { cookie: nour.cookie });
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({
      complete: true,
      first_completion: true,
      plan_state: "collecting",
    });
    expect((await storedResponse(nour.participantId)).response?.complete).toBe(true);
    expect(await answeredCount(plan.id)).toBe(1);
  });

  it("T-001-95/AC-1 T-001-20/AC-4 start_place_id is resolved with Place Details; the server stores place id, name, latitude and longitude; JSON carries the start name only; a Details failure is 503 upstream and writes nothing", async () => {
    const organizer = await register(track(uniqueEmail("org")), "Omar");
    const member = await register(track(uniqueEmail("member")), "Nour");
    const newcomer = await register(track(uniqueEmail("newcomer")), "Hana");
    const plan = await openPlan(organizer.token);
    const participantId = await seedAccountParticipant(plan.id, member.account.id, "Nour");
    const newcomerId = await seedAccountParticipant(
      plan.id,
      newcomer.account.id,
      "Hana",
      "k7m2",
    );
    const shape = await planShape(plan.id);
    const cookie = `hp_session=${member.token}`;

    const captured: { url: string; method: string | undefined; fieldMask: string | null }[] = [];
    setGoogleClientOptions({
      apiKey: "details-key",
      fetch: async (input, init) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        captured.push({
          url,
          method: init?.method,
          fieldMask: new Headers(init?.headers).get("X-Goog-FieldMask"),
        });
        return jsonResponse(startCafe);
      },
    });

    const saved = await responsePut(plan.id, completeBody(shape), { cookie });
    expect(saved.status).toBe(200);
    const savedJson = JSON.stringify(await saved.json());
    expect(captured).toHaveLength(1);
    expect(new URL(captured[0]!.url).pathname).toBe("/v1/places/ChIJ-start");
    expect(captured[0]!.method).toBe("GET");
    expect(captured[0]!.fieldMask).toBe(START_DETAILS_FIELD_MASK);

    const stored = await storedResponse(participantId);
    expect(stored.response).toEqual({
      complete: true,
      start_google_place_id: "ChIJ-start",
      start_name: "Maadi, Cairo",
      start_lat: 29.96,
      start_lng: 31.25,
    });

    const got = await responseGet(plan.id, cookie);
    expect(got.status).toBe(200);
    const body = (await got.json()) as GetBody;
    expect(body.response.start).toEqual({ name: "Maadi, Cairo" });
    for (const json of [JSON.stringify(body), savedJson]) {
      expect(json).not.toContain("ChIJ-start");
      expect(json).not.toContain("29.96");
      expect(json).not.toContain("31.25");
      expect(json).not.toContain("start_lat");
      expect(json).not.toContain("start_lng");
      expect(json).not.toContain("latitude");
      expect(json).not.toContain("longitude");
      expect(json).not.toContain("google_place_id");
    }

    setGoogleClientOptions({
      apiKey: "details-key",
      fetch: async () => jsonResponse({ error: "nope" }, 500),
    });
    const changed = completeBody(shape, "ChIJ-fail");
    changed.picks[0] = {
      step_id: shape.steps[0]!.id,
      option_id: optionFor(shape, shape.steps[0]!.id, "Grills"),
    };
    const failed = await responsePut(plan.id, changed, { cookie });
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({
      error: { code: "upstream", message: "places upstream failed", fields: [] },
    });
    expect(await storedResponse(participantId)).toEqual(stored);

    const firstFail = await responsePut(plan.id, completeBody(shape, "ChIJ-fail"), {
      cookie: `hp_session=${newcomer.token}`,
    });
    expect(firstFail.status).toBe(503);
    expect(await firstFail.json()).toMatchObject({ error: { code: "upstream" } });
    expect(await storedResponse(newcomerId)).toEqual({ response: null, windows: [], picks: [] });
    expect(await answeredCount(plan.id)).toBe(1);
  });

  it("T-001-95/AC-1 T-001-20/AC-5 GET and PUT give 409 responses_closed while proposed and 409 plan_locked while locked; the payload omits count, threshold, other participants and their starts; title, labels and start name come back as stored", async () => {
    const organizer = await register(track(uniqueEmail("org")), "Omar");
    const member = await register(track(uniqueEmail("member")), "Nour");
    const other = await register(track(uniqueEmail("other")), "Hana");
    const title = "Late Dinner — عشاء  & Co.";
    const plan = await openPlan(organizer.token, {
      title,
      steps: [
        { name: "Dinner", options: ["Koshary (Tahrir)", "Grills & Co"] },
        { name: "Coffee", options: ["Turkish — تركي", "Filter V60"] },
      ],
    });
    const participantId = await seedAccountParticipant(plan.id, member.account.id, "Nour");
    const otherId = await seedAccountParticipant(plan.id, other.account.id, "Hana", "k7m2");
    await sql`
      INSERT INTO responses (
        participant_id, start_google_place_id, start_name, start_lat, start_lng, complete
      ) VALUES (${otherId}, 'ChIJ-secret', 'Secret Dock', 1.23, 4.56, false)
    `;
    const shape = await planShape(plan.id);
    const cookie = `hp_session=${member.token}`;
    const quirkyStart = { ...startCafe, displayName: { text: "  Maadi — المعادي, Cairo " } };
    setGoogleClientOptions({ apiKey: "test-places-key", fetch: detailsFetch(quirkyStart) });
    const body = {
      windows: [
        { window_id: shape.windows[0]!.id, kind: "busy" },
        {
          window_id: shape.windows[1]!.id,
          kind: "free",
          earliest_local: "10:30",
          latest_local: "13:00",
        },
      ],
      start_place_id: startCafe.id,
      picks: [
        {
          step_id: shape.steps[0]!.id,
          option_id: optionFor(shape, shape.steps[0]!.id, "Koshary (Tahrir)"),
        },
        {
          step_id: shape.steps[1]!.id,
          option_id: optionFor(shape, shape.steps[1]!.id, "Turkish — تركي"),
        },
      ],
    };
    const saved = await responsePut(plan.id, body, { cookie });
    expect(saved.status).toBe(200);

    const open = await responseGet(plan.id, cookie);
    expect(open.status).toBe(200);
    const view = (await open.json()) as GetBody;
    expect(view.title).toBe(title);
    expect(view.steps.map((step) => step.options.map((option) => option.label))).toEqual([
      ["Koshary (Tahrir)", "Grills & Co"],
      ["Turkish — تركي", "Filter V60"],
    ]);
    const storedName = (await storedResponse(participantId)).response?.start_name;
    expect(view.response.start).toEqual({ name: storedName });
    expect(storedName).toContain("Maadi — المعادي, Cairo");
    expect(view).not.toHaveProperty("answered_count");
    expect(view).not.toHaveProperty("threshold");
    expect(view).not.toHaveProperty("participants");
    const json = JSON.stringify(view);
    for (const hidden of [
      "answered_count",
      "threshold",
      "participants",
      "Hana",
      otherId,
      "Secret Dock",
      "ChIJ-secret",
      "1.23",
      "4.56",
    ]) {
      expect(json).not.toContain(hidden);
    }

    const before = await storedResponse(participantId);
    const changed = { ...body, windows: [{ window_id: shape.windows[0]!.id, kind: "busy" }, body.windows[1]!] };
    for (const [state, reason] of [
      ["proposed", "responses_closed"],
      ["locked", "plan_locked"],
    ] as const) {
      if (state === "locked") {
        await sql`UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${plan.id}`;
      } else {
        await sql`UPDATE plans SET state = 'proposed' WHERE id = ${plan.id}`;
      }
      const read = await responseGet(plan.id, cookie);
      expect(read.status, state).toBe(409);
      expect(await read.json(), state).toEqual({
        error: { code: "conflict", reason, message: expect.any(String), fields: [] },
      });
      const write = await responsePut(plan.id, changed, { cookie });
      expect(write.status, state).toBe(409);
      expect(await write.json(), state).toEqual({
        error: { code: "conflict", reason, message: expect.any(String), fields: [] },
      });
      expect(await storedResponse(participantId), state).toEqual(before);
      expect(await answeredCount(plan.id), state).toBe(1);
    }
  });

  it("T-001-95/AC-1 T-001-20/AC-8 a stranger gets 404 with the envelope only; a PUT without X-HP-Request: 1 is 403 csrf and writes nothing; the handler runs on Postgres with the fake Google client only", async () => {
    const networkCalls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      networkCalls.push(String(input));
      throw new Error(`unit tests must not call the network: ${String(input)}`);
    });
    const fakeCalls: string[] = [];
    setGoogleClientOptions({
      apiKey: "test-places-key",
      fetch: async (input) => {
        fakeCalls.push(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        );
        return jsonResponse(startCafe);
      },
    });
    const organizer = await register(track(uniqueEmail("org")), "Omar");
    const member = await register(track(uniqueEmail("member")), "Nour");
    const stranger = await register(track(uniqueEmail("stranger")), "Ziad");
    const plan = await openPlan(organizer.token, { title: "Thursday in Maadi" });
    const participantId = await seedAccountParticipant(plan.id, member.account.id, "Nour");
    const shape = await planShape(plan.id);
    const strangerCookie = `hp_session=${stranger.token}`;

    const expectEnvelopeOnly = async (response: Response) => {
      expect(response.status).toBe(404);
      const envelope = (await response.json()) as { error: Record<string, unknown> };
      expect(envelope).toEqual({
        error: { code: "not_found", message: "plan not found", fields: [] },
      });
      expect(Object.keys(envelope)).toEqual(["error"]);
      const json = JSON.stringify(envelope);
      for (const leak of ["Thursday in Maadi", "Nour", "Omar", "Koshary", "Dinner", plan.id]) {
        expect(json).not.toContain(leak);
      }
    };
    await expectEnvelopeOnly(await responseGet(plan.id, strangerCookie));
    await expectEnvelopeOnly(
      await responsePut(plan.id, completeBody(shape), { cookie: strangerCookie }),
    );
    const strangerRows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM participants
      WHERE plan_id = ${plan.id} AND account_id = ${stranger.account.id}
    `;
    expect(strangerRows[0]?.n).toBe(0);

    const csrf = await responsePut(plan.id, completeBody(shape), {
      cookie: `hp_session=${member.token}`,
      csrf: false,
    });
    expect(csrf.status).toBe(403);
    expect(await csrf.json()).toEqual({
      error: { code: "forbidden", reason: "csrf", message: "missing X-HP-Request", fields: [] },
    });
    expect(await storedResponse(participantId)).toEqual({ response: null, windows: [], picks: [] });
    expect(await answeredCount(plan.id)).toBe(0);
    expect(fakeCalls).toEqual([]);

    // The same body with the header is served by the fake Details client and lands in Postgres.
    const saved = await responsePut(plan.id, completeBody(shape), {
      cookie: `hp_session=${member.token}`,
    });
    expect(saved.status).toBe(200);
    expect(fakeCalls).toHaveLength(1);
    expect((await storedResponse(participantId)).response).toMatchObject({
      complete: true,
      start_google_place_id: "ChIJ-start",
    });
    expect(await answeredCount(plan.id)).toBe(1);
    expect(networkCalls).toEqual([]);
  });
});

type StoredResponse = {
  response: {
    complete: boolean;
    start_google_place_id: string | null;
    start_name: string | null;
    start_lat: number | null;
    start_lng: number | null;
  } | null;
  windows: {
    window_id: string;
    kind: string;
    earliest_local: string | null;
    latest_local: string | null;
  }[];
  picks: { step_id: string; option_id: string }[];
};

/** Everything stored for one participant's response, in a stable order. */
async function storedResponse(participantId: string): Promise<StoredResponse> {
  const response = await sql<NonNullable<StoredResponse["response"]>[]>`
    SELECT complete, start_google_place_id, start_name, start_lat, start_lng
    FROM responses WHERE participant_id = ${participantId}
  `;
  const windows = await sql<StoredResponse["windows"]>`
    SELECT window_id, kind, earliest_local, latest_local
    FROM response_windows WHERE participant_id = ${participantId}
    ORDER BY window_id
  `;
  const picks = await sql<StoredResponse["picks"]>`
    SELECT step_id, option_id FROM response_picks
    WHERE participant_id = ${participantId}
    ORDER BY step_id
  `;
  return {
    response: response[0] ? { ...response[0] } : null,
    windows: windows.map((row) => ({ ...row })),
    picks: picks.map((row) => ({ ...row })),
  };
}

const DINNER_A = {
  id: "ChIJ-dinner-a",
  name: "Abu Tarek",
  lat: 30.01,
  lng: 31.235,
  units: 120,
};
const DINNER_B = {
  id: "ChIJ-dinner-b",
  name: "Koshary El Tahrir",
  lat: 30.012,
  lng: 31.236,
  units: 90,
};
const COFFEE_A = {
  id: "ChIJ-coffee-a",
  name: "Cilantro",
  lat: 30.02,
  lng: 31.24,
  units: 40,
};
const COFFEE_B = {
  id: "ChIJ-coffee-b",
  name: "Filter Room",
  lat: 30.021,
  lng: 31.241,
  units: 35,
};

function venuePlace(place: {
  id: string;
  name: string;
  lat: number;
  lng: number;
  units: number;
}) {
  return {
    id: place.id,
    displayName: { text: place.name },
    location: { latitude: place.lat, longitude: place.lng },
    priceRange: {
      startPrice: { currencyCode: "EGP", units: place.units, nanos: 0 },
    },
  };
}

function waypointLatLng(value: unknown): { latitude: number; longitude: number } | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const latLng = (
    (value as { waypoint?: { location?: { latLng?: unknown } } }).waypoint
      ?.location as { latLng?: { latitude?: unknown; longitude?: unknown } } | undefined
  )?.latLng;
  if (
    latLng === undefined ||
    typeof latLng.latitude !== "number" ||
    typeof latLng.longitude !== "number"
  ) {
    return null;
  }
  return { latitude: latLng.latitude, longitude: latLng.longitude };
}

function attemptGoogleFetch(captured: string[]): FetchFn {
  const byQuery: Record<string, unknown[]> = {
    Koshary: [venuePlace(DINNER_A), venuePlace(DINNER_B)],
    Turkish: [venuePlace(COFFEE_A), venuePlace(COFFEE_B)],
  };
  return async (request, init) => {
    const url =
      typeof request === "string"
        ? request
        : request instanceof URL
          ? request.href
          : request.url;
    captured.push(url);
    if (url === PLACES_SEARCH_TEXT_URL) {
      const body =
        init?.body === undefined
          ? {}
          : (JSON.parse(String(init.body)) as { textQuery?: string });
      return jsonResponse({ places: byQuery[body.textQuery ?? ""] ?? [] });
    }
    if (url === ROUTES_MATRIX_URL) {
      const body =
        init?.body === undefined
          ? { origins: [], destinations: [] }
          : (JSON.parse(String(init.body)) as {
              origins?: unknown[];
              destinations?: unknown[];
            });
      const origins = (body.origins ?? []).map(waypointLatLng);
      const destinations = (body.destinations ?? []).map(waypointLatLng);
      const elements: unknown[] = [];
      for (let i = 0; i < origins.length; i += 1) {
        for (let j = 0; j < destinations.length; j += 1) {
          elements.push({
            originIndex: i,
            destinationIndex: j,
            status: { code: 0 },
            condition: "ROUTE_EXISTS",
            duration: "180s",
          });
        }
      }
      return jsonResponse(elements);
    }
    throw new Error(`unexpected Google URL: ${url}`);
  };
}

function expectNoLiveGoogle(urls: readonly string[]): void {
  expect(
    urls.every(
      (url) => url === PLACES_SEARCH_TEXT_URL || url === ROUTES_MATRIX_URL,
    ),
  ).toBe(true);
}

async function seedHourRuns(planId: string, count: number, startedAt: Date): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await sql`
      INSERT INTO proposal_runs (
        id, plan_id, started_at, outcome, block_time, block_budget, block_venue_data
      ) VALUES (
        ${`prn_${randomBytes(16).toString("hex")}`},
        ${planId},
        ${startedAt},
        'blocked',
        false,
        false,
        true
      )
    `;
  }
}

async function runCount(planId: string): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM proposal_runs WHERE plan_id = ${planId}
  `;
  return Number(rows[0]?.count ?? 0);
}

describe("PUT /v1/plans/{planId}/response attempt trigger", () => {
  it("runs an attempt after a first completion that meets the threshold and returns the resulting plan_state; a save while blocked does not run an attempt", async () => {
    const organizer = await register(track(uniqueEmail("org")), "Omar");
    const member = await register(track(uniqueEmail("member")), "Nour");
    const plan = await openPlan(organizer.token, { threshold: 1 });
    await seedAccountParticipant(plan.id, member.account.id, "Nour");
    const shape = await planShape(plan.id);
    const cookie = `hp_session=${member.token}`;
    const captured: string[] = [];
    setProposalAttemptGoogleOptions({
      apiKey: "test-places-key",
      fetch: attemptGoogleFetch(captured),
    });

    const first = await responsePut(plan.id, completeBody(shape), { cookie });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      complete: true,
      first_completion: true,
      plan_state: "proposed",
    });
    expect(await answeredCount(plan.id)).toBe(1);
    expect(await planState(plan.id)).toBe("proposed");
    expect(captured.length).toBeGreaterThan(0);
    expectNoLiveGoogle(captured);
    expect(await runCount(plan.id)).toBe(1);

    await sql`UPDATE plans SET state = 'blocked' WHERE id = ${plan.id}`;
    const beforeRuns = await runCount(plan.id);
    captured.length = 0;
    const blocked = await responsePut(plan.id, completeBody(shape), { cookie });
    expect(blocked.status).toBe(200);
    expect(await blocked.json()).toEqual({
      complete: true,
      first_completion: false,
      plan_state: "blocked",
    });
    expect(await planState(plan.id)).toBe("blocked");
    expect(await answeredCount(plan.id)).toBe(1);
    expect(captured).toEqual([]);
    expect(await runCount(plan.id)).toBe(beforeRuns);
  });

  it("returns 409 attempt_in_progress for a lock younger than 20s after the completion has committed, and takes over a lock older than 20s", async () => {
    const organizer = await register(track(uniqueEmail("lock")), "Omar");
    const youngMember = await register(track(uniqueEmail("young")), "Nour");
    const oldMember = await register(track(uniqueEmail("old")), "Hana");
    const youngPlan = await openPlan(organizer.token, { threshold: 1 });
    const oldPlan = await openPlan(organizer.token, { threshold: 1 });
    await seedAccountParticipant(youngPlan.id, youngMember.account.id, "Nour");
    await seedAccountParticipant(oldPlan.id, oldMember.account.id, "Hana", "k7m2");
    const youngShape = await planShape(youngPlan.id);
    const oldShape = await planShape(oldPlan.id);
    const frozen = new Date("2026-09-26T12:00:00.000Z");
    setClock(frozen);
    await sql`
      UPDATE plans
      SET attempt_lock = true, attempt_lock_at = ${frozen}
      WHERE id = ${youngPlan.id}
    `;
    const captured: string[] = [];
    setProposalAttemptGoogleOptions({
      apiKey: "test-places-key",
      fetch: attemptGoogleFetch(captured),
    });

    const young = await responsePut(
      youngPlan.id,
      completeBody(youngShape),
      { cookie: `hp_session=${youngMember.token}` },
    );
    expect(young.status).toBe(409);
    expect(await young.json()).toEqual({
      error: {
        code: "conflict",
        reason: "attempt_in_progress",
        message: "a proposal attempt is already in progress",
        fields: [],
      },
    });
    expect(await answeredCount(youngPlan.id)).toBe(1);
    expect(await planState(youngPlan.id)).toBe("collecting");
    expect(captured).toEqual([]);

    await sql`
      UPDATE plans
      SET attempt_lock = true, attempt_lock_at = ${frozen}
      WHERE id = ${oldPlan.id}
    `;
    setClock(new Date(frozen.getTime() + ATTEMPT_LOCK_MS + 1));
    const takeover = await responsePut(
      oldPlan.id,
      completeBody(oldShape),
      { cookie: `hp_session=${oldMember.token}` },
    );
    expect(takeover.status).toBe(200);
    expect(await takeover.json()).toEqual({
      complete: true,
      first_completion: true,
      plan_state: "proposed",
    });
    expect(await planState(oldPlan.id)).toBe("proposed");
    expectNoLiveGoogle(captured);
    const lock = await sql<{ attempt_lock: boolean }[]>`
      SELECT attempt_lock FROM plans WHERE id = ${oldPlan.id}
    `;
    expect(lock[0]?.attempt_lock).toBe(false);
  });

  it("does not call Google when the hour is full, finishes as venue_data, and still returns 200 for the committed completion", async () => {
    const organizer = await register(track(uniqueEmail("cap")), "Omar");
    const member = await register(track(uniqueEmail("member")), "Nour");
    const plan = await openPlan(organizer.token, { threshold: 1 });
    await seedAccountParticipant(plan.id, member.account.id, "Nour");
    const shape = await planShape(plan.id);
    const cookie = `hp_session=${member.token}`;
    const captured: string[] = [];
    setProposalAttemptGoogleOptions({
      apiKey: "test-places-key",
      fetch: attemptGoogleFetch(captured),
    });
    await seedHourRuns(plan.id, PROPOSAL_ATTEMPT_HOUR_CAP, new Date());

    const first = await responsePut(plan.id, completeBody(shape), { cookie });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      complete: true,
      first_completion: true,
      plan_state: "blocked",
    });
    expect(await answeredCount(plan.id)).toBe(1);
    expect(await planState(plan.id)).toBe("blocked");
    expect(captured).toEqual([]);
    expect(await runCount(plan.id)).toBe(PROPOSAL_ATTEMPT_HOUR_CAP + 1);
    const latest = await sql<
      {
        outcome: string;
        block_time: boolean;
        block_budget: boolean;
        block_venue_data: boolean;
      }[]
    >`
      SELECT outcome, block_time, block_budget, block_venue_data
      FROM proposal_runs
      WHERE plan_id = ${plan.id}
      ORDER BY started_at DESC, id DESC
      LIMIT 1
    `;
    expect(latest[0]).toEqual({
      outcome: "blocked",
      block_time: false,
      block_budget: false,
      block_venue_data: true,
    });
  });

  // T-001-24 names /v1/...; the route is /api/v1/... (ADR-0003). This handler serves that path.
  it("T-001-95/AC-5 T-001-24/AC-6 HP_PROPOSAL_ENABLED=0 records venue_data and does not call Google", async () => {
    const organizer = await register(track(uniqueEmail("flag")), "Omar");
    const member = await register(track(uniqueEmail("member")), "Nour");
    const plan = await openPlan(organizer.token, { threshold: 1 });
    await seedAccountParticipant(plan.id, member.account.id, "Nour");
    const shape = await planShape(plan.id);
    const cookie = `hp_session=${member.token}`;
    process.env.HP_PROPOSAL_ENABLED = "0";
    const captured: string[] = [];
    setProposalAttemptGoogleOptions({
      apiKey: "test-places-key",
      fetch: attemptGoogleFetch(captured),
    });

    const first = await responsePut(plan.id, completeBody(shape), { cookie });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      complete: true,
      first_completion: true,
      plan_state: "blocked",
    });
    expect(captured).toEqual([]);
    const runs = await sql<
      {
        outcome: string;
        block_time: boolean;
        block_budget: boolean;
        block_venue_data: boolean;
      }[]
    >`
      SELECT outcome, block_time, block_budget, block_venue_data
      FROM proposal_runs WHERE plan_id = ${plan.id}
    `;
    expect(runs).toEqual([
      {
        outcome: "blocked",
        block_time: false,
        block_budget: false,
        block_venue_data: true,
      },
    ]);
  });

  // T-001-24 names /v1/...; the route is /api/v1/... (ADR-0003), so these tests send /api/v1 paths.
  it("T-001-95/AC-5 T-001-24/AC-1 PUT response runs an attempt only after a first completion commits and makes answered_count equal the threshold, then returns the resulting plan_state; a save while blocked does not run an attempt", async () => {
    const organizer = await register(track(uniqueEmail("org")), "Omar");
    const nour = await register(track(uniqueEmail("nour")), "Nour");
    const hana = await register(track(uniqueEmail("hana")), "Hana");
    const ziad = await register(track(uniqueEmail("ziad")), "Ziad");
    const plan = await openPlan(organizer.token, { threshold: 2 });
    const nourId = await seedAccountParticipant(plan.id, nour.account.id, "Nour", "a3k9");
    const hanaId = await seedAccountParticipant(plan.id, hana.account.id, "Hana", "k7m2");
    await seedAccountParticipant(plan.id, ziad.account.id, "Ziad", "z9q1");
    const shape = await planShape(plan.id);
    const captured: string[] = [];
    setProposalAttemptGoogleOptions({
      apiKey: "test-places-key",
      fetch: attemptGoogleFetch(captured),
    });
    const put = (cookie: string, body: unknown) =>
      PUT(jsonRequest(`/api/v1/plans/${plan.id}/response`, "PUT", body, { cookie }), {
        params: Promise.resolve({ planId: plan.id }),
      });

    // An incomplete save: no attempt.
    const draft = await put(`hp_session=${nour.token}`, {
      windows: [{ window_id: shape.windows[0]!.id, kind: "busy" }],
    });
    expect(draft.status).toBe(200);
    expect(await draft.json()).toEqual({
      complete: false,
      first_completion: false,
      plan_state: "collecting",
    });
    expect(await runCount(plan.id)).toBe(0);

    // A first completion that leaves the count below the threshold: no attempt.
    const firstBelow = await put(`hp_session=${nour.token}`, completeBody(shape));
    expect(await firstBelow.json()).toEqual({
      complete: true,
      first_completion: true,
      plan_state: "collecting",
    });
    expect(await answeredCount(plan.id)).toBe(1);
    expect(await runCount(plan.id)).toBe(0);

    // Editing an already complete response is not a first completion: no attempt.
    const edit = await put(`hp_session=${nour.token}`, completeBody(shape));
    expect(await edit.json()).toEqual({
      complete: true,
      first_completion: false,
      plan_state: "collecting",
    });
    expect(await runCount(plan.id)).toBe(0);
    expect(captured).toEqual([]);

    // The first completion that makes answered_count equal the threshold runs one attempt.
    const meets = await put(`hp_session=${hana.token}`, completeBody(shape));
    expect(meets.status).toBe(200);
    expect(await meets.json()).toEqual({
      complete: true,
      first_completion: true,
      plan_state: "proposed",
    });
    expect(await answeredCount(plan.id)).toBe(2);
    expect(await planState(plan.id)).toBe("proposed");
    expect(await runCount(plan.id)).toBe(1);
    expect(captured.length).toBeGreaterThan(0);
    expectNoLiveGoogle(captured);
    // The attempt saw the committed completion: the completing member is in the cohort.
    const cohort = await sql<{ participant_id: string }[]>`
      SELECT participant_id FROM proposal_cohort
      WHERE proposal_id IN (SELECT id FROM proposals WHERE plan_id = ${plan.id})
      ORDER BY participant_id
    `;
    expect(cohort.map((row) => row.participant_id)).toEqual([nourId, hanaId].sort());

    // While blocked, even a first completion that lands on the threshold runs no attempt.
    await sql`UPDATE plans SET state = 'blocked', threshold = 3 WHERE id = ${plan.id}`;
    captured.length = 0;
    const blocked = await put(`hp_session=${ziad.token}`, completeBody(shape));
    expect(blocked.status).toBe(200);
    expect(await blocked.json()).toEqual({
      complete: true,
      first_completion: true,
      plan_state: "blocked",
    });
    expect(await answeredCount(plan.id)).toBe(3);
    expect(await planState(plan.id)).toBe("blocked");
    expect(await runCount(plan.id)).toBe(1);
    expect(captured).toEqual([]);
  });

  it("T-001-95/AC-5 T-001-24/AC-4 the run locks the plan row; a lock younger than 20 seconds returns 409 attempt_in_progress after the triggering write has committed; a lock older than 20 seconds is taken over", async () => {
    const organizer = await register(track(uniqueEmail("lock")), "Omar");
    const youngMember = await register(track(uniqueEmail("young")), "Nour");
    const oldMember = await register(track(uniqueEmail("old")), "Hana");
    const youngPlan = await openPlan(organizer.token, { threshold: 1 });
    const oldPlan = await openPlan(organizer.token, { threshold: 1 });
    const youngId = await seedAccountParticipant(youngPlan.id, youngMember.account.id, "Nour");
    await seedAccountParticipant(oldPlan.id, oldMember.account.id, "Hana", "k7m2");
    const youngShape = await planShape(youngPlan.id);
    const oldShape = await planShape(oldPlan.id);
    const frozen = new Date("2026-09-26T12:00:00.000Z");
    setClock(frozen);
    // A lock taken 19.999 seconds ago is younger than 20 seconds.
    await sql`
      UPDATE plans
      SET attempt_lock = true, attempt_lock_at = ${new Date(frozen.getTime() - ATTEMPT_LOCK_MS + 1)}
      WHERE id = ${youngPlan.id}
    `;
    const captured: string[] = [];
    const lockSeen: boolean[] = [];
    const fake = attemptGoogleFetch(captured);
    setProposalAttemptGoogleOptions({
      apiKey: "test-places-key",
      fetch: async (request, init) => {
        // Observe the plan row while the run is calling Google.
        const rows = await sql<{ attempt_lock: boolean }[]>`
          SELECT attempt_lock FROM plans WHERE id = ${oldPlan.id}
        `;
        lockSeen.push(rows[0]?.attempt_lock ?? false);
        return fake(request, init);
      },
    });

    const young = await PUT(
      jsonRequest(`/api/v1/plans/${youngPlan.id}/response`, "PUT", completeBody(youngShape), {
        cookie: `hp_session=${youngMember.token}`,
      }),
      { params: Promise.resolve({ planId: youngPlan.id }) },
    );
    expect(young.status).toBe(409);
    expect(await young.json()).toEqual({
      error: {
        code: "conflict",
        reason: "attempt_in_progress",
        message: "a proposal attempt is already in progress",
        fields: [],
      },
    });
    // The triggering write committed before the 409.
    expect(await answeredCount(youngPlan.id)).toBe(1);
    expect((await storedResponse(youngId)).response).toMatchObject({
      complete: true,
      start_google_place_id: startCafe.id,
    });
    expect(await planState(youngPlan.id)).toBe("collecting");
    expect(await runCount(youngPlan.id)).toBe(0);
    expect(captured).toEqual([]);

    // A lock taken 20.001 seconds ago is older than 20 seconds and is taken over.
    await sql`
      UPDATE plans
      SET attempt_lock = true, attempt_lock_at = ${new Date(frozen.getTime() - ATTEMPT_LOCK_MS - 1)}
      WHERE id = ${oldPlan.id}
    `;
    const takeover = await PUT(
      jsonRequest(`/api/v1/plans/${oldPlan.id}/response`, "PUT", completeBody(oldShape), {
        cookie: `hp_session=${oldMember.token}`,
      }),
      { params: Promise.resolve({ planId: oldPlan.id }) },
    );
    expect(takeover.status).toBe(200);
    expect(await takeover.json()).toEqual({
      complete: true,
      first_completion: true,
      plan_state: "proposed",
    });
    expect(await planState(oldPlan.id)).toBe("proposed");
    expect(await runCount(oldPlan.id)).toBe(1);
    expectNoLiveGoogle(captured);
    // While the run worked, the plan row held its lock; it is released when the run ends.
    expect(lockSeen.length).toBeGreaterThan(0);
    expect(lockSeen.every(Boolean)).toBe(true);
    const lock = await sql<{ attempt_lock: boolean }[]>`
      SELECT attempt_lock FROM plans WHERE id = ${oldPlan.id}
    `;
    expect(lock[0]?.attempt_lock).toBe(false);
  });

  it("T-001-95/AC-5 T-001-24/AC-5 the attempts route returns 429 after 20 runs per plan per rolling hour and does not change the plan; a completion or budget raise that finds the hour full does not call Google, finishes as venue_data, and still returns 200 for the committed write", async () => {
    const organizer = await register(track(uniqueEmail("cap")), "Omar");
    const member = await register(track(uniqueEmail("member")), "Nour");
    const plan = await openPlan(organizer.token, { threshold: 1 });
    const participantId = await seedAccountParticipant(plan.id, member.account.id, "Nour");
    const shape = await planShape(plan.id);
    const orgCookie = `hp_session=${organizer.token}`;
    const frozen = new Date();
    setClock(frozen);
    const captured: string[] = [];
    setProposalAttemptGoogleOptions({
      apiKey: "test-places-key",
      fetch: attemptGoogleFetch(captured),
    });
    await seedHourRuns(plan.id, PROPOSAL_ATTEMPT_HOUR_CAP, new Date(frozen.getTime() - 59 * 60_000));
    const latestRun = async () =>
      (
        await sql<
          { outcome: string; block_time: boolean; block_budget: boolean; block_venue_data: boolean }[]
        >`
          SELECT outcome, block_time, block_budget, block_venue_data
          FROM proposal_runs WHERE plan_id = ${plan.id}
          ORDER BY started_at DESC, id DESC LIMIT 1
        `
      )[0];
    const planRow = async () =>
      (
        await sql<
          { state: string; budget_amount_minor: number; threshold: number; answered_count: number; updated_at: Date }[]
        >`
          SELECT state, budget_amount_minor, threshold, answered_count, updated_at
          FROM plans WHERE id = ${plan.id}
        `
      )[0];
    const attempt = () =>
      postAttemptRoute(
        jsonRequest(`/api/v1/plans/${plan.id}/proposal-attempts`, "POST", {}, { cookie: orgCookie }),
        { params: Promise.resolve({ planId: plan.id }) },
      );

    // A completion that finds the hour full: 200 for the committed write, venue_data, no Google.
    const completed = await PUT(
      jsonRequest(`/api/v1/plans/${plan.id}/response`, "PUT", completeBody(shape), {
        cookie: `hp_session=${member.token}`,
      }),
      { params: Promise.resolve({ planId: plan.id }) },
    );
    expect(completed.status).toBe(200);
    expect(await completed.json()).toEqual({
      complete: true,
      first_completion: true,
      plan_state: "blocked",
    });
    expect(await answeredCount(plan.id)).toBe(1);
    expect((await storedResponse(participantId)).response?.complete).toBe(true);
    expect(captured).toEqual([]);
    expect(await runCount(plan.id)).toBe(PROPOSAL_ATTEMPT_HOUR_CAP + 1);
    expect(await latestRun()).toEqual({
      outcome: "blocked",
      block_time: false,
      block_budget: false,
      block_venue_data: true,
    });

    // The attempts route with the hour full: 429 and the plan does not change.
    const before = await planRow();
    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      error: { code: "rate_limited", message: "too many proposal attempts", fields: [] },
    });
    expect(await planRow()).toEqual(before);
    expect(await runCount(plan.id)).toBe(PROPOSAL_ATTEMPT_HOUR_CAP + 1);
    expect(await sql`SELECT id FROM proposals WHERE plan_id = ${plan.id}`).toHaveLength(0);
    expect(captured).toEqual([]);

    // A budget raise while blocked that finds the hour full: 200 for the committed write, venue_data, no Google.
    const raised = await patchPlanRoute(
      jsonRequest(
        `/api/v1/plans/${plan.id}`,
        "PATCH",
        { budget: { amount_minor: 90_000, currency: "EGP" } },
        { cookie: orgCookie },
      ),
      { params: Promise.resolve({ planId: plan.id }) },
    );
    expect(raised.status).toBe(200);
    const raisedBody = (await raised.json()) as {
      state: string;
      budget: { amount_minor: number; currency: string };
    };
    expect(raisedBody.budget).toEqual({ amount_minor: 90_000, currency: "EGP" });
    expect(raisedBody.state).toBe("blocked");
    expect(Number((await planRow())?.budget_amount_minor)).toBe(90_000);
    expect(captured).toEqual([]);
    expect(await runCount(plan.id)).toBe(PROPOSAL_ATTEMPT_HOUR_CAP + 2);
    expect(await latestRun()).toEqual({
      outcome: "blocked",
      block_time: false,
      block_budget: false,
      block_venue_data: true,
    });

    // The hour is rolling: once every counted run is older than an hour, the route runs again.
    setClock(new Date(frozen.getTime() + 61 * 60_000));
    const rolled = await attempt();
    expect(rolled.status).toBe(200);
    expect(((await rolled.json()) as { state: string }).state).toBe("proposed");
    expect(captured.length).toBeGreaterThan(0);
    expectNoLiveGoogle(captured);
  });

  it("T-001-95/AC-5 T-001-24/AC-8 handler tests use Postgres and the fake Google clients, and keep plan validation, response counting, and the no-write-on-invalid rules", async () => {
    const networkCalls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      networkCalls.push(String(input));
      throw new Error(`unit tests must not call the network: ${String(input)}`);
    });
    const organizer = await register(track(uniqueEmail("org")), "Omar");
    const nour = await register(track(uniqueEmail("nour")), "Nour");
    const hana = await register(track(uniqueEmail("hana")), "Hana");
    const plan = await openPlan(organizer.token, { threshold: 3 });
    const nourId = await seedAccountParticipant(plan.id, nour.account.id, "Nour", "a3k9");
    await seedAccountParticipant(plan.id, hana.account.id, "Hana", "k7m2");
    const shape = await planShape(plan.id);
    const orgCookie = `hp_session=${organizer.token}`;
    const captured: string[] = [];
    setProposalAttemptGoogleOptions({
      apiKey: "test-places-key",
      fetch: attemptGoogleFetch(captured),
    });
    const patch = (body: unknown) =>
      patchPlanRoute(jsonRequest(`/api/v1/plans/${plan.id}`, "PATCH", body, { cookie: orgCookie }), {
        params: Promise.resolve({ planId: plan.id }),
      });
    const put = (cookie: string, body: unknown) =>
      PUT(jsonRequest(`/api/v1/plans/${plan.id}/response`, "PUT", body, { cookie }), {
        params: Promise.resolve({ planId: plan.id }),
      });
    const thresholdNow = async () =>
      Number(
        (await sql<{ threshold: number }[]>`SELECT threshold FROM plans WHERE id = ${plan.id}`)[0]
          ?.threshold,
      );

    // Plan validation still holds: an invalid patch is 400, writes nothing, runs nothing.
    const invalidPatch = await patch({ title: "", threshold: 2 });
    expect(invalidPatch.status).toBe(400);
    expect(await invalidPatch.json()).toMatchObject({
      error: { code: "validation_failed", fields: [{ path: "title" }] },
    });
    expect(await thresholdNow()).toBe(3);
    expect(await planState(plan.id)).toBe("collecting");
    expect(await runCount(plan.id)).toBe(0);

    // No write on an invalid response.
    const invalidPut = await put(`hp_session=${nour.token}`, {
      ...completeBody(shape),
      windows: [
        {
          window_id: shape.windows[0]!.id,
          kind: "free",
          earliest_local: "17:00",
          latest_local: "22:00",
        },
        completeBody(shape).windows[1]!,
      ],
    });
    expect(invalidPut.status).toBe(400);
    expect(await storedResponse(nourId)).toEqual({ response: null, windows: [], picks: [] });
    expect(await answeredCount(plan.id)).toBe(0);

    // Response counting still holds: first completions count once each, an edit does not.
    expect((await (await put(`hp_session=${nour.token}`, completeBody(shape))).json())).toMatchObject({
      first_completion: true,
    });
    expect(await answeredCount(plan.id)).toBe(1);
    expect((await (await put(`hp_session=${nour.token}`, completeBody(shape))).json())).toMatchObject({
      first_completion: false,
    });
    expect(await answeredCount(plan.id)).toBe(1);
    await put(`hp_session=${hana.token}`, completeBody(shape));
    expect(await answeredCount(plan.id)).toBe(2);
    expect(await runCount(plan.id)).toBe(0);
    expect(captured).toEqual([]);

    // Lowering the threshold onto the count runs against Postgres and the fake Google clients only.
    const lowered = await patch({ threshold: 2 });
    expect(lowered.status).toBe(200);
    expect(((await lowered.json()) as { state: string }).state).toBe("proposed");
    expect(await runCount(plan.id)).toBe(1);
    expect(await sql`SELECT id FROM proposals WHERE plan_id = ${plan.id}`).toHaveLength(1);
    expect(captured.length).toBeGreaterThan(0);
    expectNoLiveGoogle(captured);
    expect(networkCalls).toEqual([]);
  });
});

