// @vitest-environment node
import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const eslint = new ESLint({ cwd: ROOT });

async function ruleIds(code: string, file: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, {
    filePath: path.join(ROOT, file),
  });
  return result.messages
    .filter((message) => message.severity === 2)
    .map((message) => message.ruleId ?? "parse-error");
}

async function errorMessages(
  code: string,
  file: string,
): Promise<{ ruleId: string; message: string }[]> {
  const [result] = await eslint.lintText(code, {
    filePath: path.join(ROOT, file),
  });
  return result.messages
    .filter((message) => message.severity === 2)
    .map((message) => ({
      ruleId: message.ruleId ?? "parse-error",
      message: message.message,
    }));
}

const RESTRICTED = "no-restricted-imports";
const SYNTAX = "no-restricted-syntax";

describe("T-001-52/AC-1 npm run lint", () => {
  it(
    "T-001-52/AC-1 lints the repository with zero errors and zero warnings",
    async () => {
      const results = await eslint.lintFiles(["."]);
      const problems = results.flatMap((result) =>
        result.messages.map(
          (message) =>
            `${path.relative(ROOT, result.filePath)}:${message.line} ${message.ruleId} ${message.message}`,
        ),
      );
      expect(problems).toEqual([]);
      expect(results.reduce((sum, r) => sum + r.errorCount, 0)).toBe(0);
      expect(results.reduce((sum, r) => sum + r.warningCount, 0)).toBe(0);
    },
    300_000,
  );

  it("T-001-52/AC-1 the lint script runs the type check and then ESLint with no warnings allowed", async () => {
    const pkg = (await import("../package.json")).default as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.lint).toBe(
      `${pkg.scripts.typecheck} && eslint . --max-warnings 0`,
    );
  });
});

async function realTreeErrors(globs: string[]): Promise<string[]> {
  const results = await eslint.lintFiles(globs);
  return results.flatMap((result) =>
    result.messages
      .filter((message) => message.severity === 2)
      .map(
        (message) =>
          `${path.relative(ROOT, result.filePath)}:${message.line} ${message.ruleId}`,
      ),
  );
}

describe("T-001-52/AC-2 import boundaries", () => {
  it(
    "T-001-52/AC-2 the real src/server and src/components files have no ESLint errors",
    async () => {
      expect(
        await realTreeErrors([
          "src/server/**/*.ts",
          "src/components/**/*.{ts,tsx}",
        ]),
      ).toEqual([]);
    },
    120_000,
  );

  it.each([
    ["react"],
    ["react/jsx-runtime"],
    ["react-dom"],
    ["react-dom/client"],
    ["next/navigation"],
    ["../components"],
    ["../components/x"],
    ["../../app"],
    ["../app/layout"],
    ["@/components"],
    ["@/components/ui/button"],
    ["@/app"],
    ["@/app/layout"],
  ])("T-001-52/AC-2 src/server rejects an import of %s", async (specifier) => {
    const ids = await ruleIds(
      `import * as x from "${specifier}";\nexport { x };\n`,
      "src/server/plans/example.ts",
    );
    expect(ids).toContain(RESTRICTED);
  });

  it("T-001-52/AC-2 src/server allows a test file to import react", async () => {
    const ids = await ruleIds(
      `import * as x from "react";\nexport { x };\n`,
      "src/server/plans/example.test.ts",
    );
    expect(ids).not.toContain(RESTRICTED);
  });

  it("T-001-52/AC-2 src/server allows its own domain imports", async () => {
    const ids = await ruleIds(
      `import * as x from "@/server/clock";\nexport { x };\n`,
      "src/server/plans/example.ts",
    );
    expect(ids).not.toContain(RESTRICTED);
  });

  it.each([
    ["@/server"],
    ["@/server/clock"],
    ["@/components"],
    ["@/components/ui/button"],
    ["@/app"],
    ["@/app/layout"],
    ["../server"],
    ["../server/clock"],
    ["../components"],
    ["../components/ui/button"],
    ["../app"],
    ["../app/layout"],
  ])("T-001-52/AC-2 src/lib rejects an import of %s", async (specifier) => {
    const ids = await ruleIds(
      `import * as x from "${specifier}";\nexport { x };\n`,
      "src/lib/example.ts",
    );
    expect(ids).toContain(RESTRICTED);
  });

  it("T-001-52/AC-2 src/lib allows an import of react", async () => {
    const ids = await ruleIds(
      `import * as x from "react";\nexport { x };\n`,
      "src/lib/example.ts",
    );
    expect(ids).not.toContain(RESTRICTED);
  });

  it.each([
    ["@/server"],
    ["@/server/clock"],
    ["../server"],
    ["../../server/clock"],
  ])(
    "T-001-52/AC-2 src/components rejects an import of %s",
    async (specifier) => {
      const ids = await ruleIds(
        `import * as x from "${specifier}";\nexport { x };\n`,
        "src/components/example.tsx",
      );
      expect(ids).toContain(RESTRICTED);
    },
  );

  it("T-001-52/AC-2 src/components allows a test file to import @/server", async () => {
    const ids = await ruleIds(
      `import * as x from "@/server/clock";\nexport { x };\n`,
      "src/components/example.test.tsx",
    );
    expect(ids).not.toContain(RESTRICTED);
  });

  it.each([["./format"], ["../../messages/en.json"], ["./ui/button"]])(
    "T-001-52/AC-2 src/components allows the relative import %s",
    async (specifier) => {
      const ids = await ruleIds(
        `import * as x from "${specifier}";\nexport { x };\n`,
        "src/components/example.tsx",
      );
      expect(ids).not.toContain(RESTRICTED);
    },
  );

  it("T-001-52/AC-2 src/server allows a relative components import in a test file", async () => {
    const ids = await ruleIds(
      `import * as x from "../components/x";\nexport { x };\n`,
      "src/server/plans/example.test.ts",
    );
    expect(ids).not.toContain(RESTRICTED);
  });

  it("T-001-52/AC-2 src/components allows react and @/components", async () => {
    const ids = await ruleIds(
      `import * as x from "react";\nimport * as y from "@/components/ui/button";\nexport { x, y };\n`,
      "src/components/example.tsx",
    );
    expect(ids).not.toContain(RESTRICTED);
  });
});

