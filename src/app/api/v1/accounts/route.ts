import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import {
  authCookieOptions,
  generateCookieToken,
  hashCookieToken,
  type AuthCookieOptions,
} from "@/server/auth/session";
import { now } from "@/server/clock";
import { createDb } from "@/server/db/client";
import { accounts, sessions } from "@/server/db/schema";
import {
  httpError,
  type ErrorField,
  type HttpError,
} from "@/server/http/errors";
import { generateId } from "@/server/ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_COOKIE = "hp_session" as const;
const EMAIL_MAX = 254;
const DISPLAY_NAME_MAX = 40;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;

const BAD_CREDENTIALS_MESSAGE = "sign-in rejected";

export type AccountPublic = {
  id: string;
  email: string;
  display_name: string;
};

type Database = ReturnType<typeof createDb>;

type Registration =
  | {
      ok: true;
      email: string;
      password: string;
      displayName: string;
    }
  | { ok: false; fields: ErrorField[] };

type SignInFields =
  | { ok: true; email: string; password: string }
  | { ok: false; fields: ErrorField[] };

export type AccountSession =
  | {
      ok: true;
      account: AccountPublic;
      token: string;
      sessionId: string;
    }
  | { ok: false };

type CreatedSession = {
  account: AccountPublic;
  token: string;
  options: AuthCookieOptions;
};

let database: Database | undefined;
let dummyHash: Promise<string> | undefined;

class EmailTaken extends Error {
  constructor() {
    super("email is already registered");
    this.name = "EmailTaken";
  }
}

function db(): Database {
  if (!database) {
    database = createDb();
  }
  return database;
}

export async function closeDatabase(): Promise<void> {
  if (!database) {
    return;
  }
  await database.$client.end({ timeout: 5 });
  database = undefined;
}

function newSessionId(): string {
  return `ses_${randomBytes(16).toString("hex")}`;
}

function requestPath(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    const [path] = request.url.split("?");
    return path ?? request.url;
  }
}

export function logged(request: Request, response: NextResponse): NextResponse {
  const requestId = randomUUID();
  response.headers.set("X-Request-Id", requestId);
  console.log(
    JSON.stringify({
      request_id: requestId,
      method: request.method,
      path: requestPath(request),
      status: response.status,
    }),
  );
  return response;
}

export function errorResponse(error: HttpError): NextResponse {
  return NextResponse.json(error.body, { status: error.status });
}

export function rejectCsrf(request: Request): NextResponse | null {
  if (request.headers.get("x-hp-request") === "1") {
    return null;
  }
  return errorResponse(
    httpError(403, {
      reason: "csrf",
      message: "missing X-HP-Request",
    }),
  );
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const splitAt = part.indexOf("=");
    if (splitAt === -1) {
      continue;
    }
    if (part.slice(0, splitAt).trim() !== name) {
      continue;
    }
    const raw = part.slice(splitAt + 1).trim();
    if (raw.length === 0) {
      return null;
    }
    try {
      return decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  return null;
}

export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function validationMessage(fields: readonly ErrorField[]): string {
  if (fields.length !== 1) {
    return "invalid fields";
  }
  const field = fields[0];
  if (!field) {
    return "invalid fields";
  }
  if (field.path === "email" && field.code === "required") {
    return "email is required";
  }
  if (field.path === "email" && field.code === "too_long") {
    return "email is too long";
  }
  if (field.path === "email" && field.code === "bad_email") {
    return "email is not an email";
  }
  if (field.path === "password" && field.code === "required") {
    return "password is required";
  }
  if (field.path === "password" && field.code === "below_min") {
    return "password is below the minimum length";
  }
  if (field.path === "password" && field.code === "above_max") {
    return "password is above the maximum length";
  }
  if (field.path === "display_name" && field.code === "required") {
    return "display name is required";
  }
  if (field.path === "display_name" && field.code === "too_long") {
    return "display name is too long";
  }
  return "invalid fields";
}

export function validationFailed(fields: readonly ErrorField[]): NextResponse {
  return errorResponse(
    httpError(400, {
      message: validationMessage(fields),
      fields,
    }),
  );
}

export function badCredentialsResponse(): NextResponse {
  return errorResponse(
    httpError(401, {
      reason: "bad_credentials",
      message: BAD_CREDENTIALS_MESSAGE,
    }),
  );
}

export function missingSessionResponse(): NextResponse {
  return errorResponse(
    httpError(401, {
      reason: "missing_session",
      message: "missing session",
    }),
  );
}

export function emailTakenResponse(): NextResponse {
  return errorResponse(
    httpError(409, {
      reason: "email_taken",
      message: "email is already registered",
    }),
  );
}

function emailShape(email: string): boolean {
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@")) {
    return false;
  }
  const domain = email.slice(at + 1);
  if (domain.length === 0 || /\s/.test(email)) {
    return false;
  }
  if (domain.startsWith(".") || domain.endsWith(".")) {
    return false;
  }
  const labels = domain.split(".");
  if (labels.length < 2) {
    return false;
  }
  return labels.every((label) => label.length > 0);
}

