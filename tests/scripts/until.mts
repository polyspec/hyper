// The wait of the session tests for a state of a server that no event announces (HR-89), in a module of its own so that
// tests/scripts/until.test.mts checks it without a server.
import { setTimeout as delay } from 'node:timers/promises';

// Repeats a check until it holds. The timeout of a test fails the test and leaves a check that never holds repeating, so
// the wait between two checks does not keep the process: while a test waits, the servers of the file keep it, and after
// the file stopped them a check that is left ends with the process (HR-87). `ended` is the end of the process that the
// check waits on, such as `once(holder, 'exit')`: when it settles first, the wait fails at once with its value and checks
// no more, so a holder that ended fails the step instead of the time limit of the test runner (H35.19-2).
export async function until(check: () => Promise<boolean>, ended?: Promise<unknown>): Promise<void> {
  let end: { value: unknown } | undefined;
  const stop = new Promise<void>((resolve) => {
    if (ended === undefined) return;
    const record = (value: unknown): void => {
      end = { value };
      resolve();
    };
    ended.then(record, record);
  });
  const failed = (): Error => new Error(`the process ended before the check held: ${JSON.stringify(end?.value)}`);
  for (;;) {
    if (end !== undefined) throw failed();
    if (await check().catch(() => false)) return;
    if (end !== undefined) throw failed();
    await Promise.race([delay(100, undefined, { ref: false }), stop]);
  }
}
