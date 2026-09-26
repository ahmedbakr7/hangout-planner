import type { ReactElement } from "react";
import { InvitePanel } from "@/components/invite-panel";

type InvitePageProps = {
  params: Promise<{ planId: string }>;
};

export default async function InvitePage({
  params,
}: InvitePageProps): Promise<ReactElement> {
  const { planId } = await params;
  return (
    <div className="mx-auto w-full max-w-md bg-background text-foreground">
      <InvitePanel planId={planId} />
    </div>
  );
}
