import { describe, expect, it } from "vitest";
import {
  PLACE_SEARCH_Q_MAX,
  draftIsComplete,
  hasStoredStart,
  incompleteFields,
  parsePlaceSearchQuery,
  parseResponseBody,
  saveCountDecision,
  validateWindowsAndPicks,
} from "./save";

const windows = [
  { id: "win_a", startLocal: "18:00", endLocal: "23:00" },
  { id: "win_b", startLocal: "10:00", endLocal: "14:00" },
] as const;

const steps = [
  { id: "stp_dinner", optionIds: ["opt_koshary", "opt_grills"] },
  { id: "stp_coffee", optionIds: ["opt_turkish", "opt_filter"] },
] as const;

const allWindows = [
  { windowId: "win_a", kind: "busy" as const },
  {
    windowId: "win_b",
    kind: "free" as const,
    earliestLocal: "10:30",
    latestLocal: "13:00",
  },
];

const allPicks = [
  { stepId: "stp_dinner", optionId: "opt_koshary" },
  { stepId: "stp_coffee", optionId: "opt_turkish" },
];

describe("parseResponseBody", () => {
  it("treats omitted windows and picks as empty and start_place_id as optional", () => {
    const parsed = parseResponseBody({});
    expect(parsed.fields).toEqual([]);
    expect(parsed.windows).toEqual([]);
    expect(parsed.picks).toEqual([]);
    expect(parsed.startPlaceId).toBeUndefined();
  });

  it("rejects a non-array windows or picks field and an empty start_place_id", () => {
    const parsed = parseResponseBody({
      windows: { window_id: "win_a" },
      picks: "opt_koshary",
      start_place_id: "",
    });
    expect(parsed.fields).toEqual([
      { path: "start_place_id", code: "required" },
      { path: "windows", code: "required" },
      { path: "picks", code: "required" },
    ]);
  });

  it("keeps a present start_place_id", () => {
    const parsed = parseResponseBody({ start_place_id: "ChIJ-start" });
    expect(parsed.fields).toEqual([]);
    expect(parsed.startPlaceId).toBe("ChIJ-start");
  });
});

describe("validateWindowsAndPicks", () => {
  it("accepts busy without times and free with start ≤ earliest < latest ≤ end", () => {
    const result = validateWindowsAndPicks(
      windows,
      steps,
      [
        { window_id: "win_a", kind: "busy" },
        {
          window_id: "win_b",
          kind: "free",
          earliest_local: "10:30",
          latest_local: "13:00",
        },
      ],
      [
        { step_id: "stp_dinner", option_id: "opt_koshary" },
        { step_id: "stp_coffee", option_id: "opt_turkish" },
      ],
    );
    expect(result).toEqual({ ok: true, windows: allWindows, picks: allPicks });
  });

  it("rejects a window id that is not on the plan and a pick whose option is not on that step", () => {
    const result = validateWindowsAndPicks(
      windows,
      steps,
      [{ window_id: "win_other", kind: "busy" }],
      [{ step_id: "stp_dinner", option_id: "opt_turkish" }],
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.fields).toEqual([
      { path: "windows[0].window_id", code: "unknown" },
      { path: "picks[0].option_id", code: "unknown" },
    ]);
  });

  it("rejects busy with times, free without times, times outside the window, and inverted free times", () => {
    const result = validateWindowsAndPicks(
      windows,
      steps,
      [
        { window_id: "win_a", kind: "busy", earliest_local: "18:30" },
        { window_id: "win_b", kind: "free" },
      ],
      [],
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.fields).toContainEqual({
      path: "windows[0].earliest_local",
      code: "unknown",
    });
    expect(result.fields).toContainEqual({
      path: "windows[1].earliest_local",
      code: "required",
    });
    expect(result.fields).toContainEqual({
      path: "windows[1].latest_local",
      code: "required",
    });

    const outside = validateWindowsAndPicks(
      windows,
      steps,
      [
        {
          window_id: "win_a",
          kind: "free",
          earliest_local: "17:00",
          latest_local: "22:00",
        },
      ],
      [],
    );
    expect(outside.ok).toBe(false);
    if (outside.ok) {
      return;
    }
    expect(outside.fields).toContainEqual({
      path: "windows[0].earliest_local",
      code: "outside_window",
    });

    const inverted = validateWindowsAndPicks(
      windows,
      steps,
      [
        {
          window_id: "win_a",
          kind: "free",
          earliest_local: "21:00",
          latest_local: "19:00",
        },
      ],
      [],
    );
    expect(inverted.ok).toBe(false);
    if (inverted.ok) {
      return;
    }
    expect(inverted.fields).toContainEqual({
      path: "windows[0].latest_local",
      code: "end_before_start",
    });
  });

  it("rejects a duplicate window, a duplicate step pick, a bad kind, and a bad time", () => {
    const result = validateWindowsAndPicks(
      windows,
      steps,
      [
        { window_id: "win_a", kind: "busy" },
        { window_id: "win_a", kind: "free", earliest_local: "18:00", latest_local: "19:00" },
        { window_id: "win_b", kind: "maybe" },
        {
          window_id: "win_b",
          kind: "free",
          earliest_local: "10:0",
          latest_local: "14:00",
        },
      ],
      [
        { step_id: "stp_dinner", option_id: "opt_koshary" },
        { step_id: "stp_dinner", option_id: "opt_grills" },
      ],
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.fields).toContainEqual({
      path: "windows[1].window_id",
      code: "not_one",
    });
    expect(result.fields).toContainEqual({
      path: "windows[2].kind",
      code: "not_one",
    });
    expect(result.fields).toContainEqual({
      path: "picks[1].step_id",
      code: "not_one",
    });
  });

  it("allows earliest equal to window start and latest equal to window end", () => {
    const result = validateWindowsAndPicks(
      windows,
      steps,
      [
        {
          window_id: "win_a",
          kind: "free",
          earliest_local: "18:00",
          latest_local: "23:00",
        },
      ],
      [],
    );
    expect(result).toEqual({
      ok: true,
      windows: [
        {
          windowId: "win_a",
          kind: "free",
          earliestLocal: "18:00",
          latestLocal: "23:00",
        },
      ],
      picks: [],
    });
  });
});

