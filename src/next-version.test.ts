import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

describe("Next.js 16", () => {
  it("T-001-35/AC-1 package.json declares next ^16.4.0 and 16.4.0 or later 16.x is installed", () => {
    const pkg = readJson("package.json") as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies.next).toBe("^16.4.0");

    const installed = readJson("node_modules/next/package.json") as {
      version: string;
    };
    const [major, minor] = installed.version.split(".").map(Number);
    expect(major).toBe(16);
    expect(minor).toBeGreaterThanOrEqual(4);
  });

  it(
    "T-001-35/AC-2 tsc -p tsconfig.json --noEmit exits 0 with tests included",
    () => {
      const result = spawnSync(
        process.execPath,
        [
          resolve(root, "node_modules/typescript/bin/tsc"),
          "-p",
          "tsconfig.json",
          "--noEmit",
        ],
        { cwd: root, encoding: "utf8" },
      );
      expect(result.stdout).toBe("");
      expect(result.status).toBe(0);
    },
    180_000,
  );
});

describe("Next.js security patch", () => {
  it("T-001-80/AC-1 lockfile and installed next are 16.4.3 or later, with @next/env and @next/swc-* at the same version", () => {
    const lock = readJson("package-lock.json") as {
      packages: Record<string, { version: string }>;
    };
    const parse = (version: string): number[] => version.split(".").map(Number);
    const nextVersion = lock.packages["node_modules/next"].version;
    const [major, minor, patch] = parse(nextVersion);
    expect(major).toBe(16);
    expect(minor > 4 || (minor === 4 && patch >= 3)).toBe(true);

    const swcKeys = Object.keys(lock.packages).filter((key) =>
      key.startsWith("node_modules/@next/swc-"),
    );
    expect(swcKeys.length).toBeGreaterThan(0);
    expect(lock.packages["node_modules/@next/env"].version).toBe(nextVersion);
    for (const key of swcKeys) {
      expect(lock.packages[key].version, key).toBe(nextVersion);
    }

    const installed = readJson("node_modules/next/package.json") as {
      version: string;
    };
    expect(installed.version).toBe(nextVersion);
  });
});
