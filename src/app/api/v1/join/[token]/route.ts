import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { and, asc, count, eq } from "drizzle-orm";
import { authorize, type PlanRole } from "@/server/auth/authorize";
import {
  authCookieOptions,
  generateCookieToken,
  hashCookieToken,
  type AuthCookieOptions,
} from "@/server/auth/session";
import { now } from "@/server/clock";
import { db } from "@/server/join/db";
import {
  accounts,
  guestSessions,
  invitations,
  linkSessionPlans,
  linkSessions,
  participants,
  planSteps,
  planWindows,
  plans,
} from "@/server/db/schema";
import { httpError } from "@/server/http/errors";
import { generateId, isJoinToken } from "@/server/ids";
import { isCurrencyCode, type CurrencyCode } from "@/server/money";
import {
  allocateDistinguisher,
  asPlanState,
  joinConflictError,
  joinDecision,
  joinParticipantView,
  joinPreview,
  openingBody,
  parseJoinBody,
  participantNext,
  takenDistinguishers,
  type JoinCaller,
  type JoinParticipantView,
  type JoinPreview,
  type ParticipantNext,
} from "@/server/join/open";
import {
  errorResponse,
  logged,
  missingSessionResponse,
  readAccountSession,
  readCookie,
  readJsonObject,
  rejectCsrf,
  validationFailed,
} from "@/server/auth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GUEST_COOKIE = "hp_guest" as const;
const LINK_COOKIE = "hp_link" as const;

type Database = ReturnType<typeof db>;
type PlanRow = typeof plans.$inferSelect;
type JoinRouteContext = {
  params: Promise<{ token: string }>;
};

type GuestSession =
  | { ok: true; id: string; token: string }
  | { ok: false };

type ParticipantRow = {
  id: string;
  displayName: string;
  distinguisher: string;
};

function newGuestSessionId(): string {
  return `gst_${randomBytes(16).toString("hex")}`;
}

function newLinkSessionId(): string {
  return `lnk_${randomBytes(16).toString("hex")}`;
}

function cookieTokenHash(token: string | null): string | null {
  if (!token) {
    return null;
  }
  try {
    return hashCookieToken(token);
  } catch {
    return null;
  }
}

function isFuture(value: Date | string): boolean {
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) && time > now().getTime();
}

function presentedToken(raw: string | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function storedCurrency(value: string): CurrencyCode {
  if (isCurrencyCode(value)) {
    return value;
  }
  return "EGP";
}

function asCaller(role: PlanRole): JoinCaller {
  return role;
}

function notFoundResponse(): NextResponse {
  return errorResponse(httpError(404, { message: "unknown join token" }));
}

function loggedJoin(request: Request, response: NextResponse): NextResponse {
  return logged(new Request("http://localhost/v1/join", { method: request.method }), response);
}

function setAuthCookie(
  response: NextResponse,
  name: typeof GUEST_COOKIE | typeof LINK_COOKIE,
  token: string,
  options: AuthCookieOptions,
): NextResponse {
  response.cookies.set(name, token, options);
  return response;
}

function openingResponse(
  body: ReturnType<typeof openingBody>,
  link: { token: string; options: AuthCookieOptions },
): NextResponse {
  const response = NextResponse.json(body);
  return setAuthCookie(response, LINK_COOKIE, link.token, link.options);
}

function joinResponse(
  participant: JoinParticipantView,
  next: ParticipantNext,
  status: 200 | 201,
  guest?: { token: string; options: AuthCookieOptions },
): NextResponse {
  const response = NextResponse.json({ participant, next }, { status });
  if (guest) {
    return setAuthCookie(response, GUEST_COOKIE, guest.token, guest.options);
  }
  return response;
}

function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current !== "object" || current === null) {
      return false;
    }
    const record = current as { code?: unknown; cause?: unknown };
    if (record.code === "23505") {
      return true;
    }
    current = record.cause;
  }
  return false;
}

