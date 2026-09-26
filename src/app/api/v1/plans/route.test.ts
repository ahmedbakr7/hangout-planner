import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { resetClock } from "@/server/clock";
import { generateId, generateJoinToken, isId, isJoinToken } from "@/server/ids";
import { editableFor } from "@/server/plans/edit-rules";
import { POST as createAccount, closeDatabase as closeAccounts } from "../accounts/route";
import { GET, POST, closeDatabase } from "./route";

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

function uniqueEmail(label = "user"): string {
  return `${label}.${randomBytes(8).toString("hex")}@example.com`;
}

function track(email: string): string {
  createdEmails.push(email);
  return email;
}

async function wipePlan(planId: string): Promise<void> {
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

async function planCountFor(accountId: string): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM plans WHERE organizer_account_id = ${accountId}
  `;
  return Number(rows[0]?.count ?? 0);
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
});

afterEach(async () => {
  resetClock();
  delete process.env.HP_HASH_TEST;
  const emails = createdEmails.splice(0, createdEmails.length);
  for (const email of emails) {
    await forget(email);
  }
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
  await closeDatabase();
  await closeAccounts();
});

function setCookieLines(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function sessionSetCookie(response: Response): string | null {
  return setCookieLines(response).find((line) => line.startsWith("hp_session=")) ?? null;
}

function cookieValue(line: string): string {
  const pair = line.split(";", 1)[0] ?? "";
  return decodeURIComponent(pair.slice("hp_session=".length));
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
  init?: { csrf?: boolean; cookie?: string; raw?: string },
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
    body: init?.raw ?? JSON.stringify(body),
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
  return { account: body.account, token: cookieValue(line!) };
}

type OrganizerPlanBody = {
  id: string;
  title: string;
  state: string;
  timezone: string;
  windows: { id: string; local_date: string; start_local: string; end_local: string }[];
  budget: { amount_minor: number; currency: string };
  steps: { id: string; name: string; options: { id: string; label: string }[] }[];
  threshold: number;
  answered_count: number;
  in_progress_count: number;
  participants: unknown[];
  editable: unknown;
  join_path?: string;
};

describe("POST /v1/plans", () => {
  it("creates a collecting plan with answered_count 0 and a new join token, the caller is the organizer and not a participant, and 201 returns the organizer plan plus join_path", async () => {
    const email = track(uniqueEmail("org"));
    const created = await register(email, "Omar");
    const response = await POST(
      jsonRequest(
        "/v1/plans",
        "POST",
        {
          ...validPlan({
            title: "  Thursday in Maadi  ",
            steps: [
              { name: "  Dinner  ", options: ["  Koshary  ", "Grills"] },
            ],
            extra: true,
          }),
        },
        { cookie: `hp_session=${created.token}` },
      ),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as OrganizerPlanBody;
    expect(isId(body.id, "pln_")).toBe(true);
    expect(body.title).toBe("Thursday in Maadi");
    expect(body.state).toBe("collecting");
    expect(body.timezone).toBe("Africa/Cairo");
    expect(body.answered_count).toBe(0);
    expect(body.in_progress_count).toBe(0);
    expect(body.participants).toEqual([]);
    expect(body.threshold).toBe(3);
    expect(body.budget).toEqual({ amount_minor: 50_000, currency: "EGP" });
    expect(body.windows).toHaveLength(1);
    expect(isId(body.windows[0]?.id, "win_")).toBe(true);
    expect(body.windows[0]).toMatchObject({
      local_date: "2026-10-02",
      start_local: "18:00",
      end_local: "23:00",
    });
    expect(body.steps).toHaveLength(1);
    expect(isId(body.steps[0]?.id, "stp_")).toBe(true);
    expect(body.steps[0]?.name).toBe("Dinner");
    expect(body.steps[0]?.options.map((option) => option.label)).toEqual([
      "Koshary",
      "Grills",
    ]);
    expect(body.steps[0]?.options.every((option) => isId(option.id, "opt_"))).toBe(
      true,
    );
    expect(body.editable).toEqual(editableFor("collecting", 0));
    expect(body.join_path).toMatch(/^\/join\/jt_/);
    const token = body.join_path!.slice("/join/".length);
    expect(isJoinToken(token)).toBe(true);
    expect(body).not.toHaveProperty("join_token");
    expect(Object.keys(body).sort()).toEqual(
      [
        "answered_count",
        "budget",
        "editable",
        "id",
        "in_progress_count",
        "join_path",
        "participants",
        "state",
        "steps",
        "threshold",
        "timezone",
        "title",
        "windows",
      ].sort(),
    );

    const stored = await sql<
      {
        organizer_account_id: string;
        answered_count: number;
        state: string;
        join_token: string;
        title: string;
      }[]
    >`
      SELECT organizer_account_id, answered_count, state, join_token, title
      FROM plans WHERE id = ${body.id}
    `;
    expect(stored).toHaveLength(1);
    expect(stored[0]?.organizer_account_id).toBe(created.account.id);
    expect(stored[0]?.answered_count).toBe(0);
    expect(stored[0]?.state).toBe("collecting");
    expect(stored[0]?.join_token).toBe(token);
    expect(stored[0]?.title).toBe("Thursday in Maadi");

    const members = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM participants WHERE plan_id = ${body.id}
    `;
    expect(Number(members[0]?.count ?? 1)).toBe(0);
    const self = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM participants
      WHERE plan_id = ${body.id} AND account_id = ${created.account.id}
    `;
    expect(Number(self[0]?.count ?? 1)).toBe(0);
    expect(JSON.stringify(body)).not.toContain(email);
  });

  it("returns 400 naming each invalid field and writes no row", async () => {
    const email = track(uniqueEmail("bad"));
    const created = await register(email);
    const before = await planCountFor(created.account.id);

    const many = await POST(
      jsonRequest(
        "/v1/plans",
        "POST",
        {
          title: "",
          timezone: "Not/A_Zone",
          windows: [],
          budget: { amount_minor: 0, currency: "EUR" },
          steps: [],
          threshold: 0,
        },
        { cookie: `hp_session=${created.token}` },
      ),
    );
    expect(many.status).toBe(400);
    const manyBody = await many.json();
    expect(manyBody.error.code).toBe("validation_failed");
    expect(manyBody.error.fields).toEqual(
      expect.arrayContaining([
        { path: "title", code: "required" },
        { path: "timezone", code: "bad_timezone" },
        { path: "windows", code: "below_min" },
        { path: "budget.amount_minor", code: "not_positive" },
        { path: "budget.currency", code: "bad_currency" },
        { path: "steps", code: "below_min" },
        { path: "threshold", code: "below_min" },
      ]),
    );
    expect(manyBody.error.fields.length).toBeGreaterThan(1);
    expect(Object.keys(manyBody)).toEqual(["error"]);
    expect(await planCountFor(created.account.id)).toBe(before);

    const cases: {
      body: Record<string, unknown>;
      fields: { path: string; code: string }[];
    }[] = [
      {
        body: validPlan({ title: "t".repeat(81) }),
        fields: [{ path: "title", code: "too_long" }],
      },
      {
        body: validPlan({
          windows: [
            {
              local_date: "2026-10-02",
              start_local: "23:00",
              end_local: "18:00",
            },
          ],
        }),
        fields: [{ path: "windows[0].end_local", code: "end_before_start" }],
      },
      {
        body: validPlan({
          windows: [
            {
              local_date: "2026-10-02",
              start_local: "18:00",
              end_local: "18:00",
            },
          ],
        }),
        fields: [{ path: "windows[0].end_local", code: "end_before_start" }],
      },
      {
        body: validPlan({
          windows: [
            {
              local_date: "2026-02-30",
              start_local: "18:00",
              end_local: "23:00",
            },
          ],
        }),
        fields: [{ path: "windows[0].local_date", code: "unknown" }],
      },
      {
        body: validPlan({
          steps: [{ name: "Dinner", options: ["Only"] }],
        }),
        fields: [{ path: "steps[0].options", code: "below_min" }],
      },
      {
        body: validPlan({
          steps: [
            {
              name: "Dinner",
              options: ["A", "B", "C", "D", "E"],
            },
          ],
        }),
        fields: [{ path: "steps[0].options", code: "above_max" }],
      },
      {
        body: validPlan({ threshold: 101 }),
        fields: [{ path: "threshold", code: "above_max" }],
      },
      {
        body: validPlan({
          windows: Array.from({ length: 8 }, (_, index) => ({
            local_date: "2026-10-02",
            start_local: "18:00",
            end_local: "23:00",
            extra: index,
          })),
        }),
        fields: [{ path: "windows", code: "above_max" }],
      },
    ];

    for (const item of cases) {
      const response = await POST(
        jsonRequest("/v1/plans", "POST", item.body, {
          cookie: `hp_session=${created.token}`,
        }),
      );
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("validation_failed");
      expect(body.error.fields).toEqual(item.fields);
      expect(await planCountFor(created.account.id)).toBe(before);
    }

    const raw = await POST(
      jsonRequest("/v1/plans", "POST", null, {
        cookie: `hp_session=${created.token}`,
        raw: "not-json",
      }),
    );
    expect(raw.status).toBe(400);
    expect(await raw.json()).toEqual({
      error: {
        code: "validation_failed",
        message: "invalid fields",
        fields: [
          { path: "title", code: "required" },
          { path: "timezone", code: "required" },
          { path: "windows", code: "required" },
          { path: "budget", code: "required" },
          { path: "steps", code: "required" },
          { path: "threshold", code: "required" },
        ],
      },
    });
    expect(await planCountFor(created.account.id)).toBe(before);
  });

  it("returns 403 csrf and writes nothing when X-HP-Request is missing", async () => {
    const email = track(uniqueEmail("csrf"));
    const created = await register(email);
    const before = await planCountFor(created.account.id);
    const response = await POST(
      jsonRequest("/v1/plans", "POST", validPlan(), {
        csrf: false,
        cookie: `hp_session=${created.token}`,
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "forbidden",
        reason: "csrf",
        message: "missing X-HP-Request",
        fields: [],
      },
    });
    expect(await planCountFor(created.account.id)).toBe(before);
  });

  it("returns 401 missing_session without an account", async () => {
    const response = await POST(jsonRequest("/v1/plans", "POST", validPlan()));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "unauthenticated", reason: "missing_session" },
    });
  });

  it("accepts title, step, option, window, and threshold caps and returns stored strings as entered", async () => {
    const email = track(uniqueEmail("caps"));
    const created = await register(email);
    const title = "خميس في المعادي";
    const stepName = "ع".repeat(60);
    const option = "ك".repeat(40);
    const response = await POST(
      jsonRequest(
        "/v1/plans",
        "POST",
        validPlan({
          title: ` ${title} `,
          steps: [{ name: ` ${stepName} `, options: [` ${option} `, "Grill"] }],
          threshold: 1,
          budget: { amount_minor: 1, currency: "USD" },
        }),
        { cookie: `hp_session=${created.token}` },
      ),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as OrganizerPlanBody;
    expect(body.title).toBe(title);
    expect(body.steps[0]?.name).toBe(stepName);
    expect(body.steps[0]?.options[0]?.label).toBe(option);
    expect(body.budget.currency).toBe("USD");
    expect(body.threshold).toBe(1);

    const sevenWindows = await POST(
      jsonRequest(
        "/v1/plans",
        "POST",
        validPlan({
          title: "t".repeat(80),
          windows: Array.from({ length: 7 }, (_, index) => ({
            local_date: `2026-10-0${index + 1}`,
            start_local: "00:00",
            end_local: "23:59",
          })),
          steps: Array.from({ length: 6 }, (_, index) => ({
            name: `Step ${index + 1}`,
            options: ["A", "B", "C", "D"],
          })),
          threshold: 100,
          budget: { amount_minor: 100_000_000_000, currency: "AED" },
        }),
        { cookie: `hp_session=${created.token}` },
      ),
    );
    expect(sevenWindows.status).toBe(201);
    const sevenBody = (await sevenWindows.json()) as OrganizerPlanBody;
    expect(sevenBody.windows).toHaveLength(7);
    expect(sevenBody.steps).toHaveLength(6);
    expect(sevenBody.steps[0]?.options).toHaveLength(4);
    expect(sevenBody.threshold).toBe(100);
    expect(sevenBody.title).toHaveLength(80);
  });
});

describe("GET /v1/plans", () => {
  it("returns only plans this account organizes, updated_at descending, at most 100", async () => {
    const organizerEmail = track(uniqueEmail("list"));
    const otherEmail = track(uniqueEmail("other"));
    const organizer = await register(organizerEmail, "Omar");
    const other = await register(otherEmail, "Hana");

    const first = await POST(
      jsonRequest("/v1/plans", "POST", validPlan({ title: "First" }), {
        cookie: `hp_session=${organizer.token}`,
      }),
    );
    const second = await POST(
      jsonRequest("/v1/plans", "POST", validPlan({ title: "Second" }), {
        cookie: `hp_session=${organizer.token}`,
      }),
    );
    const otherPlan = await POST(
      jsonRequest("/v1/plans", "POST", validPlan({ title: "Other" }), {
        cookie: `hp_session=${other.token}`,
      }),
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(otherPlan.status).toBe(201);
    const firstBody = (await first.json()) as OrganizerPlanBody;
    const secondBody = (await second.json()) as OrganizerPlanBody;
    const otherBody = (await otherPlan.json()) as OrganizerPlanBody;

    await sql`
      UPDATE plans SET updated_at = ${new Date("2026-01-01T00:00:00.000Z")}
      WHERE id = ${firstBody.id}
    `;
    await sql`
      UPDATE plans SET updated_at = ${new Date("2026-01-02T00:00:00.000Z")}
      WHERE id = ${secondBody.id}
    `;

    const prtId = generateId("prt_");
    await sql`
      INSERT INTO participants (
        id, plan_id, account_id, guest_session_id, display_name, distinguisher
      ) VALUES (
        ${prtId}, ${firstBody.id}, ${other.account.id}, NULL, 'Hana', 'a3k9'
      )
    `;

    const response = await GET(
      new Request("http://localhost/v1/plans", {
        headers: { cookie: `hp_session=${organizer.token}` },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      plans: {
        id: string;
        title: string;
        answered_count: number;
        threshold: number;
        state: string;
      }[];
      truncated: boolean;
    };
    expect(body.truncated).toBe(false);
    expect(body.plans.map((plan) => plan.id)).toEqual([
      secondBody.id,
      firstBody.id,
    ]);
    expect(body.plans.map((plan) => plan.title)).toEqual(["Second", "First"]);
    expect(body.plans.every((plan) => plan.state === "collecting")).toBe(true);
    expect(body.plans.find((plan) => plan.id === otherBody.id)).toBeUndefined();
    expect(Object.keys(body)).toEqual(["plans", "truncated"]);
    expect(Object.keys(body.plans[0]!).sort()).toEqual(
      ["answered_count", "id", "state", "threshold", "title"].sort(),
    );

    const asJoiner = await GET(
      new Request("http://localhost/v1/plans", {
        headers: { cookie: `hp_session=${other.token}` },
      }),
    );
    const joinerBody = (await asJoiner.json()) as {
      plans: { id: string; title: string }[];
    };
    expect(joinerBody.plans.map((plan) => plan.id)).toEqual([otherBody.id]);
    expect(joinerBody.plans.map((plan) => plan.title)).toEqual(["Other"]);
  });

  it("returns plans [] with truncated false when the account organizes none", async () => {
    const email = track(uniqueEmail("empty"));
    const created = await register(email);
    const response = await GET(
      new Request("http://localhost/v1/plans", {
        headers: { cookie: `hp_session=${created.token}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ plans: [], truncated: false });
  });

  it("caps the home list at 100 and sets truncated when more exist", async () => {
    const email = track(uniqueEmail("cap"));
    const created = await register(email);
    const rows = [];
    for (let index = 0; index < 101; index += 1) {
      rows.push({
        id: generateId("pln_"),
        organizer_account_id: created.account.id,
        title: `Plan ${index}`,
        timezone: "Africa/Cairo",
        budget_amount_minor: 50_000,
        currency: "EGP",
        threshold: 3,
        answered_count: 0,
        state: "collecting" as const,
        join_token: generateJoinToken(),
        updated_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
      });
    }
    for (const row of rows) {
      await sql`
        INSERT INTO plans (
          id, organizer_account_id, title, timezone, budget_amount_minor,
          currency, threshold, answered_count, state, join_token, updated_at
        ) VALUES (
          ${row.id}, ${row.organizer_account_id}, ${row.title}, ${row.timezone},
          ${row.budget_amount_minor}, ${row.currency}, ${row.threshold},
          ${row.answered_count}, ${row.state}, ${row.join_token}, ${row.updated_at}
        )
      `;
    }
    const response = await GET(
      new Request("http://localhost/v1/plans", {
        headers: { cookie: `hp_session=${created.token}` },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      plans: { id: string; title: string }[];
      truncated: boolean;
    };
    expect(body.truncated).toBe(true);
    expect(body.plans).toHaveLength(100);
    expect(body.plans[0]?.title).toBe("Plan 100");
    expect(body.plans[99]?.title).toBe("Plan 1");
  });

  it("returns 401 missing_session without an account", async () => {
    const response = await GET(new Request("http://localhost/v1/plans"));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: "unauthenticated",
        reason: "missing_session",
        message: "missing session",
        fields: [],
      },
    });
    expect(Object.keys(body)).toEqual(["error"]);
  });
});
