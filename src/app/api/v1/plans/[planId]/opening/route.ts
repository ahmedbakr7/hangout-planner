import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { logged } from "@/server/auth/http";
import type { PlanRole } from "@/server/auth/authorize";
import { accounts, planSteps, planWindows } from "@/server/db/schema";
import {
  asPlanState,
  joinPreview,
  openingBody,
  type JoinCaller,
  type JoinPreview,
} from "@/server/join/open";
import {
  db,
  loadPlanRow,
  notFoundResponse,
  storedCurrency,
  type PlanRow,
} from "@/server/plans/http";
import { planRoleFor } from "@/server/plans/role";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OpeningRouteContext = {
  params: Promise<{ planId: string }>;
};

function asOpeningCaller(
  role: PlanRole | null,
): JoinCaller | null {
  if (role === "organizer" || role === "participant" || role === "invited") {
    return role;
  }
  return null;
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

export async function GET(
  request: Request,
  context: OpeningRouteContext,
): Promise<NextResponse> {
  const { planId } = await context.params;
  const plan = await loadPlanRow(planId);
  if (!plan) {
    return logged(request, notFoundResponse());
  }

  const caller = asOpeningCaller(await planRoleFor(request, plan));
  if (!caller) {
    return logged(request, notFoundResponse());
  }

  const state = asPlanState(plan.state);
  const next = openingBody(plan.id, caller, state, null).next;
  const preview = next === "join" ? await loadJoinPreview(plan) : null;
  return logged(
    request,
    NextResponse.json(openingBody(plan.id, caller, state, preview)),
  );
}
