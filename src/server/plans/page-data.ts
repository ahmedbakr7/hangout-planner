import {
  assembleOrganizerPlan,
  loadPlanRow,
  storedState,
} from "@/server/plans/http";
import { openingNext, type OpeningNext } from "@/server/join/open";
import {
  loadConfirmedDocument,
  type ConfirmedJson,
} from "@/server/plans/confirmed";
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

export type ConfirmedPage =
  | { kind: "ok"; doc: ConfirmedJson }
  | { kind: "not_found" }
  | { kind: "not_locked"; next: OpeningNext | "join" };

export async function loadConfirmedPage(
  planId: string,
  readCookie: CookieReader,
): Promise<ConfirmedPage> {
  const plan = await loadPlanRow(planId);
  if (!plan) {
    return { kind: "not_found" };
  }

  const role = await planRoleForCookies(readCookie, plan);
  if (role === null) {
    return { kind: "not_found" };
  }

  if (storedState(plan.state) !== "locked") {
    const next =
      role === "organizer" || role === "participant" || role === "invited"
        ? openingNext(role, storedState(plan.state))
        : "join";
    return { kind: "not_locked", next };
  }

  return { kind: "ok", doc: await loadConfirmedDocument(plan) };
}
