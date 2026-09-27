import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { generateCookieToken, hashCookieToken } from "@/server/auth/session";
import { resetClock, setClock } from "@/server/clock";
import { generateId } from "@/server/ids";
import {
  PLACES_SEARCH_TEXT_URL,
  START_SEARCH_FIELD_MASK,
  type FetchFn,
} from "@/server/google/places";
import { POST as createAccount } from "../../../accounts/route";
import { closeDatabase as closeAccounts } from "@/server/auth/http";
import { POST as createPlan } from "../../route";
import { closeDatabase as closePlans } from "@/server/plans/http";
import { GET } from "./route";
import {
  resetPlaceSearchLog,
  setGoogleClientOptions,
} from "@/server/response/place-search";

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
  resetPlaceSearchLog();
  setGoogleClientOptions({
    apiKey: "test-places-key",
    fetch: searchFetch([startCafe]),
  });
});

afterEach(async () => {
  resetClock();
  resetPlaceSearchLog();
  setGoogleClientOptions(undefined);
  delete process.env.HP_HASH_TEST;
  vi.unstubAllGlobals();
  const emails = createdEmails.splice(0, createdEmails.length);
  for (const email of emails) {
    await forget(email);
  }
  const guests = extraGuestIds.splice(0, extraGuestIds.length);
  for (const id of guests) {
    await sql`DELETE FROM participants WHERE guest_session_id = ${id}`;
    await sql`DELETE FROM guest_sessions WHERE id = ${id}`;
  }
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
  await closePlans();
  await closeAccounts();
});

