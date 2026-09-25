import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const postgresMock = vi.fn(() => ({}));

vi.mock("postgres", () => ({
  default: (...args: unknown[]) => postgresMock(...args),
}));

describe("createDb", () => {
  const original = process.env.DATABASE_URL;

  beforeEach(() => {
    vi.resetModules();
    postgresMock.mockClear();
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = original;
    }
  });

  it("throws when DATABASE_URL is missing", async () => {
    delete process.env.DATABASE_URL;
    const { createDb } = await import("./client");
    expect(() => createDb()).toThrow(/DATABASE_URL/);
    expect(postgresMock).not.toHaveBeenCalled();
  });

  it("reads DATABASE_URL and constructs a Drizzle client", async () => {
    const url = "postgres://user:pass@127.0.0.1:5432/testdb";
    process.env.DATABASE_URL = url;
    const { createDb } = await import("./client");
    const db = createDb();
    expect(postgresMock).toHaveBeenCalledWith(url);
    expect(db).toBeDefined();
  });

  it("accepts an explicit connection string over the environment", async () => {
    delete process.env.DATABASE_URL;
    const url = "postgres://explicit@127.0.0.1:5432/db";
    const { createDb } = await import("./client");
    createDb(url);
    expect(postgresMock).toHaveBeenCalledWith(url);
  });
});
