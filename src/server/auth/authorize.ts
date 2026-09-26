import { timingSafeEqual } from "node:crypto";

export const PLAN_ROLES = [
  "organizer",
  "participant",
  "invited",
  "link_reader",
] as const;

export type PlanRole = (typeof PLAN_ROLES)[number];

export type PlanAuthzFacts = {
  sessionAccountId: string | null;
  organizerAccountId: string;
  accountHasParticipant: boolean;
  guestOwnsParticipant: boolean;
  accountHasInvitation: boolean;
  linkIncludesPlan: boolean;
  requestJoinToken: string | null;
  planJoinToken: string | null;
};

function presentAccount(id: string | null): string | null {
  if (typeof id !== "string" || id.length === 0) {
    return null;
  }
  return id;
}

function sameJoinToken(
  requestToken: string | null,
  planToken: string | null,
): boolean {
  if (typeof requestToken !== "string" || typeof planToken !== "string") {
    return false;
  }
  if (requestToken.length === 0 || requestToken.length !== planToken.length) {
    return false;
  }
  const left = Buffer.from(requestToken, "utf8");
  const right = Buffer.from(planToken, "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

/** First match wins: organizer, participant, invited, link reader. Otherwise no role. */
export function authorize(facts: PlanAuthzFacts): PlanRole | null {
  const accountId = presentAccount(facts.sessionAccountId);
  if (accountId !== null && accountId === facts.organizerAccountId) {
    return "organizer";
  }
  if (
    (accountId !== null && facts.accountHasParticipant === true) ||
    facts.guestOwnsParticipant === true
  ) {
    return "participant";
  }
  if (accountId !== null && facts.accountHasInvitation === true) {
    return "invited";
  }
  const presentedJoinToken = sameJoinToken(
    facts.requestJoinToken,
    facts.planJoinToken,
  );
  if (facts.linkIncludesPlan === true || presentedJoinToken) {
    return "link_reader";
  }
  return null;
}
