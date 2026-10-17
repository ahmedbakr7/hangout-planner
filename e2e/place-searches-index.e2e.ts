/**
 * T-001-58 — the database built from drizzle/0001_init.sql (applied by the global setup) indexes
 * place_searches by (participant_id, searched_at), so the per-participant prune and count in
 * allowPlaceSearch do not scan the table. Read from pg_indexes over the real database.
 */
import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}
const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

afterAll(async () => {
  await sql.end();
});

describe("place_searches index", () => {
  it("T-001-58/AC-1 the migrated database has a btree index on place_searches (participant_id, searched_at)", async () => {
    const indexes = await sql<{ indexdef: string }[]>`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'place_searches'
        AND indexname = 'place_searches_participant_id_searched_at_idx'
    `;
    expect(indexes).toHaveLength(1);
    const def = indexes[0].indexdef.toLowerCase();
    expect(def).not.toContain("unique");
    expect(def).toMatch(/ on [\w.]*place_searches /);
    expect(def).toContain("using btree");
    expect(def).toContain("(participant_id, searched_at)");
  });
});
