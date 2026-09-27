import { NextResponse } from "next/server";
import {
  allowPlaceSearch,
  placeSearchGoogleOptions,
} from "@/server/response/place-search";
import {
  regionCodeForTimezone,
  searchStartPlaces,
} from "@/server/google/places";
import { asPlanState } from "@/server/join/open";
import { LOCALE_COOKIE, localeFromCookie } from "@/i18n/request";
import type { PlanState } from "@/server/plans/edit-rules";
import {
  PLACE_SEARCH_RESULT_CAP,
  parsePlaceSearchQuery,
  placeSearchRateLimitedError,
  responseValidationFailed,
  responsesClosedError,
  upstreamPlacesError,
} from "@/server/response/save";
import {
  errorResponse,
  logged,
  readCookie,
} from "@/server/auth/http";
import {
  loadPlanRow,
  notFoundResponse,
  planLockedResponse,
} from "@/server/plans/http";
import { planRoleFor } from "@/server/plans/role";
import { loadCallerParticipant } from "@/server/response/caller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PlaceSearchRouteContext = {
  params: Promise<{ planId: string }>;
};

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
      placeSearchGoogleOptions(),
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
