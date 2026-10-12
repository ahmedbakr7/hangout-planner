import { cookies } from "next/headers";
import type { ReactElement } from "react";
import { InvitationsList } from "@/components/invite-panel";
import { loadInvitationsPage } from "@/server/invites/page-data";

export default async function InvitationsPage(): Promise<ReactElement> {
  const jar = await cookies();
  const page = await loadInvitationsPage(
    (name) => jar.get(name)?.value ?? null,
  );
  const initialInbox =
    page.kind === "ok" ? JSON.parse(JSON.stringify(page.view)) : null;
  return (
    <div className="mx-auto w-full max-w-md bg-background text-foreground">
      <InvitationsList initialInbox={initialInbox} />
    </div>
  );
}
