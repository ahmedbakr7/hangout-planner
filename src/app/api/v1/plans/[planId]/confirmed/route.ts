import { NextResponse } from "next/server";
import { errorResponse, logged } from "@/server/auth/http";
import { httpError } from "@/server/http/errors";
import { asPlanState } from "@/server/join/open";
import type { PlanState } from "@/server/plans/edit-rules";
import { loadConfirmedDocument } from "@/server/plans/confirmed";
import {
  loadPlanRow,
  notFoundResponse,
  storedState,
} from "@/server/plans/http";
import { planRoleFor } from "@/server/plans/role";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConfirmedRouteContext = {
  params: Promise<{ planId: string }>;
};

function notLockedResponse(): NextResponse {
  return errorResponse(
    httpError(409, {
      reason: "not_locked",
      message: "plan is not locked",
    }),
  );
}

export async function GET(
  request: Request,
  context: ConfirmedRouteContext,
): Promise<NextResponse> {
  const { planId } = await context.params;
  const plan = await loadPlanRow(planId);
  if (!plan) {
    return logged(request, notFoundResponse());
  }

  const role = await planRoleFor(request, plan);
  if (role === null) {
    return logged(request, notFoundResponse());
  }

  const state: PlanState = storedState(asPlanState(plan.state));
  if (state !== "locked") {
    return logged(request, notLockedResponse());
  }

  return logged(request, NextResponse.json(await loadConfirmedDocument(plan)));
}
