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

describe("shell tokens and chrome catalogs", () => {
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
