import { randomBytes } from "node:crypto";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTableColumns, getTableName, isTable } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";

const root = process.cwd();
const migrationPath = resolve(root, "drizzle/0001_init.sql");

const CONTRACT_COLUMNS: Record<string, string[]> = {
  accounts: ["id", "email", "password_hash", "display_name", "created_at"],
  sessions: ["id", "account_id", "token_hash", "expires_at"],
  plans: [
    "id",
    "organizer_account_id",
    "title",
    "timezone",
    "budget_amount_minor",
    "currency",
    "threshold",
    "answered_count",
    "state",
    "join_token",
    "attempt_lock",
    "attempt_lock_at",
    "created_at",
    "updated_at",
    "locked_at",
  ],
  plan_windows: [
    "id",
    "plan_id",
    "position",
    "local_date",
    "start_local",
    "end_local",
  ],
  plan_steps: ["id", "plan_id", "position", "name"],
  plan_options: ["id", "step_id", "position", "label"],
  participants: [
    "id",
    "plan_id",
    "account_id",
    "guest_session_id",
    "display_name",
    "distinguisher",
    "created_at",
  ],
  guest_sessions: ["id", "token_hash", "expires_at"],
  responses: [
    "participant_id",
    "start_google_place_id",
    "start_name",
    "start_lat",
    "start_lng",
    "complete",
    "first_completed_at",
  ],
  response_windows: [
    "participant_id",
    "window_id",
    "kind",
    "earliest_local",
    "latest_local",
  ],
  response_picks: ["participant_id", "step_id", "option_id"],
  invitations: ["id", "plan_id", "account_id", "distinguisher", "created_at"],
  link_sessions: ["id", "token_hash", "expires_at"],
  link_session_plans: ["link_session_id", "plan_id"],
  proposal_runs: [
    "id",
    "plan_id",
    "started_at",
    "outcome",
    "block_time",
    "block_budget",
    "block_venue_data",
  ],
  proposals: [
    "id",
    "plan_id",
    "local_date",
    "local_time",
    "fairness_warning",
    "created_at",
  ],
  proposal_cohort: ["proposal_id", "participant_id", "attending"],
  proposal_steps: [
    "proposal_id",
    "step_id",
    "option_id",
    "google_place_id",
    "place_name",
    "amount_minor",
  ],
  proposal_legs: [
    "proposal_id",
    "from_step_id",
    "to_step_id",
    "duration_seconds",
  ],
  proposal_candidates: [
    "proposal_id",
    "step_id",
    "google_place_id",
    "place_name",
    "amount_minor",
    "latitude",
    "longitude",
  ],
  proposal_alternatives: [
    "proposal_id",
    "step_id",
    "position",
    "google_place_id",
  ],
  step_signals: ["proposal_id", "step_id", "participant_id", "signal"],
};

const CONTRACT_TABLES = Object.keys(CONTRACT_COLUMNS).sort();

function schemaTables() {
  return Object.values(schema).filter(isTable);
}

async function expectCode(run: () => Promise<unknown>, code: string) {
  try {
    await run();
  } catch (err) {
    expect((err as { code?: string }).code).toBe(code);
    return;
  }
  throw new Error(`expected Postgres error ${code}`);
}

describe("schema.ts", () => {
  it("defines exactly the 22 CONTRACTS tables and columns", () => {
    const tables = schemaTables();
    expect(tables.map((table) => getTableName(table)).sort()).toEqual(
      CONTRACT_TABLES,
    );
    for (const table of tables) {
      const names = Object.values(getTableColumns(table)).map(
        (column) => column.name,
      );
      expect(names.sort()).toEqual(
        [...CONTRACT_COLUMNS[getTableName(table)]].sort(),
      );
    }
  });
});

describe("drizzle/0001_init.sql", () => {
  it("is the only migration file and has no down migration", () => {
    expect(readdirSync(resolve(root, "drizzle"))).toEqual(["0001_init.sql"]);
  });
});

