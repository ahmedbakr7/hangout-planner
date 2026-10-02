import path from "node:path";
import { defineConfig } from "vitest/config";

// Mirrors the config the `test:e2e` script writes to node_modules/.cache.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["e2e/**/*.e2e.ts"],
    fileParallelism: false,
    testTimeout: 120000,
  },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
});
