/**
 * Teardown for e2e files that seed rows and hold database clients: run the cleanup, then close
 * every client even when the cleanup threw. Rejects with the cleanup error, otherwise with the
 * first closer error, otherwise resolves.
 */
export async function cleanupThenClose(
  cleanup: () => Promise<void>,
  ...closers: Array<() => Promise<unknown>>
): Promise<void> {
  let failure: { error: unknown } | null = null;
  try {
    await cleanup();
  } catch (error) {
    failure = { error };
  }
  const settled = await Promise.allSettled(
    closers.map(async (close) => {
      await close();
    }),
  );
  if (failure === null) {
    const rejected = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (rejected) failure = { error: rejected.reason };
  }
  if (failure !== null) throw failure.error;
}
