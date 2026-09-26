import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("joins truthy class names", () => {
    expect(cn("bg-background", false && "hidden", "text-foreground")).toBe(
      "bg-background text-foreground",
    );
  });

  it("merges conflicting Tailwind classes", () => {
    expect(cn("p-4", "p-6")).toBe("p-6");
    expect(cn("bg-primary", "bg-secondary")).toBe("bg-secondary");
  });
});
