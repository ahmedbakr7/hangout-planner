import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactElement } from "react";
import { ProposalView } from "@/components/proposal-view";
import { loadProposalPage } from "@/server/proposal/page-data";

type ProposalPageProps = {
  params: Promise<{ planId: string }>;
};

export default async function ProposalPage({
  params,
}: ProposalPageProps): Promise<ReactElement> {
  const { planId } = await params;
  const jar = await cookies();
  const page = await loadProposalPage(
    planId,
    (name) => jar.get(name)?.value ?? null,
  );
  if (page.kind === "locked") {
    redirect(`/plans/${planId}/confirmed`);
  }
  if (page.kind === "collecting") {
    redirect(`/plans/${planId}`);
  }
  if (page.kind === "not_proposed") {
    redirect(`/plans/${planId}/respond`);
  }
  const initialProposal =
    page.kind === "ok" ? JSON.parse(JSON.stringify(page.view)) : null;
  return (
    <div className="mx-auto w-full max-w-md bg-background text-foreground">
      <ProposalView planId={planId} initialProposal={initialProposal} />
    </div>
  );
}
