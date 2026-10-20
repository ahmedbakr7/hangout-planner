import { defineConfig } from "@playwright/test";

const MAX_PORT = 65535;

function portFrom(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return fallback;
  }
  if (!/^[1-9][0-9]{0,4}$/.test(value) || Number(value) > MAX_PORT) {
    throw new Error(`${name} must be a port from 1 to 65535`);
  }
  return Number(value);
}

const appPort = portFrom("HP_E2E_APP_PORT", 3124);
const stubPort = portFrom("HP_E2E_GOOGLE_STUB_PORT", 3125);
if (appPort === stubPort) {
  throw new Error("HP_E2E_APP_PORT and HP_E2E_GOOGLE_STUB_PORT must differ");
}

export default defineConfig({
  testDir: "browser",
  captureGitInfo: { commit: false, diff: false },
  globalSetup: "./browser/global-setup.ts",
  use: { baseURL: `http://127.0.0.1:${appPort}` },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      command: "node browser/google-stub.mjs",
      port: stubPort,
      timeout: 10_000,
      reuseExistingServer: false,
    },
    {
      command: `npx --no-install next build && npx --no-install next start -p ${appPort}`,
      url: `http://127.0.0.1:${appPort}`,
      timeout: 300_000,
      reuseExistingServer: false,
      env: {
        GOOGLE_MAPS_API_KEY: "browser-test-dummy",
        GOOGLE_API_KEY: "browser-test-dummy",
        HP_E2E_GOOGLE_BASE_URL: `http://127.0.0.1:${stubPort}`,
        HP_COOKIE_SECURE: "0",
        HP_HASH_TEST: "1",
      },
    },
  ],
});
