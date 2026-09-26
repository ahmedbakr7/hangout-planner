import { describe, expect, it } from "vitest";
import { isDistinguisher } from "../ids";
import { takenDistinguishers } from "../join/open";
import {
  EMAIL_MAX,
  INVITATION_STATUSES,
  accountNotFoundError,
  cannotInviteSelfError,
  invitationDistinguisher,
  invitationStatus,
  inviteCallerError,
  inviteJoinPath,
  inviteReadBody,
  parseInviteEmail,
  planLockedInviteError,
  sendInviteDecision,
  sentInvitation,
} from "./send";

function jsonKeys(value: object): string[] {
  return Object.keys(value).sort();
}

describe("parseInviteEmail", () => {
  it("trims and lowercases a valid email", () => {
    expect(parseInviteEmail("  Hana@Example.COM  ")).toEqual({
      ok: true,
      email: "hana@example.com",
    });
  });

  it("rejects a missing, blank, too-long, or malformed email", () => {
    expect(parseInviteEmail(undefined)).toEqual({
      ok: false,
      fields: [{ path: "email", code: "required" }],
    });
    expect(parseInviteEmail("   ")).toEqual({
      ok: false,
      fields: [{ path: "email", code: "required" }],
    });
    expect(parseInviteEmail(`a@${"b".repeat(EMAIL_MAX)}.c`)).toEqual({
      ok: false,
      fields: [{ path: "email", code: "too_long" }],
    });
    expect(parseInviteEmail("nour.example.com")).toEqual({
      ok: false,
      fields: [{ path: "email", code: "bad_email" }],
    });
    expect(parseInviteEmail("nour@example")).toEqual({
      ok: false,
      fields: [{ path: "email", code: "bad_email" }],
    });
    expect(parseInviteEmail("nour@@example.com")).toEqual({
      ok: false,
      fields: [{ path: "email", code: "bad_email" }],
    });
    expect(parseInviteEmail("nour@example.com.")).toEqual({
      ok: false,
      fields: [{ path: "email", code: "bad_email" }],
    });
  });
});

describe("invitationStatus / sentInvitation", () => {
  it("is invited, joined, or answered from participant and complete flags", () => {
    expect(INVITATION_STATUSES).toEqual(["invited", "joined", "answered"]);
    expect(
      invitationStatus({ hasParticipant: false, responseComplete: true }),
    ).toBe("invited");
    expect(
      invitationStatus({ hasParticipant: true, responseComplete: false }),
    ).toBe("joined");
    expect(
      invitationStatus({ hasParticipant: true, responseComplete: true }),
    ).toBe("answered");

    const row = sentInvitation({
      displayName: "Hana",
      distinguisher: "k7m2",
      hasParticipant: false,
      responseComplete: false,
    });
    expect(row).toEqual({
      display_name: "Hana",
      distinguisher: "k7m2",
      status: "invited",
    });
    expect(jsonKeys(row)).toEqual(
      ["display_name", "distinguisher", "status"].sort(),
    );
    expect(JSON.stringify(row)).not.toContain("@");
    expect(row).not.toHaveProperty("email");
    expect(row).not.toHaveProperty("id");
    expect(row).not.toHaveProperty("account_id");
  });
});

describe("inviteJoinPath / inviteReadBody", () => {
  it("builds a stable join_path and lists one sent row per account", () => {
    const token = "jt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    expect(inviteJoinPath(token)).toBe(`/join/${token}`);
    expect(inviteJoinPath(token)).toBe(inviteJoinPath(token));

    const body = inviteReadBody(token, [
      {
        display_name: "Hana",
        distinguisher: "k7m2",
        status: "invited",
      },
    ]);
    expect(body).toEqual({
      join_path: `/join/${token}`,
      invitations: [
        { display_name: "Hana", distinguisher: "k7m2", status: "invited" },
      ],
    });
    expect(jsonKeys(body)).toEqual(["invitations", "join_path"].sort());
    expect(jsonKeys(body.invitations[0]!)).toEqual(
      ["display_name", "distinguisher", "status"].sort(),
    );
  });
});

