import {
  fairnessWarning,
  isChainFair,
  maxTripMinusMedian,
} from "./fairness";

export type ChainInput = {
  placeIds: readonly string[];
  betweenPlaceDurationSum: number;
  memberTripSeconds: readonly number[];
};

export type RankedChain = {
  placeIds: readonly string[];
  betweenPlaceDurationSum: number;
  memberTripSeconds: readonly number[];
  fairnessWarning: boolean;
};

function comparePlaceIds(
  left: readonly string[],
  right: readonly string[],
): number {
  const n = Math.min(left.length, right.length);
  for (let i = 0; i < n; i++) {
    const a = left[i];
    const b = right[i];
    if (a === undefined || b === undefined || a === b) {
      continue;
    }
    if (a < b) {
      return -1;
    }
    return 1;
  }
  return left.length - right.length;
}

function isBetter(
  candidate: ChainInput,
  incumbent: ChainInput,
  allUnfair: boolean,
): boolean {
  if (allUnfair) {
    const candidateSpread = maxTripMinusMedian(candidate.memberTripSeconds);
    const incumbentSpread = maxTripMinusMedian(incumbent.memberTripSeconds);
    if (candidateSpread !== incumbentSpread) {
      return candidateSpread < incumbentSpread;
    }
  } else {
    if (
      candidate.betweenPlaceDurationSum !== incumbent.betweenPlaceDurationSum
    ) {
      return candidate.betweenPlaceDurationSum < incumbent.betweenPlaceDurationSum;
    }
  }
  return comparePlaceIds(candidate.placeIds, incumbent.placeIds) < 0;
}

/**
 * Prefer a fair chain. Among fair chains, smallest between-place sum, then
 * lexicographically smallest place-id sequence. If every chain is unfair,
 * smallest (max trip minus median), then the same place-id tie-break.
 */
export function rankChains(chains: readonly ChainInput[]): RankedChain | null {
  if (chains.length === 0) {
    return null;
  }

  const fair = chains.filter((chain) => isChainFair(chain.memberTripSeconds));
  const pool = fair.length > 0 ? fair : chains;
  const allUnfair = fair.length === 0;

  let best = pool[0];
  if (best === undefined) {
    return null;
  }
  for (let i = 1; i < pool.length; i++) {
    const candidate = pool[i];
    if (candidate !== undefined && isBetter(candidate, best, allUnfair)) {
      best = candidate;
    }
  }

  return {
    placeIds: best.placeIds,
    betweenPlaceDurationSum: best.betweenPlaceDurationSum,
    memberTripSeconds: best.memberTripSeconds,
    fairnessWarning: fairnessWarning(best.memberTripSeconds),
  };
}
