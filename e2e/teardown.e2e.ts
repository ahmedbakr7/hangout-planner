import { describe, expect, it } from "vitest";
import { teardownThenAssertServed } from "./teardown";

function recorder() {
  const calls: string[] = [];
  const step = (name: string, error?: Error) => () => {
    calls.push(name);
    if (error) throw error;
  };
  return { calls, step };
}

describe("teardownThenAssertServed", () => {
  it("T-001-59/AC-1 unserved requests still run every step and throw an error naming them", () => {
    const { calls, step } = recorder();
    const unserved = ["GET /api/plans/a", "POST /api/invites"];

    let thrown: unknown;
    try {
      teardownThenAssertServed(unserved, step("cleanup"), step("unstub"), step("env"));
    } catch (error) {
      thrown = error;
    }

    expect(calls).toEqual(["cleanup", "unstub", "env"]);
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    for (const request of unserved) expect(message).toContain(request);
  });

  it("T-001-59/AC-2 a throwing step does not stop the rest and the first step error is thrown", () => {
    const { calls, step } = recorder();
    const first = new Error("cleanup failed");

    expect(() =>
      teardownThenAssertServed([], step("cleanup", first), step("unstub", new Error("unstub failed")), step("env")),
    ).toThrow(first);

    expect(calls).toEqual(["cleanup", "unstub", "env"]);
  });

  it("a throwing step wins over unserved requests", () => {
    const { calls, step } = recorder();
    const stepError = new Error("cleanup failed");

    expect(() => teardownThenAssertServed(["GET /api/plans/a"], step("cleanup", stepError), step("env"))).toThrow(
      stepError,
    );

    expect(calls).toEqual(["cleanup", "env"]);
  });

  it("returns once everything succeeds and nothing is unserved", () => {
    const { calls, step } = recorder();

    expect(() => teardownThenAssertServed([], step("cleanup"), step("env"))).not.toThrow();

    expect(calls).toEqual(["cleanup", "env"]);
  });
});
