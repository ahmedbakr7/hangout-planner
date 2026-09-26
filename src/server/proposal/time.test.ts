import { describe, expect, it } from "vitest";
import {
  INSTANT_STEP_MINUTES,
  chooseTime,
  coverageAt,
  coversInstant,
  formatLocalMinutes,
  parseLocalMinutes,
  windowInstants,
  type MemberAvailability,
  type TimeWindow,
} from "./time";

function minutes(hhmm: string): number {
  const value = parseLocalMinutes(hhmm);
  expect(value).toEqual(expect.any(Number));
  return value as number;
}

function free(earliest: string, latest: string): MemberAvailability {
  return {
    kind: "free",
    earliestMinutes: minutes(earliest),
    latestMinutes: minutes(latest),
  };
}

const BUSY: MemberAvailability = { kind: "busy" };

const WINDOW_18_19: TimeWindow = {
  localDate: "2026-10-02",
  startMinutes: 18 * 60,
  endMinutes: 19 * 60,
};

describe("windowInstants", () => {
  it("steps 15 minutes from start while strictly before end", () => {
    expect(INSTANT_STEP_MINUTES).toBe(15);
    expect(windowInstants(18 * 60, 19 * 60)).toEqual([
      18 * 60,
      18 * 60 + 15,
      18 * 60 + 30,
      18 * 60 + 45,
    ]);
    expect(windowInstants("18:00", "19:00").map(formatLocalMinutes)).toEqual([
      "18:00",
      "18:15",
      "18:30",
      "18:45",
    ]);
    expect(windowInstants("18:00", "19:00")).not.toContain(minutes("19:00"));
  });
});

describe("coversInstant", () => {
  it("counts a free window that includes the instant, and a busy member covers nothing", () => {
    const a = free("18:00", "18:30");
    const b = free("18:30", "19:00");
    expect(coversInstant(a, "18:30")).toBe(true);
    expect(coversInstant(b, "18:30")).toBe(true);
    expect(coversInstant(a, 18 * 60 + 30)).toBe(true);
    expect(coversInstant(a, "18:00")).toBe(true);
    expect(coversInstant(a, "18:45")).toBe(false);
    expect(coversInstant(b, "18:00")).toBe(false);
    expect(coversInstant(BUSY, "18:30")).toBe(false);
    expect(coversInstant(BUSY, 18 * 60)).toBe(false);
  });
});

describe("chooseTime", () => {
  it("picks 18:30 as the unique maximum coverage of 2; a busy member adds no instant", () => {
    const a = free("18:00", "18:30");
    const b = free("18:30", "19:00");
    expect(coverageAt("18:00", [a, b])).toBe(1);
    expect(coverageAt("18:15", [a, b])).toBe(1);
    expect(coverageAt("18:30", [a, b])).toBe(2);
    expect(coverageAt("18:45", [a, b])).toBe(1);
    expect(coverageAt(18 * 60 + 30, [a, b, BUSY])).toBe(2);

    const chosen = chooseTime([WINDOW_18_19], [[a], [b], [BUSY]]);
    expect(chosen).toEqual({
      timeBlocked: false,
      localDate: "2026-10-02",
      minutes: 18 * 60 + 30,
      coverage: 2,
    });
    if (chosen.timeBlocked) {
      throw new Error("expected a chosen clock time");
    }
    expect(formatLocalMinutes(chosen.minutes)).toBe("18:30");
    expect(chosen.coverage).toBe(2);
    expect(Number.isInteger(chosen.minutes)).toBe(true);
    expect(Number.isInteger(chosen.coverage)).toBe(true);
  });

  it("is time-blocked and stores no clock time when coverage is 0", () => {
    const chosen = chooseTime([WINDOW_18_19], [[BUSY], [BUSY]]);
    expect(chosen).toEqual({ timeBlocked: true });
    expect("minutes" in chosen).toBe(false);
    expect("localDate" in chosen).toBe(false);
    expect(coverageAt("18:30", [BUSY, BUSY])).toBe(0);
  });

  it("picks the earliest instant when two instants share the greatest coverage", () => {
    const a = free("18:00", "18:15");
    const b = free("18:00", "18:15");
    const chosen = chooseTime([WINDOW_18_19], [[a], [b]]);
    expect(chosen).toEqual({
      timeBlocked: false,
      localDate: "2026-10-02",
      minutes: 18 * 60,
      coverage: 2,
    });
  });
});
