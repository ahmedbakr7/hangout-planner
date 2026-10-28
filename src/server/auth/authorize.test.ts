import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateJoinToken } from "../ids";
import { authorize, type PlanAuthzFacts } from "./authorize";

const organizerId = `acc_${"a".repeat(22)}`;
const memberId = `acc_${"b".repeat(22)}`;
const joinToken = generateJoinToken();

function facts(overrides: Partial<PlanAuthzFacts> = {}): PlanAuthzFacts {
  return {
    sessionAccountId: null,
    organizerAccountId: organizerId,
    accountHasParticipant: false,
    guestOwnsParticipant: false,
    accountHasInvitation: false,
    linkIncludesPlan: false,
    requestJoinToken: null,
    planJoinToken: joinToken,
    ...overrides,
  };
}

describe("authorize", () => {
  it("returns organizer when the session account is the organizer", () => {
    expect(
      authorize(
        facts({
          sessionAccountId: organizerId,
          accountHasParticipant: true,
          guestOwnsParticipant: true,
          accountHasInvitation: true,
          linkIncludesPlan: true,
          requestJoinToken: joinToken,
        }),
      ),
    ).toBe("organizer");
  });

  it("returns participant when the session account has a participant row", () => {
    expect(
      authorize(
        facts({
          sessionAccountId: memberId,
          accountHasParticipant: true,
          accountHasInvitation: true,
          linkIncludesPlan: true,
          requestJoinToken: joinToken,
        }),
      ),
    ).toBe("participant");
  });

  it("returns participant when the guest session owns a participant", () => {
    expect(
      authorize(
        facts({
          guestOwnsParticipant: true,
          linkIncludesPlan: true,
          requestJoinToken: joinToken,
        }),
      ),
    ).toBe("participant");
    expect(
      authorize(
        facts({
          sessionAccountId: memberId,
          guestOwnsParticipant: true,
        }),
      ),
    ).toBe("participant");
  });

  it("returns invited when the session account has an invitation", () => {
    expect(
      authorize(
        facts({
          sessionAccountId: memberId,
          accountHasInvitation: true,
          linkIncludesPlan: true,
          requestJoinToken: joinToken,
        }),
      ),
    ).toBe("invited");
  });

  it("returns link_reader when the link session includes the plan", () => {
    expect(authorize(facts({ linkIncludesPlan: true }))).toBe("link_reader");
    expect(
      authorize(
        facts({
          sessionAccountId: memberId,
          linkIncludesPlan: true,
          requestJoinToken: "not-the-plan-token",
        }),
      ),
    ).toBe("link_reader");
  });

  it("returns link_reader when the request presents this plan's join token", () => {
    expect(
      authorize(
        facts({
          requestJoinToken: joinToken,
        }),
      ),
    ).toBe("link_reader");

    const digest = createHash("sha256").update(joinToken, "utf8").digest("hex");
    expect(
      authorize(
        facts({
          requestJoinToken: digest,
        }),
      ),
    ).toBeNull();
    expect(
      authorize(
        facts({
          requestJoinToken: joinToken,
          planJoinToken: digest,
        }),
      ),
    ).toBeNull();
  });

  it("returns no role for anyone else", () => {
    expect(authorize(facts())).toBeNull();
    expect(
      authorize(
        facts({
          sessionAccountId: memberId,
          requestJoinToken: `${joinToken}x`,
        }),
      ),
    ).toBeNull();
    expect(
      authorize(
        facts({
          sessionAccountId: "",
          accountHasParticipant: true,
          accountHasInvitation: true,
        }),
      ),
    ).toBeNull();
    expect(
      authorize(
        facts({
          sessionAccountId: organizerId.toUpperCase(),
        }),
      ),
    ).toBeNull();
    expect(
      authorize(
        facts({
          requestJoinToken: "é".repeat(joinToken.length),
        }),
      ),
    ).toBeNull();
  });

  it("T-001-91/AC-5 T-001-05/AC-5 T-001-05/AC-6 returns the first match among organizer, participant, invited, and link reader, in that order, and no role for anyone else", () => {
    const everything: PlanAuthzFacts = facts({
      sessionAccountId: organizerId,
      accountHasParticipant: true,
      guestOwnsParticipant: true,
      accountHasInvitation: true,
      linkIncludesPlan: true,
      requestJoinToken: joinToken,
    });
    // Each step removes the facts of the role above it; the next role in the order wins.
    const ladder: [string, PlanAuthzFacts, ReturnType<typeof authorize>][] = [
      ["organizer", everything, "organizer"],
      ["participant", { ...everything, sessionAccountId: memberId }, "participant"],
      [
        "invited",
        { ...everything, sessionAccountId: memberId, accountHasParticipant: false, guestOwnsParticipant: false },
        "invited",
      ],
      [
        "link reader",
        {
          ...everything,
          sessionAccountId: memberId,
          accountHasParticipant: false,
          guestOwnsParticipant: false,
          accountHasInvitation: false,
        },
        "link_reader",
      ],
      [
        "anyone else",
        {
          ...everything,
          sessionAccountId: memberId,
          accountHasParticipant: false,
          guestOwnsParticipant: false,
          accountHasInvitation: false,
          linkIncludesPlan: false,
          requestJoinToken: null,
        },
        null,
      ],
    ];
    expect(ladder.map(([name, input]) => [name, authorize(input)])).toEqual(
      ladder.map(([name, , expected]) => [name, expected]),
    );
    expect(ladder.map(([, , expected]) => expected)).toEqual([
      "organizer",
      "participant",
      "invited",
      "link_reader",
      null,
    ]);

    // Each role on its own, with nothing above it.
    expect(authorize(facts({ sessionAccountId: organizerId }))).toBe("organizer");
    expect(authorize(facts({ sessionAccountId: memberId, accountHasParticipant: true }))).toBe("participant");
    expect(authorize(facts({ guestOwnsParticipant: true }))).toBe("participant");
    expect(authorize(facts({ sessionAccountId: memberId, accountHasInvitation: true }))).toBe("invited");
    expect(authorize(facts({ linkIncludesPlan: true }))).toBe("link_reader");
    expect(authorize(facts({ requestJoinToken: joinToken }))).toBe("link_reader");

    // No role for anyone else: a stranger account, no session, or a wrong join token.
    expect(authorize(facts())).toBeNull();
    expect(authorize(facts({ sessionAccountId: memberId }))).toBeNull();
    expect(authorize(facts({ requestJoinToken: generateJoinToken() }))).toBeNull();
  });

  it("returns the first match among organizer, participant, invited, and link reader", () => {
    const all: PlanAuthzFacts = facts({
      sessionAccountId: organizerId,
      accountHasParticipant: true,
      guestOwnsParticipant: true,
      accountHasInvitation: true,
      linkIncludesPlan: true,
      requestJoinToken: joinToken,
    });
    expect(authorize(all)).toBe("organizer");
    expect(authorize({ ...all, sessionAccountId: memberId })).toBe("participant");
    expect(
      authorize({
        ...all,
        sessionAccountId: memberId,
        accountHasParticipant: false,
        guestOwnsParticipant: false,
      }),
    ).toBe("invited");
    expect(
      authorize({
        ...all,
        sessionAccountId: null,
        accountHasParticipant: true,
        guestOwnsParticipant: false,
        accountHasInvitation: true,
      }),
    ).toBe("link_reader");
  });
});
