import { describe, expect, it } from "vitest";
import { isDistinguisher } from "../ids";
import {
  DISPLAY_NAME_MAX,
  PARTICIPANT_CAP,
  allocateDistinguisher,
  asPlanState,
  joinConflictError,
  joinDecision,
  joinParticipantView,
  joinPreview,
  openingBody,
  openingNext,
  parseDisplayName,
  parseJoinBody,
  participantNext,
  takenDistinguishers,
  type JoinCaller,
  type JoinPreview,
  type OpeningNext,
} from "./open";
import type { PlanState } from "../plans/edit-rules";

const CALLERS: JoinCaller[] = [
  "organizer",
  "participant",
  "invited",
  "link_reader",
];

const STATES: PlanState[] = ["collecting", "blocked", "proposed", "locked"];

function jsonKeys(value: object): string[] {
  return Object.keys(value).sort();
}

describe("asPlanState", () => {
  it("keeps the four plan states and treats anything else as collecting", () => {
    expect(STATES.map(asPlanState)).toEqual(STATES);
    expect(asPlanState("other")).toBe("collecting");
  });
});

describe("openingNext", () => {
  it("follows the opening table for organizer, participant, invited, and link reader", () => {
    const expected: Record<JoinCaller, Record<PlanState, OpeningNext>> = {
      organizer: {
        collecting: "organizer",
        blocked: "organizer",
        proposed: "organizer",
        locked: "confirmed",
      },
      participant: {
        collecting: "respond",
        blocked: "respond",
        proposed: "proposal",
        locked: "confirmed",
      },
      invited: {
        collecting: "join",
        blocked: "join",
        proposed: "join",
        locked: "confirmed",
      },
      link_reader: {
        collecting: "join",
        blocked: "join",
        proposed: "join",
        locked: "confirmed",
      },
    };

    for (const caller of CALLERS) {
      for (const state of STATES) {
        expect(openingNext(caller, state)).toBe(expected[caller][state]);
      }
    }
  });
});

describe("participantNext", () => {
  it("is the participant row of the opening table", () => {
    expect(participantNext("collecting")).toBe("respond");
    expect(participantNext("blocked")).toBe("respond");
    expect(participantNext("proposed")).toBe("proposal");
    expect(participantNext("locked")).toBe("confirmed");
  });
});

describe("joinPreview", () => {
  it("returns title, organizer display name, timezone, windows, budget, and step names, and omits option labels, counts, threshold, statuses, starting points, itinerary, and window ids", () => {
    const preview = joinPreview({
      title: "Thursday in Maadi",
      organizer_display_name: "Omar",
      timezone: "Africa/Cairo",
      windows: [
        {
          local_date: "2026-10-02",
          start_local: "18:00",
          end_local: "23:00",
          id: "win_aaaaaaaaaaaaaaaaaaaaaa",
        } as JoinPreview["windows"][number] & { id: string },
      ],
      budget: { amount_minor: 50_000, currency: "EGP" },
      step_names: ["Dinner", "Coffee"],
    });

    expect(preview).toEqual({
      title: "Thursday in Maadi",
      organizer_display_name: "Omar",
      timezone: "Africa/Cairo",
      windows: [
        {
          local_date: "2026-10-02",
          start_local: "18:00",
          end_local: "23:00",
        },
      ],
      budget: { amount_minor: 50_000, currency: "EGP" },
      step_names: ["Dinner", "Coffee"],
    } satisfies JoinPreview);
    expect(jsonKeys(preview)).toEqual(
      [
        "budget",
        "organizer_display_name",
        "step_names",
        "timezone",
        "title",
        "windows",
      ].sort(),
    );
    expect(jsonKeys(preview.windows[0]!)).toEqual(
      ["end_local", "local_date", "start_local"].sort(),
    );
    expect(preview).not.toHaveProperty("threshold");
    expect(preview).not.toHaveProperty("answered_count");
    expect(preview).not.toHaveProperty("options");
    expect(preview).not.toHaveProperty("status");
    expect(preview).not.toHaveProperty("statuses");
    expect(preview).not.toHaveProperty("starting_points");
    expect(preview).not.toHaveProperty("itinerary");
    expect(preview).not.toHaveProperty("participants");
    expect(JSON.stringify(preview)).not.toContain("win_aaaaaaaaaaaaaaaaaaaaaa");
    expect(JSON.stringify(preview)).not.toContain("Koshary");
    expect(JSON.stringify(preview)).not.toContain("distinguisher");
  });
});

describe("openingBody", () => {
  it("uses the opening shape and only includes preview when next is join", () => {
    const preview = joinPreview({
      title: "Thursday in Maadi",
      organizer_display_name: "Omar",
      timezone: "Africa/Cairo",
      windows: [
        {
          local_date: "2026-10-02",
          start_local: "18:00",
          end_local: "23:00",
        },
      ],
      budget: { amount_minor: 50_000, currency: "EGP" },
      step_names: ["Dinner"],
    });

    const join = openingBody(
      "pln_aaaaaaaaaaaaaaaaaaaaaa",
      "link_reader",
      "collecting",
      preview,
    );
    expect(join).toEqual({
      plan_id: "pln_aaaaaaaaaaaaaaaaaaaaaa",
      next: "join",
      preview,
    });
    expect(jsonKeys(join)).toEqual(["next", "plan_id", "preview"].sort());

    const organizer = openingBody(
      "pln_aaaaaaaaaaaaaaaaaaaaaa",
      "organizer",
      "collecting",
      preview,
    );
    expect(organizer.next).toBe("organizer");
    expect(organizer.preview).toBeNull();

    const locked = openingBody(
      "pln_aaaaaaaaaaaaaaaaaaaaaa",
      "link_reader",
      "locked",
      preview,
    );
    expect(locked).toEqual({
      plan_id: "pln_aaaaaaaaaaaaaaaaaaaaaa",
      next: "confirmed",
      preview: null,
    });
  });
});

