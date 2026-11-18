// The wait of the session tests for a state of a server that no event announces (HR-89), in a module of its own so that
// tests/scripts/until.test.mts checks it without a server.
import { setTimeout as delay } from 'node:timers/promises';

// Repeats a check until it holds. The timeout of a test fails the test and leaves a check that never holds repeating, so
// the wait between two checks does not keep the process: while a test waits, the servers of the file keep it, and after
// the file stopped them a check that is left ends with the process (HR-87).
export async function until(check: () => Promise<boolean>): Promise<void> {
  for (;;) {
    if (await check().catch(() => false)) return;
    await delay(100, undefined, { ref: false });
  }
}
