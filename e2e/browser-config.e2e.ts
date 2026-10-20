// @vitest-environment node
/**
 * T-001-62 — the browser-test tooling through the real tools. npm resolves the Playwright pin,
 * TypeScript expands the project's include list, and Playwright's own loader reads the config.
 * Nothing here starts a browser, a server or a Playwright run.
 */
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

// Async on purpose: a blocking spawn starves the worker's RPC heartbeat to Vitest.
function run(
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<{ status: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout }));
  });
}

// A free port: listen on 0, read the port the OS chose, close.
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

// The config reads its port variables at load, so these tests load it fresh with both pinned to "".
async function loadConfigWithDefaultPorts() {
  vi.stubEnv("HP_E2E_APP_PORT", "");
  vi.stubEnv("HP_E2E_GOOGLE_STUB_PORT", "");
  vi.resetModules();
  return (await import("../playwright.config")).default;
}

describe("browser test tooling", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it("T-001-62/AC-1 npm resolves @playwright/test to exactly 1.56.1", async () => {
    const out = await run("npm", ["ls", "@playwright/test", "--json", "--depth=0"]);
    expect(out.status).toBe(0);
    const tree = JSON.parse(out.stdout) as { dependencies: Record<string, { version: string }> };
    expect(tree.dependencies["@playwright/test"].version).toBe("1.56.1");
  });

  it("T-001-62/AC-2 the Vitest config excludes browser/** and TypeScript includes the browser files", async () => {
    const { default: vitestConfig } = await import("../vitest.config");
    const { configDefaults } = await import("vitest/config");
    expect(vitestConfig.test?.exclude).toEqual([...configDefaults.exclude, "browser/**"]);

    const out = await run("npx", ["--no-install", "tsc", "--showConfig", "-p", "tsconfig.json"]);
    expect(out.status).toBe(0);
    const shown = JSON.parse(out.stdout) as { include: string[] };
    expect(shown.include).toEqual(expect.arrayContaining(["browser/**/*.ts", "playwright.config.ts"]));
  });

  it("T-001-62/AC-3 the Playwright config runs chromium against the stub and the built app", async () => {
    const config = await loadConfigWithDefaultPorts();
    expect(config.testDir).toBe("browser");
    expect(config.globalSetup).toBe("./browser/global-setup.ts");
    expect(config.use?.baseURL).toBe("http://127.0.0.1:3124");
    expect(config.projects?.map((p) => p.name)).toEqual(["chromium"]);

    const servers = config.webServer;
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
  });

  it("T-001-65/AC-1 the Playwright config turns off git commit and diff capture", async () => {
    const config = await loadConfigWithDefaultPorts();
    expect(config.captureGitInfo).toEqual({ commit: false, diff: false });
  });

  it(
    "T-001-73/AC-1 T-001-73/AC-2 Playwright's loader accepts the config with both ports chosen from the environment",
    async () => {
      const appPort = await freePort();
      let stubPort = await freePort();
      while (stubPort === appPort) stubPort = await freePort();
      const out = await run("npx", ["--no-install", "playwright", "test", "--list"], {
        ...process.env,
        HP_E2E_APP_PORT: String(appPort),
        HP_E2E_GOOGLE_STUB_PORT: String(stubPort),
      });
      expect(out.status).toBe(0);
      expect(out.stdout).toContain("smoke.spec.ts");
    },
    60_000,
  );
});
