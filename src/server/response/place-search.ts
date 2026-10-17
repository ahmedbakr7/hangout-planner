import { randomBytes } from "node:crypto";
import { and, count, eq, lte, sql } from "drizzle-orm";
import { now } from "@/server/clock";
import { placeSearches } from "@/server/db/schema";
import type { GoogleClientOptions } from "@/server/google/places";
import { db } from "@/server/plans/http";
import {
  PLACE_SEARCH_LIMIT,
  PLACE_SEARCH_WINDOW_MS,
} from "@/server/response/save";

let googleClientOptions: GoogleClientOptions | undefined;

export function setGoogleClientOptions(
  options: GoogleClientOptions | undefined,
): void {
  googleClientOptions = options;
}

export async function allowPlaceSearch(
  participantId: string,
): Promise<boolean> {
  return db().transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${participantId}))`,
    );
    const at = now();
    const cutoff = new Date(at.getTime() - PLACE_SEARCH_WINDOW_MS);
    await tx
      .delete(placeSearches)
      .where(
        and(
          eq(placeSearches.participantId, participantId),
          lte(placeSearches.searchedAt, cutoff),
        ),
      );
    const [counted] = await tx
      .select({ total: count() })
      .from(placeSearches)
      .where(eq(placeSearches.participantId, participantId));
    if ((counted?.total ?? 0) >= PLACE_SEARCH_LIMIT) {
      return false;
    }
    await tx.insert(placeSearches).values({
      id: `pse_${randomBytes(16).toString("hex")}`,
      participantId,
      searchedAt: at,
    });
    return true;
  });
}

export function placeSearchGoogleOptions(): GoogleClientOptions | undefined {
  return googleClientOptions;
}
