import { describe, expect, it } from "vitest";
import { editableFor } from "./edit-rules";
import {
  organizerPlanView,
  participantResponseView,
  type OrganizerPlanInput,
  type OrganizerPlanView,
  type ParticipantResponseInput,
  type ParticipantResponseView,
} from "./views";

const windowRow = {
  id: "win_aaaaaaaaaaaaaaaaaaaaaa",
  local_date: "2026-10-02",
  start_local: "18:00",
  end_local: "23:00",
};

const stepRow = {
  id: "stp_aaaaaaaaaaaaaaaaaaaaaa",
  name: "Dinner",
  options: [
    { id: "opt_aaaaaaaaaaaaaaaaaaaaaa", label: "Koshary" },
    { id: "opt_bbbbbbbbbbbbbbbbbbbbbb", label: "Grills" },
  ],
};

function organizerSource(): OrganizerPlanInput {
  return {
    id: "pln_aaaaaaaaaaaaaaaaaaaaaa",
    title: "Thursday in Maadi",
    state: "collecting",
    timezone: "Africa/Cairo",
    windows: [windowRow],
    budget: { amount_minor: 50_000, currency: "EGP" },
    steps: [stepRow],
    threshold: 3,
    answered_count: 1,
    participants: [
      {
        id: "prt_bbbbbbbbbbbbbbbbbbbbbb",
        display_name: "Hana",
        distinguisher: "k7m2",
        status: "in_progress",
        created_at: "2026-09-02T10:00:00.000Z",
      },
      {
        id: "prt_aaaaaaaaaaaaaaaaaaaaaa",
        display_name: "Nour",
        distinguisher: "a3k9",
        status: "answered",
        created_at: "2026-09-01T10:00:00.000Z",
      },
    ],
  };
}

function participantSource(): ParticipantResponseInput {
  return {
    state: "collecting",
    timezone: "Africa/Cairo",
    budget: { amount_minor: 50_000, currency: "EGP" },
    windows: [windowRow],
    steps: [stepRow],
    response: {
      complete: false,
      windows: [
        {
          window_id: windowRow.id,
          kind: "free",
          earliest_local: "18:30",
          latest_local: "21:00",
        },
      ],
      start: { name: "Maadi, Cairo" },
      picks: [
        {
          step_id: stepRow.id,
          option_id: "opt_aaaaaaaaaaaaaaaaaaaaaa",
        },
      ],
    },
  };
}

function jsonKeys(value: object): string[] {
  return Object.keys(value).sort();
}

function serialized(value: unknown): string {
  return JSON.stringify(value);
}

describe("organizerPlanView", () => {
  it("returns the organizer plan shape with editable, counts, and participants in created_at then id order", () => {
    const view = organizerPlanView(organizerSource());
    expect(view).toEqual({
      id: "pln_aaaaaaaaaaaaaaaaaaaaaa",
      title: "Thursday in Maadi",
      state: "collecting",
      timezone: "Africa/Cairo",
      windows: [windowRow],
      budget: { amount_minor: 50_000, currency: "EGP" },
      steps: [stepRow],
      threshold: 3,
      answered_count: 1,
      in_progress_count: 1,
      participants: [
        {
          id: "prt_aaaaaaaaaaaaaaaaaaaaaa",
          display_name: "Nour",
          distinguisher: "a3k9",
          status: "answered",
        },
        {
          id: "prt_bbbbbbbbbbbbbbbbbbbbbb",
          display_name: "Hana",
          distinguisher: "k7m2",
          status: "in_progress",
        },
      ],
      editable: editableFor("collecting", 1),
    } satisfies OrganizerPlanView);
    expect(jsonKeys(view)).toEqual(
      [
        "answered_count",
        "budget",
        "editable",
        "id",
        "in_progress_count",
        "participants",
        "state",
        "steps",
        "threshold",
        "timezone",
        "title",
        "windows",
      ].sort(),
    );
    expect(jsonKeys(view.participants[0])).toEqual(
      ["display_name", "distinguisher", "id", "status"].sort(),
    );
  });

  it("includes no starting points, step picks, or itinerary", () => {
    const source = {
      ...organizerSource(),
      starting_points: [
        {
          participant_id: "prt_aaaaaaaaaaaaaaaaaaaaaa",
          name: "Maadi, Cairo",
          lat: 29.96,
          lng: 31.25,
          google_place_id: "ChIJ-start",
        },
      ],
      itinerary: {
        time: { local_date: "2026-10-02", local_time: "18:30" },
        steps: [{ place: "Abu Tarek" }],
        legs: [{ duration_seconds: 840 }],
      },
      proposal: { steps: [{ place_name: "Abu Tarek" }] },
      legs: [{ from_step_id: "stp_a", to_step_id: "stp_b" }],
      participants: organizerSource().participants.map((participant) => ({
        ...participant,
        start: {
          name: "Maadi, Cairo",
          lat: 29.96,
          lng: 31.25,
          google_place_id: "ChIJ-start",
        },
        starting_point: { name: "hidden" },
        picks: [{ step_id: stepRow.id, option_id: "opt_aaaaaaaaaaaaaaaaaaaaaa" }],
      })),
      steps: [
        {
          ...stepRow,
          picks: [{ participant_id: "prt_aaaaaaaaaaaaaaaaaaaaaa" }],
        },
      ],
    };

    const view = organizerPlanView(source);
    const json = serialized(view);

    expect(view).not.toHaveProperty("starting_points");
    expect(view).not.toHaveProperty("itinerary");
    expect(view).not.toHaveProperty("proposal");
    expect(view).not.toHaveProperty("legs");
    expect(view.participants[0]).not.toHaveProperty("start");
    expect(view.participants[0]).not.toHaveProperty("picks");
    expect(view.steps[0]).not.toHaveProperty("picks");
    expect(json).not.toContain("starting_points");
    expect(json).not.toContain("itinerary");
    expect(json).not.toContain("google_place_id");
    expect(json).not.toContain("ChIJ-start");
    expect(json).not.toContain("Abu Tarek");
    expect(json).not.toContain("duration_seconds");
    expect(json).not.toContain("lat");
    expect(json).not.toContain("lng");
    expect(json).not.toMatch(/"picks"/);
    expect(view.windows[0]).toEqual(windowRow);
    expect(view.steps[0].options.map((option) => option.label)).toEqual([
      "Koshary",
      "Grills",
    ]);
  });
});