describe("T-001-52/AC-3 chrome rules", () => {
  it(
    "T-001-52/AC-3 the real src tree has no raw hex colour or inline style errors",
    async () => {
      expect(await realTreeErrors(["src/**/*.{ts,tsx}"])).toEqual([]);
    },
    120_000,
  );

  it.each([
    ["a string literal", `export const c = "#0e6b4f";\n`],
    ["a short hex string", `export const c = "#fff";\n`],
    ["a template literal", "export const c = `color: #0E6B4F`;\n"],
  ])("T-001-52/AC-3 reports a raw hex colour in %s", async (_name, code) => {
    const ids = await ruleIds(code, "src/lib/example.ts");
    expect(ids).toContain(SYNTAX);
  });

  it("T-001-52/AC-3 reports a JSX style attribute in a .tsx file", async () => {
    const ids = await ruleIds(
      `export const a = <div style={{ margin: 0 }} />;\n`,
      "src/components/example.tsx",
    );
    expect(ids).toContain(SYNTAX);
  });

  it("T-001-52/AC-3 ignores a string that is not a colour", async () => {
    const ids = await ruleIds(
      `export const a = "#section";\nexport const b = "/plans/#1";\n`,
      "src/lib/example.ts",
    );
    expect(ids).not.toContain(SYNTAX);
  });

  it("T-001-52/AC-3 does not apply to test files", async () => {
    const ids = await ruleIds(
      `export const c = "#0e6b4f";\nexport const a = <div style={{ margin: 0 }} />;\n`,
      "src/components/example.test.tsx",
    );
    expect(ids).not.toContain(SYNTAX);
  });

  it("T-001-53/AC-1 the nine chrome components resolve no-restricted-syntax as an error with the hex and style selectors", async () => {
    const selectors = [
      "Literal[value=/#[0-9a-fA-F]{3,8}\\b/]",
      "TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b/]",
      "JSXAttribute[name.name='style']",
    ];
    const components = [
      "account-gate",
      "confirmed-view",
      "create-form",
      "home-list",
      "invite-panel",
      "join-panel",
      "organizer-plan",
      "proposal-view",
      "response-form",
    ].map((name) => `src/components/${name}.tsx`);
    for (const file of components) {
      const config = await eslint.calculateConfigForFile(
        path.join(ROOT, file),
      );
      const entry = config?.rules?.[SYNTAX] as unknown[] | undefined;
      expect(entry, file).toBeDefined();
      const [severity, ...options] = entry ?? [];
      expect([2, "error"], file).toContain(severity);
      const configured = options.map(
        (option) => (option as { selector: string }).selector,
      );
      for (const selector of selectors) {
        expect(configured, file).toContain(selector);
      }
    }
  });

  it("T-001-52/AC-3 flags the same hex literal in a non-test file but not in a test file", async () => {
    const code = `export const c = "#0e6b4f";\n`;
    expect(await ruleIds(code, "src/lib/example.ts")).toContain(SYNTAX);
    expect(await ruleIds(code, "src/lib/example.test.ts")).not.toContain(SYNTAX);
  });
});

describe("T-001-74/AC-2 the layout loads fonts locally", () => {
  it(
    "T-001-74/AC-2 src/app/layout.tsx imports nothing from next/font/google",
    async () => {
      const withRule = new ESLint({
        cwd: ROOT,
        overrideConfig: {
          files: ["src/**/*.{ts,tsx}"],
          rules: {
            [RESTRICTED]: [
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
      const [result] = await withRule.lintFiles(["src/app/layout.tsx"]);
      const errors = result.messages
        .filter((message) => message.severity === 2)
        .map((message) => `${message.ruleId}: ${message.message}`);
      expect(errors).toEqual([]);
    },
    120_000,
  );
});

describe("T-001-76/AC-1 no next/font/google under src/", () => {
  it.each([
    ["src/app/layout.tsx"],
    ["src/components/x.tsx"],
    ["src/server/x.ts"],
    ["src/lib/x.ts"],
    ["src/app/x.test.tsx"],
  ])(
    "T-001-76/AC-1 %s rejects next/font/google and names next/font/local",
    async (file) => {
      const errors = await errorMessages(
        `import { IBM_Plex_Sans } from "next/font/google";\nexport { IBM_Plex_Sans };\n`,
        file,
      );
      const restricted = errors.filter((error) => error.ruleId === RESTRICTED);
      expect(restricted).toHaveLength(1);
      expect(restricted[0].message).toContain("next/font/local");
    },
  );

  it("T-001-76/AC-1 src/server still rejects an @/components import", async () => {
    const ids = await ruleIds(
      `import * as x from "@/components/ui/button";\nexport { x };\n`,
      "src/server/x.ts",
    );
    expect(ids).toContain(RESTRICTED);
  });

  it("T-001-76/AC-1 src/lib still rejects an @/server import", async () => {
    const ids = await ruleIds(
      `import * as x from "@/server/clock";\nexport { x };\n`,
      "src/lib/x.ts",
    );
    expect(ids).toContain(RESTRICTED);
  });
});
