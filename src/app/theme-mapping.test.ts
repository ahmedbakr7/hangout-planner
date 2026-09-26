import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

describe("shadcn theme mapping", () => {
  it("maps DESIGN.md hex into shadcn CSS variables in tokens.css", () => {
    const tokens = read("src/app/tokens.css");
    const mapped: Record<string, string> = {
      background: "#f7f4ef",
      foreground: "#1f1a14",
      card: "#fffcf8",
      "card-foreground": "#1f1a14",
      popover: "#fffcf8",
      "popover-foreground": "#1f1a14",
      primary: "#0e6b4f",
      "primary-foreground": "#fffcf8",
      "muted-foreground": "#6b645b",
      destructive: "#9d2c2c",
      "destructive-foreground": "#fffcf8",
      warning: "#8a5b10",
      "warning-foreground": "#fffcf8",
      success: "#1d6b3a",
      "success-foreground": "#fffcf8",
      border: "#e6dfd4",
      input: "#e6dfd4",
      ring: "#1e4f8c",
    };
    for (const [name, value] of Object.entries(mapped)) {
      expect(tokens).toContain(`--${name}: ${value};`);
    }
    expect(tokens).toContain("--radius: 6px;");
    expect(tokens).toContain(
      "--muted: color-mix(in srgb, var(--background) 72%, var(--border) 28%);",
    );
    expect(tokens).toContain(
      "--secondary: color-mix(in srgb, var(--background) 72%, var(--border) 28%);",
    );
  });

  it("registers semantic utilities in globals.css without a dark theme", () => {
    const globals = read("src/app/globals.css");
    expect(globals).toContain('@import "tailwindcss"');
    expect(globals).toContain("@theme inline");
    expect(globals).toContain("--color-background: var(--background);");
    expect(globals).toContain("--color-primary: var(--primary);");
    expect(globals).toContain("--color-accent: var(--muted);");
    expect(globals).toContain("--color-warning: var(--warning);");
    expect(globals).toContain("--color-success: var(--success);");
    expect(globals).toContain("--color-ring: var(--ring);");
    expect(globals).not.toMatch(/\.dark\b/);
    expect(globals).not.toMatch(/@custom-variant\s+dark/);
    expect(globals).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(globals).not.toMatch(/(?<![\w-])\d+px\b/);
  });

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
