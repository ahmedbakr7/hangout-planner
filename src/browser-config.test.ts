// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { configDefaults } from "vitest/config";
import { describe, expect, it } from "vitest";
import playwrightConfig from "../playwright.config";
import vitestConfig from "../vitest.config";

const root = process.cwd();
const readJson = (file: string): unknown => JSON.parse(readFileSync(resolve(root, file), "utf8"));

type Suite = {
  suites?: Suite[];
  specs?: { title: string; file: string; tests: { projectName: string }[] }[];
};

describe("browser test tooling", () => {
  it("T-001-62/AC-1 @playwright/test is pinned to 1.56.1 and the lockfile resolves it", () => {
    const pkg = readJson("package.json") as { devDependencies: Record<string, string> };
    const lock = readJson("package-lock.json") as { packages: Record<string, { version: string }> };
    expect(pkg.devDependencies["@playwright/test"]).toBe("1.56.1");
    expect(lock.packages["node_modules/@playwright/test"].version).toBe("1.56.1");
  });

  it("T-001-62/AC-2 Vitest excludes browser/** and tsconfig includes the browser files", () => {
    expect(vitestConfig.test?.exclude).toEqual([...configDefaults.exclude, "browser/**"]);
    const tsconfig = readJson("tsconfig.json") as { include: string[] };
    expect(tsconfig.include).toEqual(expect.arrayContaining(["browser/**/*.ts", "playwright.config.ts"]));
  });

  it("T-001-62/AC-3 the Playwright config runs chromium against the stub and the built app", () => {
    expect(playwrightConfig.testDir).toBe("browser");
    expect(playwrightConfig.globalSetup).toBe("./browser/global-setup.ts");
    expect(playwrightConfig.use?.baseURL).toBe("http://127.0.0.1:3124");
    expect(playwrightConfig.projects?.map((p) => p.name)).toEqual(["chromium"]);
    expect(playwrightConfig.projects?.[0].use?.browserName).toBe("chromium");

    const servers = playwrightConfig.webServer;
    if (!Array.isArray(servers)) throw new Error("webServer must be a list");
    expect(servers).toHaveLength(2);
    const [stub, app] = servers;
    expect(stub).toMatchObject({
      command: "node browser/google-stub.mjs",
      port: 3125,
      timeout: 10_000,
      reuseExistingServer: false,
    });
    expect(stub.env).toBeUndefined();
    expect(app).toMatchObject({
      command: "npx --no-install next build && npx --no-install next start -p 3124",
      url: "http://127.0.0.1:3124",
      timeout: 300_000,
      reuseExistingServer: false,
    });
    expect(Object.keys(app.env ?? {}).sort()).toEqual([
      "GOOGLE_API_KEY",
      "GOOGLE_MAPS_API_KEY",
      "HP_COOKIE_SECURE",
      "HP_E2E_GOOGLE_BASE_URL",
      "HP_HASH_TEST",
    ]);
    expect(app.env).toMatchObject({
      HP_E2E_GOOGLE_BASE_URL: "http://127.0.0.1:3125",
      HP_COOKIE_SECURE: "0",
      HP_HASH_TEST: "1",
    });
  });

  it(
    "T-001-62/AC-4 playwright --list finds exactly the smoke test in the chromium project",
    () => {
      const output = execFileSync("npx", ["--no-install", "playwright", "test", "--list", "--reporter=json"], {
        cwd: root,
        encoding: "utf8",
        timeout: 60_000,
      });
      const specs: { title: string; file: string; projects: string[] }[] = [];
      const walk = (suite: Suite): void => {
        for (const spec of suite.specs ?? []) {
          specs.push({ title: spec.title, file: spec.file, projects: spec.tests.map((t) => t.projectName) });
        }
        for (const child of suite.suites ?? []) walk(child);
      };
      for (const suite of (JSON.parse(output) as { suites: Suite[] }).suites) walk(suite);
      expect(specs).toEqual([
        {
          title: "T-001-62/AC-4 signed-out home page shows the Home heading",
          file: "smoke.spec.ts",
          projects: ["chromium"],
        },
      ]);
    },
    90_000,
  );
});
