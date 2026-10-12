import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactElement } from "react";
import { ResponseForm } from "@/components/response-form";
import { loadResponsePage } from "@/server/response/page-data";

type RespondPageProps = {
  params: Promise<{ planId: string }>;
};

export default async function RespondPage({
  params,
}: RespondPageProps): Promise<ReactElement> {
  const { planId } = await params;
  const jar = await cookies();
  const page = await loadResponsePage(
    planId,
    (name) => jar.get(name)?.value ?? null,
  );
  if (page.kind === "proposed") {
    redirect(`/plans/${planId}/proposal`);
  }
  if (page.kind === "locked") {
    redirect(`/plans/${planId}/confirmed`);
  }
  const initialResponse =
    page.kind === "ok" ? JSON.parse(JSON.stringify(page.view)) : null;
  return (
    <div className="mx-auto w-full max-w-md bg-background text-foreground">
      <ResponseForm planId={planId} initialResponse={initialResponse} />
    </div>
  );
}
