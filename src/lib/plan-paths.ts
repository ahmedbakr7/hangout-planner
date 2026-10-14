export type PlanNext =
  | "organizer"
  | "respond"
  | "proposal"
  | "confirmed"
  | "join";

export function planPath(planId: string, next: PlanNext): string {
  if (next === "organizer") {
    return `/plans/${planId}`;
  }
  return `/plans/${planId}/${next}`;
}
