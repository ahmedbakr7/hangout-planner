import { NextResponse } from "next/server";
import {
  REQUIRED_ACCOUNT_FIELDS,
  accountResponse,
  createAccount,
  emailTakenResponse,
  logged,
  readJsonObject,
  registrationFields,
  rejectCsrf,
  validationFailed,
} from "@/server/auth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const csrf = rejectCsrf(request);
  if (csrf) {
    return logged(request, csrf);
  }

  const body = await readJsonObject(request);
  if (!body) {
    return logged(request, validationFailed(REQUIRED_ACCOUNT_FIELDS));
  }

  const parsed = registrationFields(body);
  if (!parsed.ok) {
    return logged(request, validationFailed(parsed.fields));
  }

  const created = await createAccount({
    email: parsed.email,
    password: parsed.password,
    displayName: parsed.displayName,
  });
  if (!created) {
    return logged(request, emailTakenResponse());
  }

  return logged(
    request,
    accountResponse(created.account, created.token, 201, created.options),
  );
}
