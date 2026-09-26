import type { ReactElement } from "react";
import { HomeList } from "@/components/home-list";

export default function HomePage(): ReactElement {
  return (
    <div className="mx-auto w-full max-w-md bg-background text-foreground">
      <HomeList />
    </div>
  );
}
