import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactElement } from "react";
import { JoinPanel } from "@/components/join-panel";
import { planPath } from "@/lib/plan-paths";
import { loadPlanJoinPage } from "@/server/join/page-data";

type PlanJoinPageProps = {
  params: Promise<{ planId: string }>;
};

export default async function PlanJoinPage({
  params,
}: PlanJoinPageProps): Promise<ReactElement> {
  const { planId } = await params;
  const jar = await cookies();
  const page = await loadPlanJoinPage(
    planId,
    (name) => jar.get(name)?.value ?? null,
  );
  if (page.kind === "ok" && page.opening.next !== "join") {
    redirect(planPath(planId, page.opening.next));
  }
  const initialOpening =
    page.kind === "ok" ? JSON.parse(JSON.stringify(page.opening)) : null;
  return (
    <div className="mx-auto w-full max-w-md bg-background text-foreground">
      <JoinPanel
        planId={planId}
        initialOpening={initialOpening}
        initialSignedIn={page.kind === "ok" ? page.signedIn : false}
      />
    </div>
  );
}
