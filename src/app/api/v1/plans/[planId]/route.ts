import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { LOCALE_COOKIE, localeFromCookie } from "@/i18n/request";
import { logged, readCookie, readJsonObject, rejectCsrf } from "@/server/auth/http";
import type { PlanRole } from "@/server/auth/authorize";
import { now } from "@/server/clock";
import { plans } from "@/server/db/schema";
import { validatePlanPatch } from "@/server/plans/edit-rules";
import {
  db,
  fieldFrozenResponse,
  loadOrganizerPlan,
  loadPlanRow,
  notFoundResponse,
  organizerOnlyResponse,
  parsePlanBody,
  planLockedResponse,
  planPatchFromBody,
  planValidationFailed,
  replaceSteps,
  replaceWindows,
  storedCurrency,
  storedState,
  type ParsedPatch,
} from "@/server/plans/http";
import { loadOrganizerPlanPage } from "@/server/plans/page-data";
import { planRoleFor } from "@/server/plans/role";
import {
  applyHourFullVenueData,
  attemptInProgressResponse,
  runTriggeredAttempt,
} from "@/server/proposal/trigger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PlanRouteContext = {
  params: Promise<{ planId: string }>;
};

function attemptLanguage(request: Request): "ar" | "en" {
  return localeFromCookie(readCookie(request, LOCALE_COOKIE) ?? undefined);
}

function rejectNonOrganizer(role: PlanRole | null): NextResponse | null {
  if (role === "organizer") {
    return null;
  }
  if (role === "participant" || role === "invited" || role === "link_reader") {
    return organizerOnlyResponse();
  }
  return notFoundResponse();
}

function hasPlanWrite(patch: ParsedPatch): boolean {
  return (
    patch.title !== undefined ||
    patch.timezone !== undefined ||
    patch.windows !== undefined ||
    patch.budget !== undefined ||
    patch.steps !== undefined ||
    patch.threshold !== undefined
  );
}

async function applyPlanPatch(
  planId: string,
  patch: ParsedPatch,
): Promise<void> {
  await db().transaction(async (tx) => {
    const fields: {
      title?: string;
      timezone?: string;
      budgetAmountMinor?: number;
      currency?: string;
      threshold?: number;
      updatedAt: Date;
    } = { updatedAt: now() };
    if (patch.title !== undefined) {
      fields.title = patch.title;
    }
    if (patch.timezone !== undefined) {
      fields.timezone = patch.timezone;
    }
    if (patch.budget !== undefined) {
      fields.budgetAmountMinor = patch.budget.amountMinor;
      fields.currency = patch.budget.currency;
    }
    if (patch.threshold !== undefined) {
      fields.threshold = patch.threshold;
    }
    await tx.update(plans).set(fields).where(eq(plans.id, planId));
    if (patch.windows !== undefined) {
      await replaceWindows(tx, planId, patch.windows);
    }
    if (patch.steps !== undefined) {
      await replaceSteps(tx, planId, patch.steps);
    }
  });
}

export async function GET(
  request: Request,
  context: PlanRouteContext,
): Promise<NextResponse> {
  const { planId } = await context.params;
  const page = await loadOrganizerPlanPage(planId, (name) =>
    readCookie(request, name),
  );
  switch (page.kind) {
    case "not_found":
      return logged(request, notFoundResponse());
    case "organizer_only":
      return logged(request, organizerOnlyResponse());
    case "locked":
      return logged(request, planLockedResponse());
    case "ok":
      return logged(request, NextResponse.json(page.view));
  }
}

export async function PATCH(
  request: Request,
  context: PlanRouteContext,
): Promise<NextResponse> {
  const csrf = rejectCsrf(request);
  if (csrf) {
    return logged(request, csrf);
  }

  const { planId } = await context.params;
  const plan = await loadPlanRow(planId);
  if (!plan) {
    return logged(request, notFoundResponse());
  }

  const denied = rejectNonOrganizer(await planRoleFor(request, plan));
  if (denied) {
    return logged(request, denied);
  }
  if (storedState(plan.state) === "locked") {
    return logged(request, planLockedResponse());
  }

  const body = (await readJsonObject(request)) ?? {};
  const freeze = validatePlanPatch(
    {
      state: storedState(plan.state),
      answeredCount: plan.answeredCount,
      budget: {
        amountMinor: plan.budgetAmountMinor,
        currency: storedCurrency(plan.currency),
      },
      threshold: plan.threshold,
    },
    planPatchFromBody(body),
  );
  if (!freeze.ok) {
    return logged(request, fieldFrozenResponse(freeze.error));
  }

  const parsed = parsePlanBody(body, "patch");
  if (!parsed.ok) {
    return logged(request, planValidationFailed(parsed.fields));
  }

  if (hasPlanWrite(parsed.value)) {
    await applyPlanPatch(plan.id, parsed.value);
  }

  const priorState = storedState(plan.state);
  const shouldAttempt =
    hasPlanWrite(parsed.value) &&
    ((priorState === "collecting" &&
      parsed.value.threshold !== undefined &&
      parsed.value.threshold === plan.answeredCount) ||
      (priorState === "blocked" && parsed.value.budget !== undefined));
  if (shouldAttempt) {
    const triggered = await runTriggeredAttempt(
      plan.id,
      attemptLanguage(request),
    );
    if (triggered.status === "hour_full") {
      await applyHourFullVenueData(plan.id);
    } else if (triggered.status === "attempt_in_progress") {
      return logged(request, attemptInProgressResponse());
    }
  }

  const view = await loadOrganizerPlan(plan.id);
  if (!view) {
    return logged(request, notFoundResponse());
  }
  return logged(request, NextResponse.json(view));
}
