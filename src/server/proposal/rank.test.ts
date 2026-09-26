import { describe, expect, it } from "vitest";
import { fairnessWarning, maxTripMinusMedian } from "./fairness";
import { rankChains, type ChainInput } from "./rank";

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

  it("if every chain is unfair, picks the smallest (max trip minus median), then place-id, and sets the fairness warning", () => {
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
});
