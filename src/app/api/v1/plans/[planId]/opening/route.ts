import { NextResponse } from "next/server";
import { logged, readCookie } from "@/server/auth/http";
import { loadPlanJoinPage } from "@/server/join/page-data";
import { notFoundResponse } from "@/server/plans/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OpeningRouteContext = {
  params: Promise<{ planId: string }>;
};

export async function GET(
  request: Request,
  context: OpeningRouteContext,
): Promise<NextResponse> {
  const { planId } = await context.params;
  const page = await loadPlanJoinPage(planId, (name) =>
    readCookie(request, name),
  );
  if (page.kind === "not_found") {
    return logged(request, notFoundResponse());
  }
  return logged(request, NextResponse.json(page.opening));
}
