import type { ReactElement } from "react";
import { ConfirmedView } from "@/components/confirmed-view";

type ConfirmedPageProps = {
  params: Promise<{ planId: string }>;
};

export default async function ConfirmedPage({
  params,
}: ConfirmedPageProps): Promise<ReactElement> {
  const { planId } = await params;
  return (
    <div className="mx-auto w-full max-w-md bg-background text-foreground">
      <ConfirmedView planId={planId} />
    </div>
  );
}
