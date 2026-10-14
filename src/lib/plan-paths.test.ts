import { describe, expect, it } from "vitest";
import { planPath } from "./plan-paths";

describe("planPath", () => {
  it("T-001-50/AC-1 organizer maps to the organizer plan path", () => {
    expect(planPath("p1", "organizer")).toBe("/plans/p1");
  });

  it("T-001-50/AC-1 respond maps to the response path", () => {
    expect(planPath("p1", "respond")).toBe("/plans/p1/respond");
  });

  it("T-001-50/AC-1 proposal maps to the proposal path", () => {
    expect(planPath("p1", "proposal")).toBe("/plans/p1/proposal");
  });

  it("T-001-50/AC-1 confirmed maps to the confirmed path", () => {
    expect(planPath("p1", "confirmed")).toBe("/plans/p1/confirmed");
  });

  it("T-001-50/AC-1 join maps to the in-app join path", () => {
    expect(planPath("p1", "join")).toBe("/plans/p1/join");
  });
});
