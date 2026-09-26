import { describe, expect, it } from "vitest";
import {
  UNFAIR_EXTRA_SECONDS,
  fairnessWarning,
  isChainFair,
  isUnfair,
  maxTripMinusMedian,
  medianTripSeconds,
} from "./fairness";

describe("medianTripSeconds", () => {
  it("uses the middle value when the count is odd", () => {
    expect(medianTripSeconds([600, 720, 2400])).toBe(720);
    expect(medianTripSeconds([2400, 600, 720])).toBe(720);
  });

  it("uses (T[n/2 - 1] + T[n/2] + 1) // 2 when the count is even", () => {
    expect(Math.floor((600 + 720 + 1) / 2)).toBe(660);
    expect(medianTripSeconds([600, 720])).toBe(660);
    expect(medianTripSeconds([720, 600])).toBe(660);
  });
});

describe("fairnessWarning", () => {
  it("turns on for trips of 600, 720, and 2400 seconds, with median 720", () => {
    const trips = [600, 720, 2400];
    expect(medianTripSeconds(trips)).toBe(720);
    expect(UNFAIR_EXTRA_SECONDS).toBe(1200);
    expect(2400).toBeGreaterThan(720 + 1200);
    expect(2 * 2400).toBeGreaterThan(3 * 720);
    expect(isUnfair(2400, 720)).toBe(true);
    expect(isUnfair(720, 720)).toBe(false);
    expect(isUnfair(600, 720)).toBe(false);
    expect(isChainFair(trips)).toBe(false);
    expect(fairnessWarning(trips)).toBe(true);
    expect(maxTripMinusMedian(trips)).toBe(2400 - 720);
  });

  it("turns off for trips of 600 and 720, with median (600 + 720 + 1) // 2 = 660", () => {
    const trips = [600, 720];
    expect(medianTripSeconds(trips)).toBe(660);
    expect(720).toBeLessThanOrEqual(660 + 1200);
    expect(isUnfair(720, 660)).toBe(false);
    expect(isUnfair(600, 660)).toBe(false);
    expect(isChainFair(trips)).toBe(true);
    expect(fairnessWarning(trips)).toBe(false);
  });
});
