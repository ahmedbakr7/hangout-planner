import { NextResponse } from "next/server";
import { errorResponse, logged, readCookie } from "@/server/auth/http";
import { httpError } from "@/server/http/errors";
import { notFoundResponse } from "@/server/plans/http";
import { loadConfirmedPage } from "@/server/plans/page-data";

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
  const page = await loadConfirmedPage(planId, (name) =>
    readCookie(request, name),
  );
  if (page.kind === "not_found") {
    return logged(request, notFoundResponse());
  }
  if (page.kind === "not_locked") {
    return logged(request, notLockedResponse());
  }
  return logged(request, NextResponse.json(page.doc));
}
