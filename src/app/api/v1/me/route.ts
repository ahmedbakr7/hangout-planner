import { NextResponse } from "next/server";
import {
  accountResponse,
  logged,
  missingSessionResponse,
  readAccountSession,
  readCookie,
  slideSession,
} from "@/server/auth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const session = await readAccountSession(readCookie(request, "hp_session"));
  if (!session.ok) {
    return logged(request, missingSessionResponse());
  }

  const options = await slideSession(session.sessionId);
  return logged(
    request,
    accountResponse(session.account, session.token, 200, options),
  );
}
