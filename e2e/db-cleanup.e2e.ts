import { describe, expect, it } from "vitest";
import { cleanupThenClose } from "./db-cleanup";

function recorder() {
  const calls: string[] = [];
  const closer = (name: string, error?: Error) => async () => {
    calls.push(name);
    if (error) throw error;
  };
  return { calls, closer };
}

describe("cleanupThenClose", () => {
  it("T-001-54/AC-1 a throwing cleanup still runs every closer and rejects with the cleanup error", async () => {
    const { calls, closer } = recorder();
    const cleanupError = new Error("delete failed");

    await expect(
      cleanupThenClose(closer("cleanup", cleanupError), closer("sql"), closer("accounts")),
    ).rejects.toBe(cleanupError);

    expect(calls).toEqual(["cleanup", "sql", "accounts"]);
  });

  it("T-001-54/AC-1 a throwing cleanup wins over a throwing closer", async () => {
    const { calls, closer } = recorder();
    const cleanupError = new Error("delete failed");

    await expect(
      cleanupThenClose(closer("cleanup", cleanupError), closer("sql", new Error("end failed"))),
    ).rejects.toBe(cleanupError);

    expect(calls).toEqual(["cleanup", "sql"]);
  });

  it("T-001-54/AC-2 a throwing closer does not stop the rest and the first closer error is the rejection", async () => {
    const { calls, closer } = recorder();
    const first = new Error("first end failed");

    await expect(
      cleanupThenClose(
        closer("cleanup"),
        closer("sql", first),
        closer("accounts", new Error("second end failed")),
        closer("plans"),
      ),
    ).rejects.toBe(first);

    expect(calls).toEqual(["cleanup", "sql", "accounts", "plans"]);
  });

  it("T-001-54/AC-2 resolves once everything succeeds", async () => {
    const { calls, closer } = recorder();

    await expect(cleanupThenClose(closer("cleanup"), closer("sql"))).resolves.toBeUndefined();

    expect(calls).toEqual(["cleanup", "sql"]);
  });
});
