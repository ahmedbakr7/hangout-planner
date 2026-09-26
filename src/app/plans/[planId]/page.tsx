import type { ReactElement } from "react";
import { OrganizerPlan } from "@/components/organizer-plan";

type OrganizerPlanPageProps = {
  params: Promise<{ planId: string }>;
};

export default async function OrganizerPlanPage({
  params,
}: OrganizerPlanPageProps): Promise<ReactElement> {
  const { planId } = await params;
  return (
    <div className="mx-auto w-full max-w-md bg-background text-foreground">
      <OrganizerPlan planId={planId} />
    </div>
  );
}
