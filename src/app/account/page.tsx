import type { ReactElement } from "react";
import { AccountGate } from "@/components/account-gate";

type AccountPageProps = {
  searchParams: Promise<{ next?: string | string[] }>;
};

export default async function AccountPage({
  searchParams,
}: AccountPageProps): Promise<ReactElement> {
  const params = await searchParams;
  const raw = params.next;
  const next = Array.isArray(raw) ? raw[0] : raw;
  return (
    <div className="mx-auto w-full max-w-md bg-background text-foreground">
      <AccountGate next={next} />
    </div>
  );
}
