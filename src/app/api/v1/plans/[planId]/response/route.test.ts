import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { generateCookieToken, hashCookieToken } from "@/server/auth/session";
import { resetClock } from "@/server/clock";
import { generateId } from "@/server/ids";
import { START_DETAILS_FIELD_MASK, type FetchFn } from "@/server/google/places";
import {
  POST as createAccount,
  closeDatabase as closeAccounts,
} from "../../../accounts/route";
import { POST as createPlan, closeDatabase as closePlans } from "../../route";
import { GET, PUT, setGoogleClientOptions } from "./route";

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
  vi.stubGlobal("fetch", async () => {
    throw new Error("unit tests must not call the network");
  });
  setGoogleClientOptions({
    apiKey: "test-places-key",
    fetch: detailsFetch(startCafe),
  });
});

afterEach(async () => {
  resetClock();
  delete process.env.HP_HASH_TEST;
  setGoogleClientOptions(undefined);
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
    const plan = await openPlan(organizer.token, { threshold: 1 });
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
      threshold: 1,
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

    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(
        resolve(process.cwd(), "src/app/api/v1/plans/[planId]/response/route.ts"),
        "utf8",
      ),
    );
    const saveSource = await import("node:fs/promises").then((fs) =>
      fs.readFile(resolve(process.cwd(), "src/server/response/save.ts"), "utf8"),
    );
    expect(source).not.toContain("runProposalAttempt");
    expect(saveSource).not.toContain("runProposalAttempt");

    const guest = await seedGuestParticipant(plan.id, "Mona", "m2n4");
    const guestGet = await responseGet(plan.id, `hp_guest=${guest.token}`);
    expect(guestGet.status).toBe(200);
    expect(((await guestGet.json()) as GetBody).response.complete).toBe(false);
  });
});