describe("migration on Postgres", () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const schemaName = `t00102_${randomBytes(8).toString("hex")}`;
  const sql = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 0,
    connect_timeout: 10,
    onnotice: () => {},
  });

  beforeAll(async () => {
    await sql.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await sql.unsafe(`SET search_path TO "${schemaName}"`);
    await sql.file(migrationPath);
    await sql.unsafe(`
      INSERT INTO accounts (id, email, password_hash, display_name)
      VALUES
        ('acc_org', 'org@example.com', 'hash', 'Omar'),
        ('acc_a', 'a@example.com', 'hash', 'Nour'),
        ('acc_b', 'b@example.com', 'hash', 'Hana');
      INSERT INTO guest_sessions (id, token_hash, expires_at)
      VALUES
        ('gst_1', 'guest-hash-1', now() + interval '30 days'),
        ('gst_2', 'guest-hash-2', now() + interval '30 days');
      INSERT INTO plans (
        id, organizer_account_id, title, timezone, budget_amount_minor,
        currency, threshold, state, join_token
      ) VALUES (
        'pln_1', 'acc_org', 'Thursday in Maadi', 'Africa/Cairo', 50000,
        'EGP', 3, 'collecting', 'jt_token'
      );
    `);
  });

  afterAll(async () => {
    try {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("creates every CONTRACTS table and no other table", async () => {
    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = ${schemaName}
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;
    expect(rows.map((row) => row.table_name)).toEqual(CONTRACT_TABLES);
  });

  it("creates every CONTRACTS column on those tables", async () => {
    const rows = await sql<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = ${schemaName}
      ORDER BY table_name, column_name
    `;
    const byTable = new Map<string, string[]>();
    for (const row of rows) {
      const list = byTable.get(row.table_name) ?? [];
      list.push(row.column_name);
      byTable.set(row.table_name, list);
    }
    expect([...byTable.keys()].sort()).toEqual(CONTRACT_TABLES);
    for (const [table, columns] of byTable) {
      expect(columns.sort()).toEqual([...CONTRACT_COLUMNS[table]].sort());
    }
  });

  it("requires exactly one of account_id and guest_session_id on participants", async () => {
    await expectCode(
      () =>
        sql.unsafe(`
          INSERT INTO participants (
            id, plan_id, account_id, guest_session_id, display_name, distinguisher
          ) VALUES (
            'prt_none', 'pln_1', NULL, NULL, 'None', 'aaaa'
          )
        `),
      "23514",
    );
    await expectCode(
      () =>
        sql.unsafe(`
          INSERT INTO participants (
            id, plan_id, account_id, guest_session_id, display_name, distinguisher
          ) VALUES (
            'prt_both', 'pln_1', 'acc_a', 'gst_1', 'Both', 'bbbb'
          )
        `),
      "23514",
    );
    await sql.unsafe(`
      INSERT INTO participants (
        id, plan_id, account_id, guest_session_id, display_name, distinguisher
      ) VALUES
        ('prt_acc', 'pln_1', 'acc_a', NULL, 'Nour', 'cccc'),
        ('prt_gst', 'pln_1', NULL, 'gst_1', 'Guest', 'dddd')
    `);
  });

  it("enforces a partial unique on participants (plan_id, account_id)", async () => {
    const indexes = await sql<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = ${schemaName}
        AND tablename = 'participants'
        AND indexname = 'participants_plan_id_account_id_uidx'
    `;
    expect(indexes).toHaveLength(1);
    expect(indexes[0].indexdef.toLowerCase()).toContain("unique");
    expect(indexes[0].indexdef.toLowerCase()).toContain("plan_id");
    expect(indexes[0].indexdef.toLowerCase()).toContain("account_id");
    expect(indexes[0].indexdef.toLowerCase()).toMatch(
      /where .*account_id is not null/,
    );

    await sql.unsafe(`
      INSERT INTO participants (
        id, plan_id, account_id, guest_session_id, display_name, distinguisher
      ) VALUES (
        'prt_unique', 'pln_1', 'acc_b', NULL, 'Hana', 'eeee'
      )
    `);
    await expectCode(
      () =>
        sql.unsafe(`
          INSERT INTO participants (
            id, plan_id, account_id, guest_session_id, display_name, distinguisher
          ) VALUES (
            'prt_unique_dup', 'pln_1', 'acc_b', NULL, 'Hana again', 'ffff'
          )
        `),
      "23505",
    );
    await sql.unsafe(`
      INSERT INTO participants (
        id, plan_id, account_id, guest_session_id, display_name, distinguisher
      ) VALUES (
        'prt_gst_2', 'pln_1', NULL, 'gst_2', 'Other guest', 'gggg'
      )
    `);
  });

  it("enforces unique (plan_id, account_id) on invitations", async () => {
    const constraints = await sql<{ conname: string; def: string }[]>`
      SELECT c.conname, pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = ${schemaName}
        AND t.relname = 'invitations'
        AND c.contype = 'u'
        AND c.conname = 'invitations_plan_id_account_id_unique'
    `;
    expect(constraints).toHaveLength(1);
    expect(constraints[0].def.toLowerCase()).toContain("plan_id");
    expect(constraints[0].def.toLowerCase()).toContain("account_id");

    await sql.unsafe(`
      INSERT INTO invitations (id, plan_id, account_id, distinguisher)
      VALUES ('inv_1', 'pln_1', 'acc_b', 'hhhh')
    `);
    await expectCode(
      () =>
        sql.unsafe(`
          INSERT INTO invitations (id, plan_id, account_id, distinguisher)
          VALUES ('inv_2', 'pln_1', 'acc_b', 'iiii')
        `),
      "23505",
    );
  });
});