async function loadPlanByToken(token: string): Promise<PlanRow | null> {
  if (!isJoinToken(token)) {
    return null;
  }
  const rows = await db()
    .select()
    .from(plans)
    .where(eq(plans.joinToken, token))
    .limit(1);
  return rows[0] ?? null;
}

async function accountParticipates(
  planId: string,
  accountId: string,
): Promise<boolean> {
  const rows = await db()
    .select({ id: participants.id })
    .from(participants)
    .where(
      and(eq(participants.planId, planId), eq(participants.accountId, accountId)),
    )
    .limit(1);
  return rows.length > 0;
}

async function accountInvited(
  planId: string,
  accountId: string,
): Promise<boolean> {
  const rows = await db()
    .select({ id: invitations.id })
    .from(invitations)
    .where(
      and(eq(invitations.planId, planId), eq(invitations.accountId, accountId)),
    )
    .limit(1);
  return rows.length > 0;
}

async function readGuestSession(token: string | null): Promise<GuestSession> {
  const hash = cookieTokenHash(token);
  if (!hash) {
    return { ok: false };
  }
  const rows = await db()
    .select({
      id: guestSessions.id,
      expiresAt: guestSessions.expiresAt,
    })
    .from(guestSessions)
    .where(eq(guestSessions.tokenHash, hash))
    .limit(1);
  const row = rows[0];
  if (!row || !isFuture(row.expiresAt) || !token) {
    return { ok: false };
  }
  return { ok: true, id: row.id, token };
}

