import { afterEach, describe, expect, it } from "vitest";
import { now, resetClock, setClock } from "./clock";

afterEach(() => {
  resetClock();
});

describe("now", () => {
  it("returns wall time from the system clock by default", () => {
    const before = Date.now();
    const instant = now();
    const after = Date.now();
    expect(instant).toBeInstanceOf(Date);
    expect(instant.getTime()).toBeGreaterThanOrEqual(before);
    expect(instant.getTime()).toBeLessThanOrEqual(after);
  });

  it("can be replaced with a frozen instant", () => {
    const frozen = new Date("2026-03-01T12:00:00.000Z");
    setClock(frozen);
    const first = now();
    const second = now();
    expect(first.toISOString()).toBe("2026-03-01T12:00:00.000Z");
    expect(second.getTime()).toBe(first.getTime());

    first.setUTCFullYear(1999);
    expect(now().toISOString()).toBe("2026-03-01T12:00:00.000Z");

    setClock(frozen.getTime() + 20_000);
    expect(now().toISOString()).toBe("2026-03-01T12:00:20.000Z");
  });

  it("can be replaced with a function and restored", () => {
    let ms = Date.parse("2026-03-01T00:00:00.000Z");
    setClock(() => new Date(ms));
    expect(now().toISOString()).toBe("2026-03-01T00:00:00.000Z");
    ms += 3_600_000;
    expect(now().toISOString()).toBe("2026-03-01T01:00:00.000Z");

    resetClock();
    const restored = now().getTime();
    const wall = Date.now();
    expect(now().toISOString()).not.toBe("2026-03-01T01:00:00.000Z");
    expect(Math.abs(wall - restored)).toBeLessThan(1000);
  });
});
