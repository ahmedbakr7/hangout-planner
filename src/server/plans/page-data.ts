import {
  assembleOrganizerPlan,
  loadPlanRow,
  storedState,
} from "@/server/plans/http";
import type { OrganizerPlanView } from "@/server/plans/views";
import { planRoleForCookies, type CookieReader } from "@/server/plans/role";

export type OrganizerPlanPage =
  | { kind: "ok"; view: OrganizerPlanView }
  | { kind: "not_found" }
  | { kind: "organizer_only" }
  | { kind: "locked" };

export async function loadOrganizerPlanPage(
  planId: string,
  readCookie: CookieReader,
): Promise<OrganizerPlanPage> {
  const plan = await loadPlanRow(planId);
  if (!plan) {
    return { kind: "not_found" };
  }

  const role = await planRoleForCookies(readCookie, plan);
  if (role !== "organizer") {
    if (role === "participant" || role === "invited" || role === "link_reader") {
      return { kind: "organizer_only" };
    }
    return { kind: "not_found" };
  }
  if (storedState(plan.state) === "locked") {
    return { kind: "locked" };
  }

  return { kind: "ok", view: await assembleOrganizerPlan(plan) };
}
