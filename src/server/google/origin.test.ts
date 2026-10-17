import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { googleOrigin } from "./origin";

const DEFAULT_ORIGIN = "https://places.googleapis.com";

beforeEach(() => {
  vi.stubEnv("HP_E2E_GOOGLE_BASE_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("googleOrigin", () => {
  it("T-001-60/AC-1 returns the default origin when the variable is unset", () => {
    delete process.env.HP_E2E_GOOGLE_BASE_URL;
    expect(googleOrigin(DEFAULT_ORIGIN)).toBe(DEFAULT_ORIGIN);
  });

  it("T-001-60/AC-1 returns the default origin when the variable is empty", () => {
    vi.stubEnv("HP_E2E_GOOGLE_BASE_URL", "");
    expect(googleOrigin(DEFAULT_ORIGIN)).toBe(DEFAULT_ORIGIN);
  });

  it.each([
    "http://127.0.0.1:4010",
    "http://localhost:4010",
    "http://127.0.0.1:1",
    "http://localhost:65535",
  ])("T-001-60/AC-2 accepts %s and returns it unchanged", (value) => {
    vi.stubEnv("HP_E2E_GOOGLE_BASE_URL", value);
    expect(googleOrigin(DEFAULT_ORIGIN)).toBe(value);
  });

  it("T-001-60/AC-2 reads the variable on every call", () => {
    vi.stubEnv("HP_E2E_GOOGLE_BASE_URL", "http://127.0.0.1:4010");
    expect(googleOrigin(DEFAULT_ORIGIN)).toBe("http://127.0.0.1:4010");
    vi.stubEnv("HP_E2E_GOOGLE_BASE_URL", "http://localhost:4011");
    expect(googleOrigin(DEFAULT_ORIGIN)).toBe("http://localhost:4011");
    vi.stubEnv("HP_E2E_GOOGLE_BASE_URL", "");
    expect(googleOrigin(DEFAULT_ORIGIN)).toBe(DEFAULT_ORIGIN);
  });

  it.each([
    "https://127.0.0.1:4010",
    "https://localhost:4010",
    "http://example.com:4010",
    "http://127.0.0.2:4010",
    "http://127.0.0.1",
    "http://localhost",
    "http://localhost:",
    "http://127.0.0.1:0",
    "http://127.0.0.1:65536",
    "http://127.0.0.1:99999",
    "http://127.0.0.1:123456",
    "http://127.0.0.1:080",
    "http://127.0.0.1:4010/",
    "http://127.0.0.1:4010/v1",
    "http://127.0.0.1:4010?x=1",
    "http://127.0.0.1:4010#frag",
    "http://user:pass@127.0.0.1:4010",
    "http://127.0.0.1:4010 ",
    " http://127.0.0.1:4010",
    "HTTP://127.0.0.1:4010",
    "127.0.0.1:4010",
  ])("T-001-60/AC-3 rejects %j without echoing the value", (value) => {
    vi.stubEnv("HP_E2E_GOOGLE_BASE_URL", value);
    let message = "";
    try {
      googleOrigin(DEFAULT_ORIGIN);
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toContain("HP_E2E_GOOGLE_BASE_URL");
    expect(message).not.toContain(value.trim());
  });

  it("T-001-60/AC-3 never falls back to the default and logs nothing", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("HP_E2E_GOOGLE_BASE_URL", "https://evil.example");
    expect(() => googleOrigin(DEFAULT_ORIGIN)).toThrow();
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
