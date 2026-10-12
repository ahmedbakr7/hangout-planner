import { NextResponse } from "next/server";
import { httpError } from "@/server/http/errors";
import { errorResponse, logged, readCookie } from "@/server/auth/http";
import { notFoundResponse, planLockedResponse } from "@/server/plans/http";
import { loadProposalPage } from "@/server/proposal/page-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProposalRouteContext = {
  params: Promise<{ planId: string }>;
};

function notProposedResponse(): NextResponse {
  return errorResponse(
    httpError(409, {
      reason: "not_proposed",
      message: "proposal is not available",
    }),
  );
}

export async function GET(
  request: Request,
  context: ProposalRouteContext,
): Promise<NextResponse> {
  const { planId } = await context.params;
  const page = await loadProposalPage(planId, (name) =>
    readCookie(request, name),
  );
  if (page.kind === "ok") {
    return logged(request, NextResponse.json(page.view));
  }
  if (page.kind === "collecting") {
    return logged(
      request,
      NextResponse.json({ state: "collecting", block: null, proposal: null }),
    );
  }
  if (page.kind === "not_proposed") {
    return logged(request, notProposedResponse());
  }
  if (page.kind === "locked") {
    return logged(request, planLockedResponse());
  }
  return logged(request, notFoundResponse());
}
