import { NextResponse } from "next/server";
import {
  logged,
  missingSessionResponse,
  readCookie,
} from "@/server/auth/http";
import { loadCreatePlanPage } from "@/server/plans/page-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const page = await loadCreatePlanPage((name) => readCookie(request, name));
  if (page.kind === "signed_out") {
    return logged(request, missingSessionResponse());
  }
  return logged(request, NextResponse.json(page.view));
}
