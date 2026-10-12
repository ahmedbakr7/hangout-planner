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