function emailField(value: unknown): { field: ErrorField | null; email: string } {
  if (typeof value !== "string") {
    return { field: { path: "email", code: "required" }, email: "" };
  }
  const email = value.trim().toLowerCase();
  if (email.length === 0) {
    return { field: { path: "email", code: "required" }, email };
  }
  if (email.length > EMAIL_MAX) {
    return { field: { path: "email", code: "too_long" }, email };
  }
  if (!emailShape(email)) {
    return { field: { path: "email", code: "bad_email" }, email };
  }
  return { field: null, email };
}

function passwordField(value: unknown): ErrorField | null {
  if (typeof value !== "string") {
    return { path: "password", code: "required" };
  }
  if (value.length < PASSWORD_MIN) {
    return { path: "password", code: "below_min" };
  }
  if (value.length > PASSWORD_MAX) {
    return { path: "password", code: "above_max" };
  }
  return null;
}

function displayNameField(value: unknown): { field: ErrorField | null; displayName: string } {
  if (typeof value !== "string") {
    return { field: { path: "display_name", code: "required" }, displayName: "" };
  }
  const displayName = value.trim();
  if (displayName.length === 0) {
    return { field: { path: "display_name", code: "required" }, displayName };
  }
  if (displayName.length > DISPLAY_NAME_MAX) {
    return { field: { path: "display_name", code: "too_long" }, displayName };
  }
  return { field: null, displayName };
}

export function registrationFields(body: Record<string, unknown>): Registration {
  const email = emailField(body.email);
  const password = passwordField(body.password);
  const displayName = displayNameField(body.display_name);
  const fields = [email.field, password, displayName.field].filter(
    (field): field is ErrorField => field !== null,
  );
  if (fields.length > 0) {
    return { ok: false, fields };
  }
  return {
    ok: true,
    email: email.email,
    password: body.password as string,
    displayName: displayName.displayName,
  };
}

export function signInFields(body: Record<string, unknown>): SignInFields {
  const email = emailField(body.email);
  const password = passwordField(body.password);
  const fields = [email.field, password].filter(
    (field): field is ErrorField => field !== null,
  );
  if (fields.length > 0) {
    return { ok: false, fields };
  }
  return {
    ok: true,
    email: email.email,
    password: body.password as string,
  };
}

const REQUIRED_ACCOUNT_FIELDS: ErrorField[] = [
  { path: "email", code: "required" },
  { path: "password", code: "required" },
  { path: "display_name", code: "required" },
];

const REQUIRED_SIGN_IN_FIELDS: ErrorField[] = [
  { path: "email", code: "required" },
  { path: "password", code: "required" },
];

export function accountResponse(
  account: AccountPublic,
  token: string,
  status: number,
  options: AuthCookieOptions = authCookieOptions(SESSION_COOKIE),
): NextResponse {
  const response = NextResponse.json(
    {
      account: {
        id: account.id,
        email: account.email,
        display_name: account.display_name,
      },
    },
    { status },
  );
  response.cookies.set(SESSION_COOKIE, token, options);
  return response;
}

export function clearedSessionResponse(): NextResponse {
  const response = new NextResponse(null, { status: 204 });
  const secure = process.env.HP_COOKIE_SECURE === "1";
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    maxAge: 0,
    expires: new Date(0),
  });
  return response;
}

