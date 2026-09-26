import type { ReactElement } from "react";
import { JoinPanel } from "@/components/join-panel";

type JoinByTokenPageProps = {
  params: Promise<{ token: string }>;
};

export default async function JoinByTokenPage({
  params,
}: JoinByTokenPageProps): Promise<ReactElement> {
  const { token } = await params;
  return (
    <div className="mx-auto w-full max-w-md bg-background text-foreground">
      <JoinPanel token={token} />
    </div>
  );
}
