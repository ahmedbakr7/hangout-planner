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

describe("T-001-76/AC-1 the repo ESLint config rejects next/font/google", () => {
  const source = 'import { IBM_Plex_Sans } from "next/font/google";\n';

  it.each(["src/app/layout.tsx", "src/app/x.test.tsx"])(
    "T-001-76/AC-1 reports no-restricted-imports naming next/font/local for %s",
    async (filePath) => {
      const eslint = new ESLint({ cwd: ROOT });
      const [result] = await eslint.lintText(source, { filePath: path.join(ROOT, filePath) });
      const hits = result.messages.filter(
        (message) => message.ruleId === "no-restricted-imports" && message.severity === 2,
      );
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.some((message) => message.message.includes("next/font/local"))).toBe(true);
    },
    300_000,
  );

  it(
    "T-001-76/AC-1 the real src/app/layout.tsx has no no-restricted-imports error",
    async () => {
      const eslint = new ESLint({ cwd: ROOT });
      const [result] = await eslint.lintFiles(["src/app/layout.tsx"]);
      const hits = result.messages.filter((message) => message.ruleId === "no-restricted-imports");
      expect(hits).toEqual([]);
    },
    300_000,
  );
});
