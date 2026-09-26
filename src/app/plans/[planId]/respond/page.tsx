import type { ReactElement } from "react";
import { ResponseForm } from "@/components/response-form";

type RespondPageProps = {
  params: Promise<{ planId: string }>;
};

export default async function RespondPage({
  params,
}: RespondPageProps): Promise<ReactElement> {
  const { planId } = await params;
  return (
    <div className="mx-auto w-full max-w-md bg-background text-foreground">
      <ResponseForm planId={planId} />
    </div>
  );
}
