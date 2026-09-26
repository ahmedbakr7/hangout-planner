import type { ReactElement } from "react";
import { JoinPanel } from "@/components/join-panel";

type PlanJoinPageProps = {
  params: Promise<{ planId: string }>;
};

export default async function PlanJoinPage({
  params,
}: PlanJoinPageProps): Promise<ReactElement> {
  const { planId } = await params;
  return (
    <div className="mx-auto w-full max-w-md bg-background text-foreground">
      <JoinPanel planId={planId} />
    </div>
  );
}
