import { NextResponse } from "next/server";
import type { ErrorField } from "@/server/http/errors";
import {
  accountResponse,
  badCredentialsResponse,
  clearAccountSession,
  clearedSessionResponse,
  logged,
  readCookie,
  readJsonObject,
  rejectCsrf,
  signInAccount,
  signInFields,
  validationFailed,
} from "@/server/auth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUIRED_SIGN_IN_FIELDS: ErrorField[] = [
  { path: "email", code: "required" },
  { path: "password", code: "required" },
];

export async function POST(request: Request): Promise<NextResponse> {
  const csrf = rejectCsrf(request);
  if (csrf) {
    return logged(request, csrf);
  }

  const body = await readJsonObject(request);
  if (!body) {
    return logged(request, validationFailed(REQUIRED_SIGN_IN_FIELDS));
  }

  const parsed = signInFields(body);
  if (!parsed.ok) {
    return logged(request, validationFailed(parsed.fields));
  }

  const signedIn = await signInAccount(parsed.email, parsed.password);
  if (!signedIn) {
    return logged(request, badCredentialsResponse());
  }

  return logged(
    request,
    accountResponse(signedIn.account, signedIn.token, 200, signedIn.options),
  );
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const csrf = rejectCsrf(request);
  if (csrf) {
    return logged(request, csrf);
  }

  await clearAccountSession(readCookie(request, "hp_session"));
  return logged(request, clearedSessionResponse());
}
