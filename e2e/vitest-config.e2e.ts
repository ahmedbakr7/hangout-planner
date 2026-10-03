// @vitest-environment node
import { describe, expect, it } from "vitest";
import unitConfig from "../vitest.config";
import e2eConfig from "../vitest.e2e.config.mts";

describe("Vitest configs", () => {
  // The fresh-database race stays fixed only while both suites run the global setup first.
  it("both run the global setup before any test file", () => {
    for (const config of [unitConfig, e2eConfig]) {
      expect(config.test?.globalSetup).toContain("./vitest.global-setup.ts");
    }
  });
});
