import { randomBytes } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { resetClock, setClock } from "@/server/clock";
import { closeDatabase } from "@/server/plans/http";
import { allowPlaceSearch } from "@/server/response/place-search";

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

const NOW = new Date("2026-04-10T12:00:00.000Z");
const accountIds: string[] = [];

function opaque(prefix: string): string {
  return `${prefix}${randomBytes(8).toString("hex")}`;
}

async function seedParticipant(): Promise<string> {
  const accountId = opaque("acc_");
  const planId = opaque("pln_");
  const participantId = opaque("prt_");
  accountIds.push(accountId);
  await sql`
    INSERT INTO accounts (id, email, password_hash, display_name)
    VALUES (${accountId}, ${`${accountId}@example.com`}, 'x', 'Nour')
  `;
  await sql`
    INSERT INTO plans (
      id, organizer_account_id, title, timezone, budget_amount_minor, currency,
      threshold, state, join_token
    ) VALUES (
      ${planId}, ${accountId}, 'Plan', 'Africa/Cairo', 50000, 'EGP',
      3, 'collecting', ${opaque("jt_")}
    )
  `;
  await sql`
    INSERT INTO participants (id, plan_id, account_id, display_name, distinguisher)
    VALUES (${participantId}, ${planId}, ${accountId}, 'Nour', 'a3k9')
  `;
  return participantId;
}

async function seedRows(
  participantId: string,
  total: number,
  searchedAt: Date,
): Promise<void> {
  for (let i = 0; i < total; i += 1) {
    await sql`
      INSERT INTO place_searches (id, participant_id, searched_at)
      VALUES (${opaque("pse_")}, ${participantId}, ${searchedAt})
    `;
  }
}

async function rowCount(participantId: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM place_searches WHERE participant_id = ${participantId}
  `;
  return rows[0]?.n ?? 0;
}

afterEach(async () => {
  resetClock();
  const ids = accountIds.splice(0, accountIds.length);
  for (const id of ids) {
    await sql`DELETE FROM place_searches WHERE participant_id IN (SELECT id FROM participants WHERE account_id = ${id})`;
    await sql`DELETE FROM participants WHERE account_id = ${id}`;
    await sql`DELETE FROM plans WHERE organizer_account_id = ${id}`;
    await sql`DELETE FROM accounts WHERE id = ${id}`;
  }
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
  await closeDatabase();
});

describe("allowPlaceSearch", () => {
  it("T-001-57/AC-3 rows older than one hour do not count, and the call deletes them", async () => {
    const participantId = await seedParticipant();
    setClock(NOW);
    await seedRows(participantId, 30, new Date(NOW.getTime() - 60 * 60 * 1000));

    expect(await allowPlaceSearch(participantId)).toBe(true);

    const rows = await sql<{ searched_at: Date }[]>`
      SELECT searched_at FROM place_searches WHERE participant_id = ${participantId}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.searched_at.getTime()).toBe(NOW.getTime());
  });

  it("T-001-57/AC-3 a row one millisecond inside the hour still counts", async () => {
    const participantId = await seedParticipant();
    setClock(NOW);
    await seedRows(participantId, 30, new Date(NOW.getTime() - 60 * 60 * 1000 + 1));

    expect(await allowPlaceSearch(participantId)).toBe(false);
    expect(await rowCount(participantId)).toBe(30);
  });

  it("T-001-57/AC-2 an allowed call inserts one row stamped with now, a refused call inserts none", async () => {
    const participantId = await seedParticipant();
    setClock(NOW);
    await seedRows(participantId, 28, new Date(NOW.getTime() - 60_000));

    expect(await allowPlaceSearch(participantId)).toBe(true);
    expect(await rowCount(participantId)).toBe(29);
    expect(await allowPlaceSearch(participantId)).toBe(true);
    expect(await rowCount(participantId)).toBe(30);
    expect(await allowPlaceSearch(participantId)).toBe(false);
    expect(await rowCount(participantId)).toBe(30);
  });

  it("T-001-57/AC-4 with 29 rows, two concurrent calls allow exactly one", async () => {
    const participantId = await seedParticipant();
    setClock(NOW);
    await seedRows(participantId, 29, new Date(NOW.getTime() - 60_000));

    const results = await Promise.all([
      allowPlaceSearch(participantId),
      allowPlaceSearch(participantId),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await rowCount(participantId)).toBe(30);
  });
});
