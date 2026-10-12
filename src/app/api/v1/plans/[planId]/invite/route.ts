import { NextResponse } from "next/server";
import { errorResponse, logged, readCookie } from "@/server/auth/http";
import { loadInvitePage } from "@/server/invites/page-data";
import { planLockedInviteError } from "@/server/invites/send";
import { notFoundResponse, organizerOnlyResponse } from "@/server/plans/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InviteRouteContext = {
  params: Promise<{ planId: string }>;
};

export async function GET(
  request: Request,
  context: InviteRouteContext,
): Promise<NextResponse> {
  const { planId } = await context.params;
  const page = await loadInvitePage(planId, (name) => readCookie(request, name));
  if (page.kind === "ok") {
    return logged(request, NextResponse.json(page.view));
  }
  if (page.kind === "organizer_only") {
    return logged(request, organizerOnlyResponse());
  }
  if (page.kind === "locked") {
    return logged(request, errorResponse(planLockedInviteError()));
  }
  return logged(request, notFoundResponse());
}
