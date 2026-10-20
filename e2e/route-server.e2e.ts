import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createRouteServer, routeFor } from "./route-server";

describe("routeFor", () => {
  it("T-001-67/AC-3 a segment that names a file is matched as the dynamic segment", () => {
    expect(routeFor("/api/v1/plans/route.ts")).toEqual({
      file: resolve(process.cwd(), "src/app/api/v1/plans/[planId]/route.ts"),
      params: { planId: "route.ts" },
    });
  });

  it("T-001-67/AC-4 a path below a file segment returns null and does not throw", () => {
    expect(() => routeFor("/api/v1/me/route.ts/x")).not.toThrow();
    expect(routeFor("/api/v1/me/route.ts/x")).toBeNull();
  });
});

describe("createRouteServer", () => {
  it("T-001-67/AC-5 a path below a file segment answers 404 and is recorded as unserved", async () => {
    const server = createRouteServer();

    const response = await server.serve("/api/v1/me/route.ts/x");

    expect(response.status).toBe(404);
    expect(server.unserved).toEqual(["GET /api/v1/me/route.ts/x"]);
  });
});
