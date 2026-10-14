/**
 * T-001-52 — the lint gate through the real CLI. `npm run lint` and `eslint --stdin` run as the
 * developer and CI run them, in a child process, against the repository's own config. Snippets
 * go in over stdin with a pretend file name, so no file is written to the tree.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

type Run = { status: number | null; stdout: string; stderr: string };
type Message = { ruleId: string | null; severity: number; message: string };

// Async on purpose: a blocking spawn starves the worker's RPC heartbeat to Vitest.
function run(command: string, args: string[], input?: string): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(input ?? "");
  });
}

async function lintStdin(filePath: string, code: string): Promise<Message[]> {
  const out = await run(
    "npx",
    ["--no-install", "eslint", "--stdin", "--stdin-filename", filePath, "--format", "json"],
    code,
  );
  const results = JSON.parse(out.stdout) as { messages: Message[] }[];
  return results[0].messages;
}

function errorsFor(messages: Message[], ruleId: string): Message[] {
  return messages.filter((m) => m.ruleId === ruleId && m.severity === 2);
}

function importOf(specifier: string): string {
  return `import * as x from "${specifier}";\nexport { x };\n`;
}

describe("T-001-52/AC-1 npm run lint", () => {
  it(
    "T-001-52/AC-1 npm run lint exits 0 on the repository",
    async () => {
      const out = await run("npm", ["run", "lint", "--silent"]);
      expect(out.status, `${out.stdout}\n${out.stderr}`).toBe(0);
    },
    600000,
  );

  it("T-001-52/AC-1 a warning fails the lint because no warnings are allowed", async () => {
    const out = await run(
      "npx",
      [
        "--no-install", "eslint", "--stdin", "--stdin-filename", "src/lib/warn.ts",
        "--max-warnings", "0", "--rule", "no-debugger: warn",
      ],
      "debugger;\n",
    );
    expect(out.status).toBe(1);
  });
});

describe("T-001-52/AC-2 import boundaries through the CLI", () => {
  it.each([
    ["react"],
    ["react-dom"],
    ["react/jsx-runtime"],
    ["next/navigation"],
    ["@/components"],
    ["@/components/ui/button"],
    ["@/app"],
    ["@/app/layout"],
  ])("T-001-52/AC-2 src/server rejects an import of %s", async (specifier) => {
    const messages = await lintStdin("src/server/example/rule.ts", importOf(specifier));
    expect(errorsFor(messages, "no-restricted-imports")).toHaveLength(1);
  });

  it.each([
    ["@/server"],
    ["@/server/db/client"],
    ["@/components"],
    ["@/components/ui/button"],
    ["@/app"],
    ["@/app/layout"],
  ])("T-001-52/AC-2 src/lib rejects an import of %s", async (specifier) => {
    const messages = await lintStdin("src/lib/example.ts", importOf(specifier));
    expect(errorsFor(messages, "no-restricted-imports")).toHaveLength(1);
  });

  it.each([["@/server"], ["@/server/db/client"]])(
    "T-001-52/AC-2 src/components rejects an import of %s",
    async (specifier) => {
      const messages = await lintStdin("src/components/example.tsx", importOf(specifier));
      expect(errorsFor(messages, "no-restricted-imports")).toHaveLength(1);
    },
  );

  it("T-001-52/AC-2 test files and allowed imports are not reported", async () => {
    const react = importOf("react");
    const server = importOf("@/server/db/client");
    const cases = [
      await lintStdin("src/server/example/rule.test.ts", react),
      await lintStdin("src/lib/example.ts", react),
      await lintStdin("src/components/example.test.tsx", server),
    ];
    for (const messages of cases) {
      expect(errorsFor(messages, "no-restricted-imports")).toEqual([]);
    }
  });
});

describe("T-001-52/AC-3 chrome rules through the CLI", () => {
  it.each([
    ["a string", `export const c = "#0e6b4f";\n`],
    ["a template literal", "export const c = `border: 1px solid #fff`;\n"],
  ])("T-001-52/AC-3 reports a raw hex colour in %s", async (_name, code) => {
    const messages = await lintStdin("src/components/example.ts", code);
    expect(errorsFor(messages, "no-restricted-syntax")).toHaveLength(1);
  });

  it("T-001-52/AC-3 reports a JSX style attribute", async () => {
    const messages = await lintStdin(
      "src/components/example.tsx",
      `export function X() {\n  return <div style={{ margin: 0 }} />;\n}\n`,
    );
    expect(errorsFor(messages, "no-restricted-syntax")).toHaveLength(1);
  });

  it("T-001-52/AC-3 does not report test files or a string that is not a colour", async () => {
    const testFile = await lintStdin("src/components/example.test.ts", `export const c = "#0e6b4f";\n`);
    const notColour = await lintStdin(
      "src/components/example.ts",
      `export const c = "issue #12 of the list";\n`,
    );
    expect(errorsFor(testFile, "no-restricted-syntax")).toEqual([]);
    expect(errorsFor(notColour, "no-restricted-syntax")).toEqual([]);
  });
});
