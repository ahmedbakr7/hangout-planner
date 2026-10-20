import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "browser",
  captureGitInfo: { commit: false, diff: false },
  globalSetup: "./browser/global-setup.ts",
  use: { baseURL: "http://127.0.0.1:3124" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      command: "node browser/google-stub.mjs",
      port: 3125,
      timeout: 10_000,
      reuseExistingServer: false,
    },
    {
      command: "npx --no-install next build && npx --no-install next start -p 3124",
      url: "http://127.0.0.1:3124",
      timeout: 300_000,
      reuseExistingServer: false,
      env: {
        GOOGLE_MAPS_API_KEY: "browser-test-dummy",
        GOOGLE_API_KEY: "browser-test-dummy",
        HP_E2E_GOOGLE_BASE_URL: "http://127.0.0.1:3125",
        HP_COOKIE_SECURE: "0",
        HP_HASH_TEST: "1",
      },
    },
  ],
});
