import { NextResponse } from "next/server";
import { CURRENCIES } from "@/server/money";
import {
  logged,
  missingSessionResponse,
  readAccountSession,
  readCookie,
} from "../accounts/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const session = await readAccountSession(readCookie(request, "hp_session"));
  if (!session.ok) {
    return logged(request, missingSessionResponse());
  }

  return logged(
    request,
    NextResponse.json({
      currencies: CURRENCIES.map((currency) => ({
        code: currency.code,
        exponent: currency.exponent,
      })),
    }),
  );
}
