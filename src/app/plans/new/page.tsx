import { cookies } from "next/headers";
import type { ReactElement } from "react";
import { CreateForm } from "@/components/create-form";
import { loadCreatePlanPage } from "@/server/plans/page-data";

export default async function CreatePlanPage(): Promise<ReactElement> {
  const jar = await cookies();
  const page = await loadCreatePlanPage((name) => jar.get(name)?.value ?? null);
  const initialCurrencies =
    page.kind === "ok" ? JSON.parse(JSON.stringify(page.view)) : null;
  return (
    <div className="mx-auto w-full max-w-md bg-background text-foreground">
      <CreateForm initialCurrencies={initialCurrencies} />
    </div>
  );
}
