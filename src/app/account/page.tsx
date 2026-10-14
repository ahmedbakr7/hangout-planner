import { cookies } from "next/headers";
import type { ReactElement } from "react";
import { AccountGate } from "@/components/account-gate";
import { loadAccountPage } from "@/server/auth/page-data";

type AccountPageProps = {
  searchParams: Promise<{ next?: string | string[] }>;
};

export default async function AccountPage({
  searchParams,
}: AccountPageProps): Promise<ReactElement> {
  const params = await searchParams;
  const raw = params.next;
  const next = Array.isArray(raw) ? raw[0] : raw;
  const jar = await cookies();
  const page = await loadAccountPage((name) => jar.get(name)?.value ?? null);
  const initialAccount =
    page.kind === "ok" ? JSON.parse(JSON.stringify(page.view)) : null;
  return (
    <div className="mx-auto w-full max-w-md bg-background text-foreground">
      <AccountGate next={next} initialAccount={initialAccount} />
    </div>
  );
}
