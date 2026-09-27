import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import {
  logged,
  missingSessionResponse,
  readAccountSession,
  readCookie,
  readJsonObject,
  rejectCsrf,
} from "@/server/auth/http";
import { now } from "@/server/clock";
import { plans } from "@/server/db/schema";
import { generateId, generateJoinToken } from "@/server/ids";
import {
  HOME_LIST_LIMIT,
  REQUIRED_CREATE_FIELDS,
  db,
  insertSteps,
  insertWindows,
  loadOrganizerPlan,
  notFoundResponse,
  parsePlanBody,
  planValidationFailed,
  type ParsedCreate,
} from "@/server/plans/http";
import type { OrganizerPlanView } from "@/server/plans/views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function joinPath(token: string): string {
  return `/join/${token}`;
}

function createResponse(
  view: OrganizerPlanView,
  token: string,
): NextResponse {
  return NextResponse.json(
    {
      ...view,
      join_path: joinPath(token),
    },
    { status: 201 },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const csrf = rejectCsrf(request);
  if (csrf) {
    return logged(request, csrf);
  }

  const session = await readAccountSession(readCookie(request, "hp_session"));
  if (!session.ok) {
    return logged(request, missingSessionResponse());
  }

  const body = await readJsonObject(request);
  if (!body) {
    return logged(request, planValidationFailed(REQUIRED_CREATE_FIELDS));
  }

  const parsed = parsePlanBody(body, "create");
  if (!parsed.ok) {
    return logged(request, planValidationFailed(parsed.fields));
  }
  const created = parsed.value as ParsedCreate;
  const id = generateId("pln_");
  const joinToken = generateJoinToken();
  const createdAt = now();

  await db().transaction(async (tx) => {
    await tx.insert(plans).values({
      id,
      organizerAccountId: session.account.id,
      title: created.title,
      timezone: created.timezone,
      budgetAmountMinor: created.budget.amountMinor,
      currency: created.budget.currency,
      threshold: created.threshold,
      answeredCount: 0,
      state: "collecting",
      joinToken,
      attemptLock: false,
      createdAt,
      updatedAt: createdAt,
    });
    await insertWindows(tx, id, created.windows);
    await insertSteps(tx, id, created.steps);
  });

  const view = await loadOrganizerPlan(id);
  if (!view) {
    return logged(request, notFoundResponse());
  }
  return logged(request, createResponse(view, joinToken));
}

export async function GET(request: Request): Promise<NextResponse> {
  const session = await readAccountSession(readCookie(request, "hp_session"));
  if (!session.ok) {
    return logged(request, missingSessionResponse());
  }

  const rows = await db()
    .select({
      id: plans.id,
      title: plans.title,
      answeredCount: plans.answeredCount,
      threshold: plans.threshold,
      state: plans.state,
    })
    .from(plans)
    .where(eq(plans.organizerAccountId, session.account.id))
    .orderBy(desc(plans.updatedAt), desc(plans.id))
    .limit(HOME_LIST_LIMIT + 1);

  const truncated = rows.length > HOME_LIST_LIMIT;
  const page = truncated ? rows.slice(0, HOME_LIST_LIMIT) : rows;
  return logged(
    request,
    NextResponse.json({
      plans: page.map((row) => ({
        id: row.id,
        title: row.title,
        answered_count: row.answeredCount,
        threshold: row.threshold,
        state: row.state,
      })),
      truncated,
    }),
  );
}
