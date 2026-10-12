import { desc, eq } from "drizzle-orm";
import { readAccountSession } from "@/server/auth/http";
import { plans } from "@/server/db/schema";
import {
  HOME_LIST_LIMIT,
  assembleOrganizerPlan,
  db,
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

export type HomeListView = {
  plans: {
    id: string;
    title: string;
    answered_count: number;
    threshold: number;
    state: string;
  }[];
  truncated: boolean;
};

export type HomePage =
  | { kind: "ok"; view: HomeListView }
  | { kind: "signed_out" };

export async function loadHomePage(readCookie: CookieReader): Promise<HomePage> {
  const session = await readAccountSession(readCookie("hp_session"));
  if (!session.ok) {
    return { kind: "signed_out" };
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
  return {
    kind: "ok",
    view: {
      plans: page.map((row) => ({
        id: row.id,
        title: row.title,
        answered_count: row.answeredCount,
        threshold: row.threshold,
        state: row.state,
      })),
      truncated,
    },
  };
}