describe("draftIsComplete and saveCountDecision", () => {
  it("is incomplete without every window, a stored start, and one pick per step", () => {
    expect(draftIsComplete(windows, steps, allWindows, allPicks, false)).toBe(
      false,
    );
    expect(
      draftIsComplete(windows, steps, [allWindows[0]!], allPicks, true),
    ).toBe(false);
    expect(
      draftIsComplete(windows, steps, allWindows, [allPicks[0]!], true),
    ).toBe(false);
    expect(draftIsComplete(windows, steps, allWindows, allPicks, true)).toBe(
      true,
    );
  });

  it("an incomplete valid save by an incomplete caller does not increment; the first complete save increments once", () => {
    expect(saveCountDecision(false, false)).toEqual({
      ok: true,
      complete: false,
      firstCompletion: false,
      incrementCount: false,
    });
    expect(saveCountDecision(false, true)).toEqual({
      ok: true,
      complete: true,
      firstCompletion: true,
      incrementCount: true,
    });
  });

  it("a later complete save does not increment; an incomplete body from a complete caller is rejected", () => {
    expect(saveCountDecision(true, true)).toEqual({
      ok: true,
      complete: true,
      firstCompletion: false,
      incrementCount: false,
    });
    expect(saveCountDecision(true, false)).toEqual({ ok: false });
  });

  it("names the missing window, start, and pick when a complete caller sends an incomplete body", () => {
    expect(
      incompleteFields(windows, steps, [allWindows[0]!], [], false),
    ).toEqual([
      { path: "windows", code: "below_min" },
      { path: "start_place_id", code: "required" },
      { path: "picks", code: "not_one" },
    ]);
  });
});

describe("hasStoredStart", () => {
  it("requires place id, display name, latitude, and longitude", () => {
    expect(hasStoredStart(null)).toBe(false);
    expect(
      hasStoredStart({
        startGooglePlaceId: "ChIJ-start",
        startName: "Maadi, Cairo",
        startLat: 29.96,
        startLng: 31.25,
      }),
    ).toBe(true);
    expect(
      hasStoredStart({
        startGooglePlaceId: "ChIJ-start",
        startName: "Maadi, Cairo",
        startLat: null,
        startLng: 31.25,
      }),
    ).toBe(false);
  });
});

describe("parsePlaceSearchQuery", () => {
  it("requires q of 1–80 characters after trim", () => {
    expect(parsePlaceSearchQuery(null)).toEqual({
      ok: false,
      fields: [{ path: "q", code: "required" }],
    });
    expect(parsePlaceSearchQuery("   ")).toEqual({
      ok: false,
      fields: [{ path: "q", code: "required" }],
    });
    expect(parsePlaceSearchQuery(" Maadi ")).toEqual({
      ok: true,
      q: "Maadi",
    });
    expect(parsePlaceSearchQuery("x".repeat(PLACE_SEARCH_Q_MAX))).toEqual({
      ok: true,
      q: "x".repeat(PLACE_SEARCH_Q_MAX),
    });
    expect(parsePlaceSearchQuery("x".repeat(PLACE_SEARCH_Q_MAX + 1))).toEqual({
      ok: false,
      fields: [{ path: "q", code: "too_long" }],
    });
  });
});
