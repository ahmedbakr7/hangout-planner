// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { configDefaults } from "vitest/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import vitestConfig from "../vitest.config";

const root = process.cwd();
const readJson = (file: string): unknown => JSON.parse(readFileSync(resolve(root, file), "utf8"));

const loadConfig = async () => {
  vi.resetModules();
  return (await import("../playwright.config")).default;
};

const stubDefaultPorts = () => {
  vi.stubEnv("HP_E2E_APP_PORT", "");
  vi.stubEnv("HP_E2E_GOOGLE_STUB_PORT", "");
};

describe("browser test tooling", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

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

  it("T-001-62/AC-3 the Playwright config runs chromium against the stub and the built app", async () => {
    stubDefaultPorts();
    const playwrightConfig = await loadConfig();
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

  it("T-001-65/AC-1 the Playwright config turns off git commit and diff capture", async () => {
    stubDefaultPorts();
    const playwrightConfig = await loadConfig();
    expect(playwrightConfig.captureGitInfo).toEqual({ commit: false, diff: false });
  });

  it("T-001-73/AC-1 HP_E2E_APP_PORT moves the app and baseURL, the stub stays put", async () => {
    vi.stubEnv("HP_E2E_APP_PORT", "4124");
    vi.stubEnv("HP_E2E_GOOGLE_STUB_PORT", "");
    const config = await loadConfig();
    expect(config.use?.baseURL).toBe("http://127.0.0.1:4124");
    const servers = config.webServer;
    if (!Array.isArray(servers)) throw new Error("webServer must be a list");
    const [stub, app] = servers;
    expect(stub).toMatchObject({
      command: "node browser/google-stub.mjs",
      port: 3125,
      timeout: 10_000,
      reuseExistingServer: false,
    });
    expect(stub.env).toBeUndefined();
    expect(app).toMatchObject({
      command: "npx --no-install next build && npx --no-install next start -p 4124",
      url: "http://127.0.0.1:4124",
      timeout: 300_000,
      reuseExistingServer: false,
    });
    expect(app.env).toMatchObject({ HP_E2E_GOOGLE_BASE_URL: "http://127.0.0.1:3125" });
  });

  it("T-001-73/AC-2 HP_E2E_GOOGLE_STUB_PORT moves the stub and the app's stub origin", async () => {
    vi.stubEnv("HP_E2E_APP_PORT", "");
    vi.stubEnv("HP_E2E_GOOGLE_STUB_PORT", "4125");
    const config = await loadConfig();
    const servers = config.webServer;
    if (!Array.isArray(servers)) throw new Error("webServer must be a list");
    const [stub, app] = servers;
    expect(stub.port).toBe(4125);
    expect(stub.env).toBeUndefined();
    expect(app.env?.HP_E2E_GOOGLE_BASE_URL).toBe("http://127.0.0.1:4125");
    expect(Object.keys(app.env ?? {}).sort()).toEqual([
      "GOOGLE_API_KEY",
      "GOOGLE_MAPS_API_KEY",
      "HP_COOKIE_SECURE",
      "HP_E2E_GOOGLE_BASE_URL",
      "HP_HASH_TEST",
    ]);
  });

  it.each(["HP_E2E_APP_PORT", "HP_E2E_GOOGLE_STUB_PORT"])(
    "T-001-73/AC-3 %s rejects values that are not a port from 1 to 65535",
    async (name) => {
      for (const bad of ["abc", "0", "65536", "3124x", "03124"]) {
        stubDefaultPorts();
        vi.stubEnv(name, bad);
        await expect(loadConfig()).rejects.toThrow(name);
      }
    },
  );

  it("T-001-73/AC-4 the same port for the app and the stub throws naming both variables", async () => {
    vi.stubEnv("HP_E2E_APP_PORT", "4126");
    vi.stubEnv("HP_E2E_GOOGLE_STUB_PORT", "4126");
    const error = await loadConfig().then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("HP_E2E_APP_PORT");
    expect((error as Error).message).toContain("HP_E2E_GOOGLE_STUB_PORT");
  });
});
