import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

const root = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".git") continue;
      walkFiles(full, out);
    } else if (/\.(css|tsx|ts|jsx|js)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const DESIGN_COLOR_TOKENS: Record<string, string> = {
  bg: "#f7f4ef",
  surface: "#fffcf8",
  text: "#1f1a14",
  "text-muted": "#6b645b",
  border: "#e6dfd4",
  accent: "#0e6b4f",
  danger: "#9d2c2c",
  warning: "#8a5b10",
  success: "#1d6b3a",
  focus: "#1e4f8c",
};

const DESIGN_SPACE_TOKENS: Record<string, string> = {
  "space-2xs": "4px",
  "space-xs": "8px",
  "space-sm": "12px",
  "space-md": "16px",
  "space-lg": "24px",
  "space-xl": "40px",
};

const DESIGN_RADIUS_TOKENS: Record<string, string> = {
  "radius-sm": "6px",
  "radius-md": "12px",
};

const DESIGN_TYPE_TOKENS: Record<string, string> = {
  "type-title-size": "1.75rem",
  "type-title-leading": "2.125rem",
  "type-section-size": "1.25rem",
  "type-section-leading": "1.75rem",
  "type-body-size": "1rem",
  "type-body-leading": "1.5rem",
  "type-caption-size": "0.8125rem",
  "type-caption-leading": "1.125rem",
};

describe("shell tokens and chrome catalogs", () => {
  it("tokens.css defines DESIGN.md color, space, type, and radius values", () => {
    const tokens = read("src/app/tokens.css");
    for (const [name, value] of Object.entries({
      ...DESIGN_COLOR_TOKENS,
      ...DESIGN_SPACE_TOKENS,
      ...DESIGN_RADIUS_TOKENS,
      ...DESIGN_TYPE_TOKENS,
    })) {
      expect(tokens).toContain(`--${name}: ${value};`);
    }
    expect(tokens).toContain("--focus-ring-width: 2px;");
    expect(tokens).toContain("--focus-ring-offset: 2px;");
  });

  it("hex and raw spacing appear only in tokens.css under src/app", () => {
    const appRoot = join(root, "src/app");
    const hexRe = /#[0-9a-fA-F]{3,8}\b/;
    const rawSpaceRe = /(?<![\w-])\d+px\b/;
    for (const file of walkFiles(appRoot)) {
      const rel = relative(root, file);
      if (rel === "src/app/tokens.css") continue;
      if (/\.test\.(ts|tsx)$/.test(rel)) continue;
      const body = readFileSync(file, "utf8");
      expect(body.match(hexRe), `hex outside tokens in ${rel}`).toBeNull();
      if (rel.endsWith(".css")) {
        expect(
          body.match(rawSpaceRe),
          `raw px outside tokens in ${rel}`,
        ).toBeNull();
      }
    }
  });

  it("globals use token names, logical CSS properties, and an outline focus ring", () => {
    const globals = read("src/app/globals.css");
    expect(globals).toMatch(/color:\s*var\(--text\)/);
    expect(globals).toMatch(/background-color:\s*var\(--bg\)/);
    expect(globals).toMatch(/padding-block:\s*var\(--space-lg\)/);
    expect(globals).toMatch(/padding-inline:\s*var\(--space-md\)/);
    expect(globals).toMatch(/text-align:\s*start/);
    expect(globals).toMatch(/min-block-size:\s*100%/);
    expect(globals).toMatch(
      /:focus-visible\s*\{[^}]*outline:\s*var\(--focus-ring-width\)\s+solid\s+var\(--focus\)/s,
    );
    expect(globals).toMatch(/outline-offset:\s*var\(--focus-ring-offset\)/);
    expect(globals).not.toMatch(/outline:\s*\d+px/);
  });

  it("layout sets html lang and dir from the hp_locale cookie helpers", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toContain('from "@/i18n/request"');
    expect(layout).toContain("LOCALE_COOKIE");
    expect(layout).toContain("localeFromCookie");
    expect(layout).toContain("dirForLocale");
    expect(layout).toMatch(/lang=\{locale\}/);
    expect(layout).toMatch(/dir=\{dir\}/);
    expect(layout).toContain('store.get(LOCALE_COOKIE)');
  });

  it("next.config.ts only wires next-intl and locale is cookie not URL prefix", () => {
    const config = read("next.config.ts");
    expect(config).toContain('import createNextIntlPlugin from "next-intl/plugin"');
    expect(config).toContain("createNextIntlPlugin()");
    expect(config).toContain("withNextIntl(nextConfig)");
    expect(config).not.toMatch(/localePrefix/);
    expect(config).not.toMatch(/rewrites|redirects|middleware/i);
    const middlewarePaths = walkFiles(root).filter((f) =>
      /middleware\.(ts|js)$/.test(f),
    );
    expect(middlewarePaths).toEqual([]);
  });

  it("messages/en.json and messages/ar.json hold chrome for slice surfaces", () => {
    const surfaces = [
      "Home",
      "Account",
      "Create",
      "plans",
      "invite",
      "join",
      "invitations",
      "respond",
      "proposal",
      "confirmed",
      "common",
      "errors",
    ] as const;
    for (const key of surfaces) {
      expect(en, `en missing ${key}`).toHaveProperty(key);
      expect(ar, `ar missing ${key}`).toHaveProperty(key);
    }
    expect(en.errors).toHaveProperty("code");
    expect(en.errors).toHaveProperty("reason");
    expect(en.errors).toHaveProperty("fields");
    expect(ar.errors).toHaveProperty("code");
  });
});