describe("participantResponseView", () => {
  it("returns the response payload for the caller", () => {
    const view = participantResponseView(participantSource());
    expect(view).toEqual({
      plan_state: "collecting",
      budget: { amount_minor: 50_000, currency: "EGP" },
      timezone: "Africa/Cairo",
      windows: [windowRow],
      steps: [stepRow],
      response: {
        complete: false,
        windows: [
          {
            window_id: windowRow.id,
            kind: "free",
            earliest_local: "18:30",
            latest_local: "21:00",
          },
        ],
        start: { name: "Maadi, Cairo" },
        picks: [
          {
            step_id: stepRow.id,
            option_id: "opt_aaaaaaaaaaaaaaaaaaaaaa",
          },
        ],
      },
    } satisfies ParticipantResponseView);
    expect(jsonKeys(view)).toEqual(
      [
        "budget",
        "plan_state",
        "response",
        "steps",
        "timezone",
        "windows",
      ].sort(),
    );
    expect(jsonKeys(view.response)).toEqual(
      ["complete", "picks", "start", "windows"].sort(),
    );
    expect(jsonKeys(view.response.start as object)).toEqual(["name"]);
  });

  it("omits other participants, other starting points, the answered count, and the threshold", () => {
    const source = {
      ...participantSource(),
      threshold: 3,
      answered_count: 2,
      in_progress_count: 1,
      participants: [
        {
          id: "prt_aaaaaaaaaaaaaaaaaaaaaa",
          display_name: "Nour",
          distinguisher: "a3k9",
          status: "answered",
          start: {
            name: "Zamalek",
            lat: 30.06,
            lng: 31.22,
            google_place_id: "ChIJ-other",
          },
        },
        {
          id: "prt_cccccccccccccccccccccc",
          display_name: "Omar",
          start: { name: "Heliopolis", google_place_id: "ChIJ-omar" },
        },
      ],
      other_starting_points: [{ name: "Zamalek", lat: 30.06, lng: 31.22 }],
      response: {
        complete: false,
        windows: [
          {
            window_id: windowRow.id,
            kind: "busy",
            earliest_local: "18:00",
            latest_local: "23:00",
          },
        ],
        start: {
          name: "Maadi, Cairo",
          lat: 29.96,
          lng: 31.25,
          google_place_id: "ChIJ-self",
        },
        picks: participantSource().response.picks,
      },
    };

    const view = participantResponseView(source);
    const json = serialized(view);

    expect(view).not.toHaveProperty("threshold");
    expect(view).not.toHaveProperty("answered_count");
    expect(view).not.toHaveProperty("in_progress_count");
    expect(view).not.toHaveProperty("participants");
    expect(view).not.toHaveProperty("other_starting_points");
    expect(view.response.start).toEqual({ name: "Maadi, Cairo" });
    expect(view.response.windows).toEqual([
      { window_id: windowRow.id, kind: "busy" },
    ]);
    expect(json).not.toContain("threshold");
    expect(json).not.toContain("answered_count");
    expect(json).not.toContain("prt_cccccccccccccccccccccc");
    expect(json).not.toContain("Omar");
    expect(json).not.toContain("Zamalek");
    expect(json).not.toContain("Heliopolis");
    expect(json).not.toContain("ChIJ-other");
    expect(json).not.toContain("ChIJ-omar");
    expect(json).not.toContain("ChIJ-self");
    expect(json).not.toContain("google_place_id");
    expect(json).not.toContain("\"lat\"");
    expect(json).not.toContain("\"lng\"");
    expect(json).not.toContain("participants");
  });
});
