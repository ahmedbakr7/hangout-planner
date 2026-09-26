import type { ReactElement } from "react";
import { CreateForm } from "@/components/create-form";

export default function CreatePlanPage(): ReactElement {
  return (
    <div className="mx-auto w-full max-w-md bg-background text-foreground">
      <CreateForm />
    </div>
  );
}
