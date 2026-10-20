// @vitest-environment node
/**
 * T-001-74 — no file under src/ imports next/font/google. The rule is added here through
 * overrideConfig, so the test does not depend on the repo's ESLint config carrying it.
 */
import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");

describe("T-001-74/AC-2 fonts load from files in the repo", () => {
  it(
    "T-001-74/AC-2 no .ts or .tsx file under src/ imports from next/font/google",
    async () => {
      const withRule = new ESLint({
        cwd: ROOT,
        overrideConfig: {
          files: ["src/**/*.{ts,tsx}"],
          rules: {
            "no-restricted-imports": [
              "error",
              {
                paths: [
                  {
                    name: "next/font/google",
                    message: "Load fonts with next/font/local (T-001-74).",
                  },
                ],
              },
            ],
          },
        },
      });
      const results = await withRule.lintFiles(["src/**/*.ts", "src/**/*.tsx"]);
      expect(results.length).toBeGreaterThan(0);
      expect(
        results.some((result) => result.filePath.endsWith(path.join("src", "app", "layout.tsx"))),
      ).toBe(true);
      const errors = results.flatMap((result) =>
        result.messages
          .filter((message) => message.severity === 2)
          .map(
            (message) =>
              `${path.relative(ROOT, result.filePath)}:${message.line} ${message.ruleId}: ${message.message}`,
          ),
      );
      expect(errors).toEqual([]);
    },
    300_000,
  );
});
