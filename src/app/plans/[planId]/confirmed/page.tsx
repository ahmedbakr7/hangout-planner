import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactElement } from "react";
import { ConfirmedView } from "@/components/confirmed-view";
import { planPath } from "@/lib/plan-paths";
import { loadConfirmedPage } from "@/server/plans/page-data";

type ConfirmedPageProps = {
  params: Promise<{ planId: string }>;
};

export default async function ConfirmedPage({
  params,
}: ConfirmedPageProps): Promise<ReactElement> {
  const { planId } = await params;
  const jar = await cookies();
  const page = await loadConfirmedPage(
    planId,
    (name) => jar.get(name)?.value ?? null,
  );
  if (page.kind === "not_locked") {
    redirect(planPath(planId, page.next));
  }
  const initialDoc =
    page.kind === "ok" ? JSON.parse(JSON.stringify(page.doc)) : null;
  return (
    <div className="mx-auto w-full max-w-md bg-background text-foreground">
      <ConfirmedView planId={planId} initialDoc={initialDoc} />
    </div>
  );
}
