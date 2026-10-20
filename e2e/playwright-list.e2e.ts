import { execFile } from "node:child_process";
import { describe, expect, it } from "vitest";

const title = "T-001-63/AC-1 signed-out home page shows the Home heading";

// `--list` starts no web server and opens no browser; it only loads the config and the spec files.
function listTests(): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(
      "npx",
      ["--no-install", "playwright", "test", "--list"],
      { cwd: process.cwd(), timeout: 60_000 },
      (error, stdout) => {
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        resolve({ code, stdout });
      },
    );
  });
}

describe("playwright test --list", () => {
  it(
    `T-001-63/AC-1 lists the smoke test in the chromium project and no test in another project: ${title}`,
    async () => {
      const { code, stdout } = await listTests();
      expect(code).toBe(0);
      const tests = stdout.split("\n").filter((line) => line.includes("›"));
      expect(tests).toContainEqual(
        expect.stringMatching(
          new RegExp(`^\\s*\\[chromium\\] › smoke\\.spec\\.ts:\\d+:\\d+ › ${title}$`),
        ),
      );
      const otherProjects = tests.filter((line) => !/^\s*\[chromium\] ›/.test(line));
      expect(otherProjects).toEqual([]);
    },
    60_000,
  );
});
