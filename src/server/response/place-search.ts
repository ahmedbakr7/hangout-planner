import { now } from "@/server/clock";
import type { GoogleClientOptions } from "@/server/google/places";
import {
  PLACE_SEARCH_LIMIT,
  PLACE_SEARCH_WINDOW_MS,
} from "@/server/response/save";

let googleClientOptions: GoogleClientOptions | undefined;
const placeSearchLog = new Map<string, number[]>();

export function setGoogleClientOptions(
  options: GoogleClientOptions | undefined,
): void {
  googleClientOptions = options;
}

export function resetPlaceSearchLog(): void {
  placeSearchLog.clear();
}

export function allowPlaceSearch(participantId: string): boolean {
  const ts = now().getTime();
  const cutoff = ts - PLACE_SEARCH_WINDOW_MS;
  const kept = (placeSearchLog.get(participantId) ?? []).filter(
    (stamp) => stamp > cutoff,
  );
  if (kept.length >= PLACE_SEARCH_LIMIT) {
    placeSearchLog.set(participantId, kept);
    return false;
  }
  kept.push(ts);
  placeSearchLog.set(participantId, kept);
  return true;
}

export function placeSearchGoogleOptions(): GoogleClientOptions | undefined {
  return googleClientOptions;
}