describe("invitationDistinguisher", () => {
  it("reuses a participant distinguisher and otherwise allocates one unique among participants and pending invitations", () => {
    expect(
      invitationDistinguisher({
        participantDistinguisher: "a3k9",
        taken: takenDistinguishers(["a3k9"], ["k7m2"]),
      }),
    ).toBe("a3k9");

    const taken = takenDistinguishers(["a3k9"], ["k7m2"]);
    const sequence = ["a3k9", "k7m2", "m2n4"];
    let index = 0;
    const value = invitationDistinguisher({
      participantDistinguisher: null,
      taken,
      generate: () => sequence[index++] ?? "xxxx",
    });
    expect(value).toBe("m2n4");
    expect(isDistinguisher(value)).toBe(true);
    expect(taken.has(value)).toBe(false);
  });
});

describe("sendInviteDecision", () => {
  const organizerId = "acc_aaaaaaaaaaaaaaaaaaaaaa";

  it("rejects locked, invalid email, unknown account, and the organizer, and otherwise proceeds", () => {
    expect(
      sendInviteDecision({
        locked: true,
        email: "hana@example.com",
        organizerAccountId: organizerId,
        matchedAccount: { id: "acc_bbbbbbbbbbbbbbbbbbbbbb" },
      }),
    ).toEqual({ action: "locked" });
    expect(
      sendInviteDecision({
        locked: true,
        email: "not-an-email",
        organizerAccountId: organizerId,
        matchedAccount: null,
      }),
    ).toEqual({ action: "locked" });
    expect(
      sendInviteDecision({
        locked: false,
        email: "not-an-email",
        organizerAccountId: organizerId,
        matchedAccount: null,
      }),
    ).toEqual({
      action: "invalid",
      fields: [{ path: "email", code: "bad_email" }],
    });
    expect(
      sendInviteDecision({
        locked: false,
        email: "  Hana@Example.COM ",
        organizerAccountId: organizerId,
        matchedAccount: null,
      }),
    ).toEqual({ action: "unknown" });
    expect(
      sendInviteDecision({
        locked: false,
        email: "omar@example.com",
        organizerAccountId: organizerId,
        matchedAccount: { id: organizerId },
      }),
    ).toEqual({ action: "self" });
    expect(
      sendInviteDecision({
        locked: false,
        email: "  Hana@Example.COM ",
        organizerAccountId: organizerId,
        matchedAccount: { id: "acc_bbbbbbbbbbbbbbbbbbbbbb" },
      }),
    ).toEqual({ action: "proceed", email: "hana@example.com" });
  });
});

describe("inviteCallerError / invite send errors", () => {
  it("returns 404 for a stranger, 403 organizer_only for a known non-organizer, and the invite conflict envelopes", () => {
    expect(inviteCallerError("organizer")).toBeNull();
    expect(inviteCallerError(null)?.status).toBe(404);
    expect(inviteCallerError(null)?.body).toEqual({
      error: { code: "not_found", message: "plan not found", fields: [] },
    });
    expect("reason" in (inviteCallerError(null)?.body.error ?? {})).toBe(false);

    for (const role of ["participant", "invited", "link_reader"] as const) {
      expect(inviteCallerError(role)).toMatchObject({
        status: 403,
        body: {
          error: {
            code: "forbidden",
            reason: "organizer_only",
            fields: [],
          },
        },
      });
    }

    expect(accountNotFoundError()).toMatchObject({
      status: 404,
      body: {
        error: {
          code: "not_found",
          reason: "account_not_found",
          fields: [],
        },
      },
    });
    expect(cannotInviteSelfError()).toMatchObject({
      status: 409,
      body: {
        error: { code: "conflict", reason: "cannot_invite_self", fields: [] },
      },
    });
    expect(planLockedInviteError()).toMatchObject({
      status: 409,
      body: {
        error: { code: "conflict", reason: "plan_locked", fields: [] },
      },
    });
  });
});
