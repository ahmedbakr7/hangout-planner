import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactElement } from "react";
import { OrganizerPlan } from "@/components/organizer-plan";
import { loadOrganizerPlanPage } from "@/server/plans/page-data";

type OrganizerPlanPageProps = {
  params: Promise<{ planId: string }>;
};

export default async function OrganizerPlanPage({
  params,
}: OrganizerPlanPageProps): Promise<ReactElement> {
  const { planId } = await params;
  const jar = await cookies();
  const page = await loadOrganizerPlanPage(
    planId,
    (name) => jar.get(name)?.value ?? null,
  );
  if (page.kind === "locked") {
    redirect(`/plans/${planId}/confirmed`);
  }
  const initialPlan =
    page.kind === "ok" ? JSON.parse(JSON.stringify(page.view)) : null;
  return (
    <div className="mx-auto w-full max-w-md bg-background text-foreground">
      <OrganizerPlan planId={planId} initialPlan={initialPlan} />
    </div>
  );
}