async function guestOwnsParticipant(
  request: Request,
  planId: string,
): Promise<boolean> {
  const guest = await readGuestSession(readCookie(request, GUEST_COOKIE));
  if (!guest.ok) {
    return false;
  }
  const rows = await db()
    .select({ id: participants.id })
    .from(participants)
    .where(
      and(
        eq(participants.planId, planId),
        eq(participants.guestSessionId, guest.id),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function linkIncludesPlan(
  request: Request,
  planId: string,
): Promise<boolean> {
  const hash = cookieTokenHash(readCookie(request, LINK_COOKIE));
  if (!hash) {
    return false;
  }
  const rows = await db()
    .select({ expiresAt: linkSessions.expiresAt })
    .from(linkSessions)
    .innerJoin(
      linkSessionPlans,
      eq(linkSessionPlans.linkSessionId, linkSessions.id),
    )
    .where(
      and(eq(linkSessions.tokenHash, hash), eq(linkSessionPlans.planId, planId)),
    )
    .limit(1);
  const row = rows[0];
  return Boolean(row && isFuture(row.expiresAt));
}

async function planRoleFor(
  request: Request,
  plan: PlanRow,
  joinToken: string,
): Promise<PlanRole | null> {
  const session = await readAccountSession(readCookie(request, "hp_session"));
  const sessionAccountId = session.ok ? session.account.id : null;
  const accountHasParticipant =
    sessionAccountId !== null
      ? await accountParticipates(plan.id, sessionAccountId)
      : false;
  const accountHasInvitation =
    sessionAccountId !== null
      ? await accountInvited(plan.id, sessionAccountId)
      : false;
  return authorize({
    sessionAccountId,
    organizerAccountId: plan.organizerAccountId,
    accountHasParticipant,
    guestOwnsParticipant: await guestOwnsParticipant(request, plan.id),
    accountHasInvitation,
    linkIncludesPlan: await linkIncludesPlan(request, plan.id),
    requestJoinToken: joinToken,
    planJoinToken: plan.joinToken,
  });
}

async function loadJoinPreview(plan: PlanRow): Promise<JoinPreview> {
  const organizerRows = await db()
    .select({ displayName: accounts.displayName })
    .from(accounts)
    .where(eq(accounts.id, plan.organizerAccountId))
    .limit(1);
  const windowRows = await db()
    .select({
      localDate: planWindows.localDate,
      startLocal: planWindows.startLocal,
      endLocal: planWindows.endLocal,
    })
    .from(planWindows)
    .where(eq(planWindows.planId, plan.id))
    .orderBy(asc(planWindows.position));
  const stepRows = await db()
    .select({ name: planSteps.name })
    .from(planSteps)
    .where(eq(planSteps.planId, plan.id))
    .orderBy(asc(planSteps.position));
  return joinPreview({
    title: plan.title,
    organizer_display_name: organizerRows[0]?.displayName ?? "",
    timezone: plan.timezone,
    windows: windowRows.map((window) => ({
      local_date: window.localDate,
      start_local: window.startLocal,
      end_local: window.endLocal,
    })),
    budget: {
      amount_minor: plan.budgetAmountMinor,
      currency: storedCurrency(plan.currency),
    },
    step_names: stepRows.map((step) => step.name),
  });
}

async function attachLink(
  request: Request,
  planId: string,
): Promise<{ token: string; options: AuthCookieOptions }> {
  const options = authCookieOptions(LINK_COOKIE);
  const existingToken = readCookie(request, LINK_COOKIE);
  const hash = cookieTokenHash(existingToken);
  if (hash && existingToken) {
    const rows = await db()
      .select({
        id: linkSessions.id,
        expiresAt: linkSessions.expiresAt,
      })
      .from(linkSessions)
      .where(eq(linkSessions.tokenHash, hash))
      .limit(1);
    const row = rows[0];
    if (row && isFuture(row.expiresAt)) {
      await db()
        .update(linkSessions)
        .set({ expiresAt: options.expires })
        .where(eq(linkSessions.id, row.id));
      await db()
        .insert(linkSessionPlans)
        .values({ linkSessionId: row.id, planId })
        .onConflictDoNothing();
      return { token: existingToken, options };
    }
  }

  const token = generateCookieToken();
  const id = newLinkSessionId();
  await db().insert(linkSessions).values({
    id,
    tokenHash: hashCookieToken(token),
    expiresAt: options.expires,
  });
  await db().insert(linkSessionPlans).values({
    linkSessionId: id,
    planId,
  });
  return { token, options };
}

async function findAccountParticipant(
  planId: string,
  accountId: string,
): Promise<ParticipantRow | null> {
  const rows = await db()
    .select({
      id: participants.id,
      displayName: participants.displayName,
      distinguisher: participants.distinguisher,
    })
    .from(participants)
    .where(
      and(eq(participants.planId, planId), eq(participants.accountId, accountId)),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function findGuestParticipant(
  planId: string,
  guestSessionId: string,
): Promise<ParticipantRow | null> {
  const rows = await db()
    .select({
      id: participants.id,
      displayName: participants.displayName,
      distinguisher: participants.distinguisher,
    })
    .from(participants)
    .where(
      and(
        eq(participants.planId, planId),
        eq(participants.guestSessionId, guestSessionId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function participantCount(planId: string): Promise<number> {
  const rows = await db()
    .select({ value: count() })
    .from(participants)
    .where(eq(participants.planId, planId));
  return Number(rows[0]?.value ?? 0);
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function lockPlan(tx: Transaction, planId: string): Promise<PlanRow | null> {
  const rows = await tx
    .select()
    .from(plans)
    .where(eq(plans.id, planId))
    .for("update");
  return rows[0] ?? null;
}

async function takenOnPlan(tx: Transaction, planId: string): Promise<Set<string>> {
  const participantRows = await tx
    .select({
      distinguisher: participants.distinguisher,
      accountId: participants.accountId,
    })
    .from(participants)
    .where(eq(participants.planId, planId));
  const invitationRows = await tx
    .select({
      distinguisher: invitations.distinguisher,
      accountId: invitations.accountId,
    })
    .from(invitations)
    .where(eq(invitations.planId, planId));
  const joinedAccounts = new Set(
    participantRows
      .map((row) => row.accountId)
      .filter((id): id is string => typeof id === "string"),
  );
  const pending = invitationRows
    .filter((row) => !joinedAccounts.has(row.accountId))
    .map((row) => row.distinguisher);
  return takenDistinguishers(
    participantRows.map((row) => row.distinguisher),
    pending,
  );
}

type InsertedJoin = {
  participant: ParticipantRow;
  created: boolean;
  guest?: { token: string; options: AuthCookieOptions };
};

async function insertJoin(input: {
  planId: string;
  displayName: string;
  accountId: string | null;
  guest: GuestSession;
}): Promise<InsertedJoin> {
  const guestOptions = authCookieOptions(GUEST_COOKIE);
  return db().transaction(async (tx) => {
    const plan = await lockPlan(tx, input.planId);
    if (!plan) {
      throw new Error("plan missing during join");
    }

    const existing = input.accountId
      ? (
          await tx
            .select({
              id: participants.id,
              displayName: participants.displayName,
              distinguisher: participants.distinguisher,
            })
            .from(participants)
            .where(
              and(
                eq(participants.planId, input.planId),
                eq(participants.accountId, input.accountId),
              ),
            )
            .limit(1)
        )[0]
      : input.guest.ok
        ? (
            await tx
              .select({
                id: participants.id,
                displayName: participants.displayName,
                distinguisher: participants.distinguisher,
              })
              .from(participants)
              .where(
                and(
                  eq(participants.planId, input.planId),
                  eq(participants.guestSessionId, input.guest.id),
                ),
              )
              .limit(1)
          )[0]
        : undefined;
    if (existing) {
      return { participant: existing, created: false };
    }

    const countRows = await tx
      .select({ value: count() })
      .from(participants)
      .where(eq(participants.planId, input.planId));
    const decision = joinDecision({
      isOrganizer:
        input.accountId !== null && input.accountId === plan.organizerAccountId,
      locked: asPlanState(plan.state) === "locked",
      alreadyParticipant: false,
      participantCount: Number(countRows[0]?.value ?? 0),
    });
    if (decision.action === "conflict") {
      throw Object.assign(new Error(decision.reason), {
        joinConflict: decision.reason,
      });
    }

    let guestSessionId: string | null = null;
    let guestToken: string | undefined;
    if (input.accountId === null) {
      if (input.guest.ok) {
        guestSessionId = input.guest.id;
        guestToken = input.guest.token;
        await tx
          .update(guestSessions)
          .set({ expiresAt: guestOptions.expires })
          .where(eq(guestSessions.id, guestSessionId));
      } else {
        guestSessionId = newGuestSessionId();
        guestToken = generateCookieToken();
        await tx.insert(guestSessions).values({
          id: guestSessionId,
          tokenHash: hashCookieToken(guestToken),
          expiresAt: guestOptions.expires,
        });
      }
    }

    const distinguisher = allocateDistinguisher(
      await takenOnPlan(tx, input.planId),
    );
    const row: ParticipantRow = {
      id: generateId("prt_"),
      displayName: input.displayName,
      distinguisher,
    };
    try {
      await tx.insert(participants).values({
        id: row.id,
        planId: input.planId,
        accountId: input.accountId,
        guestSessionId,
        displayName: input.displayName,
        distinguisher,
      });
    } catch (err) {
      if (input.accountId && isUniqueViolation(err)) {
        const raced = await tx
          .select({
            id: participants.id,
            displayName: participants.displayName,
            distinguisher: participants.distinguisher,
          })
          .from(participants)
          .where(
            and(
              eq(participants.planId, input.planId),
              eq(participants.accountId, input.accountId),
            ),
          )
          .limit(1);
        if (raced[0]) {
          return { participant: raced[0], created: false };
        }
      }
      throw err;
    }
    return {
      participant: row,
      created: true,
      guest:
        guestToken !== undefined
          ? { token: guestToken, options: guestOptions }
          : undefined,
    };
  });
}

type JoinConflict = { joinConflict: "organizer_cannot_join" | "plan_locked" | "plan_full" };

function isJoinConflict(err: unknown): err is JoinConflict {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const reason = (err as { joinConflict?: unknown }).joinConflict;
  return (
    reason === "organizer_cannot_join" ||
    reason === "plan_locked" ||
    reason === "plan_full"
  );
}

export async function GET(
  request: Request,
  context: JoinRouteContext,
): Promise<NextResponse> {
  const token = presentedToken((await context.params).token);
  if (!token) {
    return loggedJoin(request, notFoundResponse());
  }

  const plan = await loadPlanByToken(token);
  if (!plan) {
    return loggedJoin(request, notFoundResponse());
  }

  const role = await planRoleFor(request, plan, token);
  if (!role) {
    return loggedJoin(request, notFoundResponse());
  }

  const state = asPlanState(plan.state);
  const next = openingBody(plan.id, asCaller(role), state, null).next;
  const preview =
    next === "join" ? await loadJoinPreview(plan) : null;
  const body = openingBody(plan.id, asCaller(role), state, preview);
  const link = await attachLink(request, plan.id);
  return loggedJoin(request, openingResponse(body, link));
}

export async function POST(
  request: Request,
  context: JoinRouteContext,
): Promise<NextResponse> {
  const csrf = rejectCsrf(request);
  if (csrf) {
    return loggedJoin(request, csrf);
  }

  const token = presentedToken((await context.params).token);
  if (!token) {
    return loggedJoin(request, notFoundResponse());
  }

  const plan = await loadPlanByToken(token);
  if (!plan) {
    return loggedJoin(request, notFoundResponse());
  }

  const role = await planRoleFor(request, plan, token);
  if (!role) {
    return loggedJoin(request, notFoundResponse());
  }

  const raw = await readJsonObject(request);
  if (!raw) {
    return loggedJoin(
      request,
      validationFailed([{ path: "kind", code: "required" }]),
    );
  }
  const parsed = parseJoinBody(raw);
  if (!parsed.ok) {
    return loggedJoin(request, validationFailed(parsed.fields));
  }

  const account = await readAccountSession(readCookie(request, "hp_session"));
  if (parsed.kind === "account" && !account.ok) {
    return loggedJoin(request, missingSessionResponse());
  }

  const guest = await readGuestSession(readCookie(request, GUEST_COOKIE));
  const isOrganizer = account.ok && account.account.id === plan.organizerAccountId;
  const existing =
    parsed.kind === "account" && account.ok
      ? await findAccountParticipant(plan.id, account.account.id)
      : guest.ok
        ? await findGuestParticipant(plan.id, guest.id)
        : null;

  const state = asPlanState(plan.state);
  const decision = joinDecision({
    isOrganizer,
    locked: state === "locked",
    alreadyParticipant: existing !== null,
    participantCount: existing ? 0 : await participantCount(plan.id),
  });
  if (decision.action === "conflict") {
    return loggedJoin(request, errorResponse(joinConflictError(decision.reason)));
  }
  if (decision.action === "existing" && existing) {
    return loggedJoin(
      request,
      joinResponse(joinParticipantView(existing), participantNext(state), 200),
    );
  }

  try {
    const inserted = await insertJoin({
      planId: plan.id,
      displayName:
        parsed.kind === "account" && account.ok
          ? account.account.display_name
          : parsed.kind === "anonymous"
            ? parsed.displayName
            : "",
      accountId:
        parsed.kind === "account" && account.ok ? account.account.id : null,
      guest: parsed.kind === "anonymous" ? guest : { ok: false },
    });
    const status = inserted.created ? 201 : 200;
    return loggedJoin(
      request,
      joinResponse(
        joinParticipantView(inserted.participant),
        participantNext(state),
        status,
        status === 201 ? inserted.guest : undefined,
      ),
    );
  } catch (err) {
    if (isJoinConflict(err)) {
      return loggedJoin(request, errorResponse(joinConflictError(err.joinConflict)));
    }
    throw err;
  }
}
