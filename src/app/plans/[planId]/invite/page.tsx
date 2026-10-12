import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactElement } from "react";
import { InvitePanel } from "@/components/invite-panel";
import { loadInvitePage } from "@/server/invites/page-data";

type InvitePageProps = {
  params: Promise<{ planId: string }>;
};

export default async function InvitePage({
  params,
}: InvitePageProps): Promise<ReactElement> {
  const { planId } = await params;
  const jar = await cookies();
  const page = await loadInvitePage(
    planId,
    (name) => jar.get(name)?.value ?? null,
  );
  if (page.kind === "locked") {
    redirect(`/plans/${planId}/confirmed`);
  }
  const initialInvite =
    page.kind === "ok" ? JSON.parse(JSON.stringify(page.view)) : null;
  return (
    <div className="mx-auto w-full max-w-md bg-background text-foreground">
      <InvitePanel planId={planId} initialInvite={initialInvite} />
    </div>
  );
}
