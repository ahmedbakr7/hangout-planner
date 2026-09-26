import { NextResponse } from "next/server";
import { now } from "@/server/clock";
import {
  regionCodeForTimezone,
  searchStartPlaces,
  type GoogleClientOptions,
} from "@/server/google/places";
import { asPlanState } from "@/server/join/open";
import { LOCALE_COOKIE, localeFromCookie } from "@/i18n/request";
import type { PlanState } from "@/server/plans/edit-rules";
import {
  PLACE_SEARCH_LIMIT,
  PLACE_SEARCH_RESULT_CAP,
  PLACE_SEARCH_WINDOW_MS,
  parsePlaceSearchQuery,
  placeSearchRateLimitedError,
  responseValidationFailed,
  responsesClosedError,
  upstreamPlacesError,
} from "@/server/response/save";
import { errorResponse, logged, readCookie } from "../../../accounts/route";
import {
  loadPlanRow,
  notFoundResponse,
  planLockedResponse,
} from "../../route";
import { planRoleFor } from "../opening/route";
import { loadCallerParticipant } from "../response/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PlaceSearchRouteContext = {
  params: Promise<{ planId: string }>;
};

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

function allowPlaceSearch(participantId: string): boolean {
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

function closedResponse(state: PlanState): NextResponse | null {
  if (state === "proposed") {
    return errorResponse(responsesClosedError());
  }
  if (state === "locked") {
    return planLockedResponse();
  }
  return null;
}

export async function GET(
  request: Request,
  context: PlaceSearchRouteContext,
): Promise<NextResponse> {
  const { planId } = await context.params;
  const plan = await loadPlanRow(planId);
  if (!plan) {
    return logged(request, notFoundResponse());
  }
  const role = await planRoleFor(request, plan);
  const participant = await loadCallerParticipant(request, plan.id);
  if (role !== "participant" || !participant) {
    return logged(request, notFoundResponse());
  }
  const closed = closedResponse(asPlanState(plan.state));
  if (closed) {
    return logged(request, closed);
  }

  const url = new URL(request.url);
  const parsed = parsePlaceSearchQuery(url.searchParams.get("q"));
  if (!parsed.ok) {
    return logged(
      request,
      errorResponse(responseValidationFailed(parsed.fields)),
    );
  }
  if (!allowPlaceSearch(participant.id)) {
    return logged(request, errorResponse(placeSearchRateLimitedError()));
  }

  const languageCode = localeFromCookie(
    readCookie(request, LOCALE_COOKIE) ?? undefined,
  );
  const regionCode = regionCodeForTimezone(plan.timezone);
  try {
    const places = await searchStartPlaces(
      {
        textQuery: parsed.q,
        languageCode,
        ...(regionCode !== undefined ? { regionCode } : {}),
      },
      googleClientOptions,
    );
    return logged(
      request,
      NextResponse.json({
        results: places.slice(0, PLACE_SEARCH_RESULT_CAP).map((place) => ({
          google_place_id: place.id,
          name: place.displayName,
        })),
      }),
    );
  } catch {
    return logged(request, errorResponse(upstreamPlacesError()));
  }
}
