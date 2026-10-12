import { asc, eq } from "drizzle-orm";
import { readAccountSession } from "@/server/auth/http";
import type { PlanRole } from "@/server/auth/authorize";
import { accounts, planSteps, planWindows } from "@/server/db/schema";
import {
  asPlanState,
  joinPreview,
  openingBody,
  type JoinCaller,
  type JoinPreview,
  type OpeningBody,
} from "@/server/join/open";
import {
  db,
  loadPlanRow,
  storedCurrency,
  type PlanRow,
} from "@/server/plans/http";
import { planRoleForCookies, type CookieReader } from "@/server/plans/role";

export function asOpeningCaller(role: PlanRole | null): JoinCaller | null {
  if (role === "organizer" || role === "participant" || role === "invited") {
    return role;
  }
  return null;
}

export async function loadJoinPreview(plan: PlanRow): Promise<JoinPreview> {
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

export type PlanJoinPage =
  | { kind: "ok"; opening: OpeningBody; signedIn: boolean }
  | { kind: "not_found" };

export async function loadPlanJoinPage(
  planId: string,
  readCookie: CookieReader,
): Promise<PlanJoinPage> {
  const plan = await loadPlanRow(planId);
  if (!plan) {
    return { kind: "not_found" };
  }

  const caller = asOpeningCaller(await planRoleForCookies(readCookie, plan));
  if (!caller) {
    return { kind: "not_found" };
  }

  const state = asPlanState(plan.state);
  const next = openingBody(plan.id, caller, state, null).next;
  const preview = next === "join" ? await loadJoinPreview(plan) : null;
  const session = await readAccountSession(readCookie("hp_session"));
  return {
    kind: "ok",
    opening: openingBody(plan.id, caller, state, preview),
    signedIn: session.ok,
  };
}
