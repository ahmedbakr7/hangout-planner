/**
 * Teardown for e2e files that fail a test when a request went unserved: copy the unserved list,
 * run every step even when one threw, then throw the first step error, otherwise an error naming
 * the unserved requests, otherwise return.
 */
export function teardownThenAssertServed(unserved: readonly string[], ...steps: Array<() => void>): void {
  const pending = [...unserved];
  let failure: { error: unknown } | null = null;
  for (const step of steps) {
    try {
      step();
    } catch (error) {
      if (failure === null) failure = { error };
    }
  }
  if (failure !== null) throw failure.error;
  if (pending.length > 0) throw new Error(`Unserved requests:\n${pending.join("\n")}`);
}
