import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

describe("shadcn theme mapping", () => {
  it("configures shadcn for App Router CSS variables without a Tailwind v3 config", () => {
    const components = JSON.parse(read("components.json")) as {
      style: string;
      rsc: boolean;
      tailwind: { config: string; css: string; cssVariables: boolean };
    };
    expect(components.rsc).toBe(true);
    expect(components.tailwind.cssVariables).toBe(true);
    expect(components.tailwind.css).toBe("src/app/globals.css");
    expect(components.tailwind.config).toBe("");
    expect(components.style).toBe("new-york");
  });
});