type Captured = {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: unknown;
};

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (headers === undefined) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return { ...headers };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function searchFetch(
  places: unknown[],
  captured: Captured[] = [],
  status = 200,
): FetchFn {
  return async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    captured.push({
      url,
      method: init?.method,
      headers: headerRecord(init?.headers),
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    return jsonResponse({ places }, status);
  };
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
    ],
    budget: { amount_minor: 50_000, currency: "EGP" },
    steps: [{ name: "Dinner", options: ["Koshary", "Grills"] }],
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
    body: JSON.stringify(body),
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

function searchGet(
  planId: string,
  q: string | null,
  init?: { cookie?: string; extraCookie?: string },
) {
  const query = q === null ? "" : `?q=${encodeURIComponent(q)}`;
  const headers: Record<string, string> = {};
  if (init?.cookie) {
    headers.cookie = init.extraCookie
      ? `${init.cookie}; ${init.extraCookie}`
      : init.cookie;
  }
  return GET(
    new Request(`http://localhost/v1/plans/${planId}/place-searches${query}`, {
      headers,
    }),
    { params: Promise.resolve({ planId }) },
  );
}

describe("GET /v1/plans/{planId}/place-searches", () => {
  it("requires q of 1–80 characters after trim, returns at most 5 results with no coordinates and no prices, and uses the start search mask", async () => {
    const orgEmail = track(uniqueEmail("org"));
    const memberEmail = track(uniqueEmail("member"));
    const organizer = await register(orgEmail, "Omar");
    const member = await register(memberEmail, "Nour");
    const plan = await openPlan(organizer.token);
    await seedAccountParticipant(plan.id, member.account.id, "Nour");
    const cookie = `hp_session=${member.token}`;

    const missing = await searchGet(plan.id, null, { cookie });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({
      error: {
        code: "validation_failed",
        fields: [{ path: "q", code: "required" }],
      },
    });

    const blank = await searchGet(plan.id, "   ", { cookie });
    expect(blank.status).toBe(400);
    expect(await blank.json()).toMatchObject({
      error: { fields: [{ path: "q", code: "required" }] },
    });

    const tooLong = await searchGet(plan.id, "x".repeat(81), { cookie });
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toMatchObject({
      error: { fields: [{ path: "q", code: "too_long" }] },
    });

    const captured: Captured[] = [];
    const many = Array.from({ length: 8 }, (_, index) => ({
      id: `ChIJ-${index}`,
      displayName: { text: `Place ${index}` },
      location: { latitude: 30 + index, longitude: 31 },
      priceRange: {
        startPrice: { currencyCode: "EGP", units: "90", nanos: 0 },
      },
    }));
    setGoogleClientOptions({
      apiKey: "search-key",
      fetch: searchFetch(many, captured),
    });

    const ok = await searchGet(plan.id, "  Maadi  ", {
      cookie,
      extraCookie: "hp_locale=ar",
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as {
      results: { google_place_id: string; name: string }[];
    };
    expect(body.results).toHaveLength(5);
    expect(body.results[0]).toEqual({
      google_place_id: "ChIJ-0",
      name: "Place 0",
    });
    expect(Object.keys(body.results[0]!).sort()).toEqual(
      ["google_place_id", "name"].sort(),
    );
    const json = JSON.stringify(body);
    expect(json).not.toContain("latitude");
    expect(json).not.toContain("longitude");
    expect(json).not.toContain("priceRange");
    expect(json).not.toContain("amount");
    expect(json).not.toContain("29.96");

    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(PLACES_SEARCH_TEXT_URL);
    expect(captured[0]?.method).toBe("POST");
    expect(captured[0]?.headers["X-Goog-FieldMask"]).toBe(START_SEARCH_FIELD_MASK);
    expect(captured[0]?.headers["X-Goog-Api-Key"]).toBe("search-key");
    expect(captured[0]?.body).toMatchObject({
      textQuery: "Maadi",
      languageCode: "ar",
      regionCode: "EG",
    });
    expect(JSON.stringify(captured[0]?.body)).not.toContain("priceRange");

    setGoogleClientOptions({
      apiKey: "search-key",
      fetch: searchFetch([]),
    });
    const empty = await searchGet(plan.id, "nowhere", { cookie });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ results: [] });
  });

  it("returns 429 after 30 calls per participant per rolling hour, and 503 upstream on Google failure", async () => {
    const orgEmail = track(uniqueEmail("org"));
    const memberEmail = track(uniqueEmail("member"));
    const otherEmail = track(uniqueEmail("other"));
    const organizer = await register(orgEmail, "Omar");
    const member = await register(memberEmail, "Nour");
    const other = await register(otherEmail, "Hana");
    const plan = await openPlan(organizer.token);
    await seedAccountParticipant(plan.id, member.account.id, "Nour");
    await seedAccountParticipant(plan.id, other.account.id, "Hana", "k7m2");
    const cookie = `hp_session=${member.token}`;
    const otherCookie = `hp_session=${other.token}`;

    setClock(new Date("2026-04-10T12:00:00.000Z"));
    for (let i = 0; i < 30; i += 1) {
      const response = await searchGet(plan.id, "Maadi", { cookie });
      expect(response.status).toBe(200);
      await response.json();
    }
    const limited = await searchGet(plan.id, "Maadi", { cookie });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      error: {
        code: "rate_limited",
        message: "too many place searches",
        fields: [],
      },
    });

    const otherOk = await searchGet(plan.id, "Maadi", { cookie: otherCookie });
    expect(otherOk.status).toBe(200);
    await otherOk.json();

    setClock(new Date("2026-04-10T13:00:00.000Z"));
    const rolled = await searchGet(plan.id, "Maadi", { cookie });
    expect(rolled.status).toBe(200);
    await rolled.json();

    setGoogleClientOptions({
      apiKey: "search-key",
      fetch: async () => jsonResponse({ error: "nope" }, 500),
    });
    const failed = await searchGet(plan.id, "Maadi", { cookie: otherCookie });
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({
      error: {
        code: "upstream",
        message: "places upstream failed",
        fields: [],
      },
    });
  });

  it("while proposed returns 409 responses_closed, while locked returns 409 plan_locked, and a stranger gets 404 with the envelope only; unset locale is en", async () => {
    const orgEmail = track(uniqueEmail("org"));
    const memberEmail = track(uniqueEmail("member"));
    const organizer = await register(orgEmail, "Omar");
    const member = await register(memberEmail, "Nour");
    const stranger = await register(track(uniqueEmail("stranger")), "Ziad");
    const plan = await openPlan(organizer.token, { title: "Thursday in Maadi" });
    await seedAccountParticipant(plan.id, member.account.id, "Nour");
    const cookie = `hp_session=${member.token}`;

    const captured: Captured[] = [];
    setGoogleClientOptions({
      apiKey: "search-key",
      fetch: searchFetch([startCafe], captured),
    });
    const collecting = await searchGet(plan.id, "Maadi", { cookie });
    expect(collecting.status).toBe(200);
    expect(captured[0]?.body).toMatchObject({ languageCode: "en", regionCode: "EG" });

    await sql`UPDATE plans SET state = 'blocked' WHERE id = ${plan.id}`;
    const blocked = await searchGet(plan.id, "Maadi", { cookie });
    expect(blocked.status).toBe(200);
    await blocked.json();

    await sql`UPDATE plans SET state = 'proposed' WHERE id = ${plan.id}`;
    const proposed = await searchGet(plan.id, "Maadi", { cookie });
    expect(proposed.status).toBe(409);
    expect(await proposed.json()).toMatchObject({
      error: { code: "conflict", reason: "responses_closed", fields: [] },
    });

    await sql`UPDATE plans SET state = 'locked', locked_at = now() WHERE id = ${plan.id}`;
    const locked = await searchGet(plan.id, "Maadi", { cookie });
    expect(locked.status).toBe(409);
    expect(await locked.json()).toMatchObject({
      error: { reason: "plan_locked" },
    });

    await sql`UPDATE plans SET state = 'collecting', locked_at = NULL WHERE id = ${plan.id}`;
    const strangerGet = await searchGet(plan.id, "Maadi", {
      cookie: `hp_session=${stranger.token}`,
    });
    expect(strangerGet.status).toBe(404);
    const strangerBody = await strangerGet.json();
    expect(strangerBody).toEqual({
      error: { code: "not_found", message: "plan not found", fields: [] },
    });
    expect(Object.keys(strangerBody)).toEqual(["error"]);
    expect(JSON.stringify(strangerBody)).not.toContain("Thursday in Maadi");
    expect(JSON.stringify(strangerBody)).not.toContain("Nour");
    expect(JSON.stringify(strangerBody)).not.toContain("Maadi, Cairo");

    const guest = await seedGuestParticipant(plan.id, "Mona", "m2n4");
    const guestOk = await searchGet(plan.id, "Maadi", {
      cookie: `hp_guest=${guest.token}`,
    });
    expect(guestOk.status).toBe(200);
    await guestOk.json();
  });
});