describe("parseDisplayName / parseJoinBody", () => {
  it("trims a display name to 1–40 characters and does not ask for a password", () => {
    expect(parseDisplayName(" ن ")).toEqual({ ok: true, displayName: "ن" });
    expect(parseDisplayName("a".repeat(DISPLAY_NAME_MAX))).toEqual({
      ok: true,
      displayName: "a".repeat(DISPLAY_NAME_MAX),
    });
    expect(parseDisplayName("   ")).toEqual({
      ok: false,
      field: { path: "display_name", code: "required" },
    });
    expect(parseDisplayName("a".repeat(DISPLAY_NAME_MAX + 1))).toEqual({
      ok: false,
      field: { path: "display_name", code: "too_long" },
    });
    expect(parseDisplayName(undefined)).toEqual({
      ok: false,
      field: { path: "display_name", code: "required" },
    });

    expect(
      parseJoinBody({
        kind: "anonymous",
        display_name: "  Nour  ",
        password: "a-secret-pass",
        extra: true,
      }),
    ).toEqual({ ok: true, kind: "anonymous", displayName: "Nour" });

    expect(parseJoinBody({ kind: "account", display_name: "Ignored" })).toEqual({
      ok: true,
      kind: "account",
    });
    expect(parseJoinBody({ kind: "account", password: "nope" })).toEqual({
      ok: true,
      kind: "account",
    });

    expect(parseJoinBody({})).toEqual({
      ok: false,
      fields: [{ path: "kind", code: "required" }],
    });
    expect(parseJoinBody({ kind: "guest" })).toEqual({
      ok: false,
      fields: [{ path: "kind", code: "not_one" }],
    });
    expect(parseJoinBody({ kind: "anonymous" })).toEqual({
      ok: false,
      fields: [{ path: "display_name", code: "required" }],
    });
  });
});

describe("joinDecision", () => {
  it("rejects organizer, locked, and full, returns existing without a second row, and otherwise creates", () => {
    expect(
      joinDecision({
        isOrganizer: true,
        locked: false,
        alreadyParticipant: false,
        participantCount: 0,
      }),
    ).toEqual({ action: "conflict", reason: "organizer_cannot_join" });
    expect(
      joinDecision({
        isOrganizer: true,
        locked: true,
        alreadyParticipant: false,
        participantCount: 0,
      }),
    ).toEqual({ action: "conflict", reason: "organizer_cannot_join" });
    expect(
      joinDecision({
        isOrganizer: false,
        locked: true,
        alreadyParticipant: true,
        participantCount: 1,
      }),
    ).toEqual({ action: "conflict", reason: "plan_locked" });
    expect(
      joinDecision({
        isOrganizer: false,
        locked: false,
        alreadyParticipant: true,
        participantCount: PARTICIPANT_CAP,
      }),
    ).toEqual({ action: "existing" });
    expect(
      joinDecision({
        isOrganizer: false,
        locked: false,
        alreadyParticipant: false,
        participantCount: PARTICIPANT_CAP,
      }),
    ).toEqual({ action: "conflict", reason: "plan_full" });
    expect(
      joinDecision({
        isOrganizer: false,
        locked: false,
        alreadyParticipant: false,
        participantCount: PARTICIPANT_CAP - 1,
      }),
    ).toEqual({ action: "create" });
  });
});

describe("joinConflictError", () => {
  it("uses 409 plan_locked, organizer_cannot_join, and plan_full", () => {
    expect(joinConflictError("plan_locked")).toMatchObject({
      status: 409,
      body: { error: { code: "conflict", reason: "plan_locked", fields: [] } },
    });
    expect(joinConflictError("organizer_cannot_join")).toMatchObject({
      status: 409,
      body: {
        error: { code: "conflict", reason: "organizer_cannot_join", fields: [] },
      },
    });
    expect(joinConflictError("plan_full")).toMatchObject({
      status: 409,
      body: { error: { code: "conflict", reason: "plan_full", fields: [] } },
    });
  });
});

describe("allocateDistinguisher", () => {
  it("assigns a contract distinguisher unique among participants and pending invitations", () => {
    const taken = takenDistinguishers(["a3k9"], ["k7m2"]);
    expect(taken.has("a3k9")).toBe(true);
    expect(taken.has("k7m2")).toBe(true);

    const sequence = ["a3k9", "k7m2", "ai3k", "m2n4"];
    let index = 0;
    const value = allocateDistinguisher(
      taken,
      () => sequence[index++] ?? "xxxx",
    );
    expect(value).toBe("m2n4");
    expect(isDistinguisher(value)).toBe(true);
    expect(taken.has(value)).toBe(false);

    expect(() =>
      allocateDistinguisher(new Set(["a3k9"]), () => "a3k9"),
    ).toThrow(/unable to allocate distinguisher/);
  });
});

describe("joinParticipantView", () => {
  it("returns id, display_name, and distinguisher only", () => {
    const view = joinParticipantView({
      id: "prt_aaaaaaaaaaaaaaaaaaaaaa",
      displayName: "Nour",
      distinguisher: "a3k9",
    });
    expect(view).toEqual({
      id: "prt_aaaaaaaaaaaaaaaaaaaaaa",
      display_name: "Nour",
      distinguisher: "a3k9",
    });
    expect(jsonKeys(view)).toEqual(["display_name", "distinguisher", "id"].sort());
  });
});
