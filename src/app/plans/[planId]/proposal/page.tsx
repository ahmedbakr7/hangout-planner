import type { ReactElement } from "react";
import { ProposalView } from "@/components/proposal-view";

type ProposalPageProps = {
  params: Promise<{ planId: string }>;
};

export default async function ProposalPage({
  params,
}: ProposalPageProps): Promise<ReactElement> {
  const { planId } = await params;
  return (
    <div className="mx-auto w-full max-w-md bg-background text-foreground">
      <ProposalView planId={planId} />
    </div>
  );
}
