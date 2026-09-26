import type { ReactElement } from "react";
import { InvitationsList } from "@/components/invite-panel";

export default function InvitationsPage(): ReactElement {
  return (
    <div className="mx-auto w-full max-w-md bg-background text-foreground">
      <InvitationsList />
    </div>
  );
}