function isEmailConflict(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (current instanceof EmailTaken) {
      return true;
    }
    if (typeof current !== "object" || current === null) {
      return false;
    }
    const record = current as {
      code?: unknown;
      constraint_name?: unknown;
      cause?: unknown;
    };
    if (
      record.code === "23505" &&
      record.constraint_name === "accounts_email_unique"
    ) {
      return true;
    }
    current = record.cause;
  }
  return false;
}

async function insertSession(
  accountId: string,
  options: AuthCookieOptions,
): Promise<string> {
  const token = generateCookieToken();
  await db().insert(sessions).values({
    id: newSessionId(),
    accountId,
    tokenHash: hashCookieToken(token),
    expiresAt: options.expires,
  });
  return token;
}

async function createAccount(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<CreatedSession | null> {
  const passwordHash = await hashPassword(input.password);
  const id = generateId("acc_");
  const token = generateCookieToken();
  const options = authCookieOptions(SESSION_COOKIE);
  try {
    await db().transaction(async (tx) => {
      const existing = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.email, input.email))
        .limit(1);
      if (existing.length > 0) {
        throw new EmailTaken();
      }
      await tx.insert(accounts).values({
        id,
        email: input.email,
        passwordHash,
        displayName: input.displayName,
      });
      await tx.insert(sessions).values({
        id: newSessionId(),
        accountId: id,
        tokenHash: hashCookieToken(token),
        expiresAt: options.expires,
      });
    });
  } catch (err) {
    if (isEmailConflict(err)) {
      return null;
    }
    throw err;
  }
  return {
    token,
    options,
    account: {
      id,
      email: input.email,
      display_name: input.displayName,
    },
  };
}

// Unknown emails still run argon2 so both failures do the same password work.
async function dummyVerify(password: string): Promise<void> {
  try {
    if (!dummyHash) {
      dummyHash = hashPassword("hp-dummy-password");
    }
    await verifyPassword(await dummyHash, password);
  } catch {
    dummyHash = undefined;
  }
}

export async function signInAccount(
  email: string,
  password: string,
): Promise<CreatedSession | null> {
  const rows = await db()
    .select({
      id: accounts.id,
      email: accounts.email,
      displayName: accounts.displayName,
      passwordHash: accounts.passwordHash,
    })
    .from(accounts)
    .where(eq(accounts.email, email))
    .limit(1);
  const row = rows[0];
  if (!row) {
    await dummyVerify(password);
    return null;
  }
  const matches = await verifyPassword(row.passwordHash, password);
  if (!matches) {
    return null;
  }
  const options = authCookieOptions(SESSION_COOKIE);
  const token = await insertSession(row.id, options);
  return {
    token,
    options,
    account: {
      id: row.id,
      email: row.email,
      display_name: row.displayName,
    },
  };
}

function instant(value: Date | string): number {
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : 0;
}

export async function readAccountSession(
  token: string | null,
): Promise<AccountSession> {
  if (!token) {
    return { ok: false };
  }
  let tokenHash: string;
  try {
    tokenHash = hashCookieToken(token);
  } catch {
    return { ok: false };
  }
  const rows = await db()
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      id: accounts.id,
      email: accounts.email,
      displayName: accounts.displayName,
    })
    .from(sessions)
    .innerJoin(accounts, eq(accounts.id, sessions.accountId))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);
  const row = rows[0];
  if (!row || instant(row.expiresAt) <= now().getTime()) {
    return { ok: false };
  }
  return {
    ok: true,
    token,
    sessionId: row.sessionId,
    account: {
      id: row.id,
      email: row.email,
      display_name: row.displayName,
    },
  };
}

export async function slideSession(sessionId: string): Promise<AuthCookieOptions> {
  const options = authCookieOptions(SESSION_COOKIE);
  await db()
    .update(sessions)
    .set({ expiresAt: options.expires })
    .where(eq(sessions.id, sessionId));
  return options;
}

export async function clearAccountSession(token: string | null): Promise<void> {
  if (!token) {
    return;
  }
  let tokenHash: string;
  try {
    tokenHash = hashCookieToken(token);
  } catch {
    return;
  }
  await db().delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

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
