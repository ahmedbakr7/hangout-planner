import { cookies } from "next/headers";
import type { ReactElement } from "react";
import { HomeList } from "@/components/home-list";
import { loadHomePage } from "@/server/plans/page-data";

export default async function HomePage(): Promise<ReactElement> {
  const jar = await cookies();
  const page = await loadHomePage((name) => jar.get(name)?.value ?? null);
  const initialPlans =
    page.kind === "ok" ? JSON.parse(JSON.stringify(page.view)) : null;
  return (
    <div className="mx-auto w-full max-w-md bg-background text-foreground">
      <HomeList initialPlans={initialPlans} />
    </div>
  );
}
