/** Member i is unfair when T_i > M + 1200 and 2 * T_i > 3 * M. */
export const UNFAIR_EXTRA_SECONDS = 1200;

export function medianTripSeconds(trips: readonly number[]): number {
  const n = trips.length;
  if (n === 0) {
    return 0;
  }
  const sorted = trips.slice().sort((a, b) => a - b);
  if (n % 2 === 1) {
    return sorted[(n - 1) / 2] ?? 0;
  }
  const left = sorted[n / 2 - 1] ?? 0;
  const right = sorted[n / 2] ?? 0;
  return Math.floor((left + right + 1) / 2);
}

export function isUnfair(tripSeconds: number, medianSeconds: number): boolean {
  return (
    tripSeconds > medianSeconds + UNFAIR_EXTRA_SECONDS &&
    2 * tripSeconds > 3 * medianSeconds
  );
}

export function isChainFair(trips: readonly number[]): boolean {
  const median = medianTripSeconds(trips);
  for (const trip of trips) {
    if (isUnfair(trip, median)) {
      return false;
    }
  }
  return true;
}

export function fairnessWarning(trips: readonly number[]): boolean {
  return !isChainFair(trips);
}

export function maxTripSeconds(trips: readonly number[]): number {
  let max = 0;
  for (const trip of trips) {
    if (trip > max) {
      max = trip;
    }
  }
  return max;
}

export function maxTripMinusMedian(trips: readonly number[]): number {
  return maxTripSeconds(trips) - medianTripSeconds(trips);
}
