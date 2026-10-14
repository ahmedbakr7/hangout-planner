import { NextResponse } from "next/server";
import {
  accountResponse,
  logged,
  missingSessionResponse,
  readCookie,
  slideSession,
} from "@/server/auth/http";
import { loadAccountPage } from "@/server/auth/page-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const page = await loadAccountPage((name) => readCookie(request, name));
  if (page.kind === "signed_out") {
    return logged(request, missingSessionResponse());
  }

  const { session } = page;
  const options = await slideSession(session.sessionId);
  return logged(
    request,
    accountResponse(session.account, session.token, 200, options),
  );
}
