import { afterEach, describe, expect, it, vi } from "vitest";
import { fairnessWarning, maxTripMinusMedian, medianTripSeconds } from "./fairness";
import { rankChains, type ChainInput } from "./rank";
import { chooseTime, type MemberAvailability } from "./time";

const { dbCalls } = vi.hoisted(() => ({ dbCalls: { count: 0 } }));

// Any database access from the scoring modules would go through this client; it refuses and counts.
vi.mock("@/server/db/client", () => ({
  db: () => {
    dbCalls.count += 1;
    throw new Error("scoring must not touch the database");
  },
  closeDatabase: async () => {
    dbCalls.count += 1;
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

const FAIR_TRIPS = [600, 720, 800] as const;
const UNFAIR_TRIPS = [600, 720, 2400] as const;

function chain(
  placeIds: readonly string[],
  betweenPlaceDurationSum: number,
  memberTripSeconds: readonly number[],
): ChainInput {
  return { placeIds, betweenPlaceDurationSum, memberTripSeconds };
}

describe("rankChains", () => {
  it("orders a fair chain ahead of a shorter unfair chain", () => {
    const unfairShort = chain(["ChIJ_short", "ChIJ_b"], 100, UNFAIR_TRIPS);
    const fairLong = chain(["ChIJ_long", "ChIJ_z"], 900, FAIR_TRIPS);
    expect(fairnessWarning(UNFAIR_TRIPS)).toBe(true);
    expect(fairnessWarning(FAIR_TRIPS)).toBe(false);
    expect(unfairShort.betweenPlaceDurationSum).toBeLessThan(
      fairLong.betweenPlaceDurationSum,
    );

    const ranked = rankChains([unfairShort, fairLong]);
    expect(ranked).toEqual({
      placeIds: fairLong.placeIds,
      betweenPlaceDurationSum: 900,
      memberTripSeconds: FAIR_TRIPS,
      fairnessWarning: false,
    });
  });

  it("among fair chains picks the smallest between-place sum, then the lexicographically smallest place-id sequence", () => {
    const fairExpensive = chain(["ChIJ_a", "ChIJ_b"], 400, FAIR_TRIPS);
    const fairCheapLexLater = chain(["ChIJ_m", "ChIJ_n"], 200, FAIR_TRIPS);
    const fairCheapLexFirst = chain(["ChIJ_a", "ChIJ_c"], 200, FAIR_TRIPS);

    const bySum = rankChains([fairExpensive, fairCheapLexLater]);
    expect(bySum?.placeIds).toEqual(["ChIJ_m", "ChIJ_n"]);
    expect(bySum?.betweenPlaceDurationSum).toBe(200);
    expect(bySum?.fairnessWarning).toBe(false);

    const byPlaceId = rankChains([
      fairCheapLexLater,
      fairCheapLexFirst,
      fairExpensive,
    ]);
    expect(byPlaceId?.placeIds).toEqual(["ChIJ_a", "ChIJ_c"]);
    expect(byPlaceId?.betweenPlaceDurationSum).toBe(200);
    expect(byPlaceId?.fairnessWarning).toBe(false);
  });

  it("T-001-95/AC-3 T-001-22/AC-5 if every chain is unfair, picks the smallest (max trip minus median), then place-id, and sets the fairness warning", () => {
    const worseSpread = chain(["ChIJ_a", "ChIJ_a2"], 10, [600, 720, 3000]);
    const betterSpreadLexLater = chain(["ChIJ_b", "ChIJ_x"], 50, UNFAIR_TRIPS);
    const betterSpreadLexFirst = chain(["ChIJ_a", "ChIJ_x"], 50, UNFAIR_TRIPS);

    expect(fairnessWarning(UNFAIR_TRIPS)).toBe(true);
    expect(fairnessWarning(worseSpread.memberTripSeconds)).toBe(true);
    expect(maxTripMinusMedian(UNFAIR_TRIPS)).toBe(2400 - 720);
    expect(maxTripMinusMedian(worseSpread.memberTripSeconds)).toBe(3000 - 720);
    expect(maxTripMinusMedian(UNFAIR_TRIPS)).toBeLessThan(
      maxTripMinusMedian(worseSpread.memberTripSeconds),
    );

    const bySpread = rankChains([worseSpread, betterSpreadLexLater]);
    expect(bySpread?.placeIds).toEqual(["ChIJ_b", "ChIJ_x"]);
    expect(bySpread?.fairnessWarning).toBe(true);
    expect(maxTripMinusMedian(bySpread?.memberTripSeconds ?? [])).toBe(
      2400 - 720,
    );

    const byPlaceId = rankChains([
      worseSpread,
      betterSpreadLexLater,
      betterSpreadLexFirst,
    ]);
    expect(byPlaceId).toEqual({
      placeIds: ["ChIJ_a", "ChIJ_x"],
      betweenPlaceDurationSum: 50,
      memberTripSeconds: UNFAIR_TRIPS,
      fairnessWarning: true,
    });
  });

  it("T-001-95/AC-3 T-001-22/AC-4 a fair chain ranks ahead of a shorter unfair chain; among fair chains the smallest between-place sum wins, then the lexicographically smallest place-id sequence", () => {
    const unfairShortest = chain(["ChIJ_0", "ChIJ_0"], 50, UNFAIR_TRIPS);
    const fairLongLexFirst = chain(["ChIJ_a", "ChIJ_b"], 400, FAIR_TRIPS);
    const fairShortLexLater = chain(["ChIJ_m", "ChIJ_n"], 200, FAIR_TRIPS);
    const fairShortLexFirst = chain(["ChIJ_c", "ChIJ_z"], 200, FAIR_TRIPS);

    // Fair beats a shorter unfair chain.
    expect(rankChains([unfairShortest, fairLongLexFirst])).toEqual({
      placeIds: ["ChIJ_a", "ChIJ_b"],
      betweenPlaceDurationSum: 400,
      memberTripSeconds: FAIR_TRIPS,
      fairnessWarning: false,
    });
    // Among fair chains, the smaller sum beats a lexicographically smaller id sequence.
    expect(rankChains([fairLongLexFirst, fairShortLexLater, unfairShortest])).toEqual({
      placeIds: ["ChIJ_m", "ChIJ_n"],
      betweenPlaceDurationSum: 200,
      memberTripSeconds: FAIR_TRIPS,
      fairnessWarning: false,
    });
    // Equal sums fall to the place-id sequence, in either input order.
    for (const input of [
      [fairShortLexLater, fairShortLexFirst, fairLongLexFirst, unfairShortest],
      [unfairShortest, fairLongLexFirst, fairShortLexFirst, fairShortLexLater],
    ]) {
      expect(rankChains(input)).toEqual({
        placeIds: ["ChIJ_c", "ChIJ_z"],
        betweenPlaceDurationSum: 200,
        memberTripSeconds: FAIR_TRIPS,
        fairnessWarning: false,
      });
    }
  });

  it("T-001-95/AC-3 T-001-22/AC-6 scoring runs with no database and no network, and uses integer rules where a floating comparison would differ", () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("scoring must not call the network");
    });
    vi.stubGlobal("fetch", fetchSpy);
    dbCalls.count = 0;

    // Even median: (601 + 720 + 1) // 2 = 661, where a float mean would give 660.5.
    expect(medianTripSeconds([601, 720])).toBe(661);
    expect(Number.isInteger(medianTripSeconds([601, 720]))).toBe(true);

    // Median 2401: unfair needs T > 3601 and 2T > 7203, so 3602 warns and 3601 does not.
    expect(fairnessWarning([2401, 2401, 3602])).toBe(true);
    expect(fairnessWarning([2401, 2401, 3601])).toBe(false);

    const spreadWinner = chain(["ChIJ_b"], 10, [2401, 2401, 3602]);
    const spreadLoser = chain(["ChIJ_a"], 10, [600, 720, 3000]);
    const ranked = rankChains([spreadLoser, spreadWinner]);
    expect(ranked?.placeIds).toEqual(["ChIJ_b"]);
    expect(ranked?.fairnessWarning).toBe(true);
    expect(maxTripMinusMedian(ranked?.memberTripSeconds ?? [])).toBe(1201);
    expect(Number.isInteger(maxTripMinusMedian(ranked?.memberTripSeconds ?? []))).toBe(true);

    const member: MemberAvailability = { kind: "free", earliestMinutes: 18 * 60, latestMinutes: 18 * 60 + 30 };
    const chosen = chooseTime(
      [{ localDate: "2026-10-02", startMinutes: 18 * 60, endMinutes: 19 * 60 }],
      [[member]],
    );
    expect(chosen).toMatchObject({ timeBlocked: false, minutes: 18 * 60, coverage: 1 });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(dbCalls.count).toBe(0);
  });
});
