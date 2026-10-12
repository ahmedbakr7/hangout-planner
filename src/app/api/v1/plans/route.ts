import { NextResponse } from "next/server";
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
import { loadHomePage } from "@/server/plans/page-data";
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
  const page = await loadHomePage((name) => readCookie(request, name));
  if (page.kind === "signed_out") {
    return logged(request, missingSessionResponse());
  }
  return logged(request, NextResponse.json(page.view));
}
