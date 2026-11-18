// The wait `until` of the session tests ends with the end of the process that it waits on (H35.19-2, HR-89): a holder
// that exits before the check holds fails the wait at once, instead of the time limit of the test runner. The order is
// set by events: the holder exits after the first check, and no timer of the test decides the result.
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { test } from 'node:test';
import { until } from './until.mts';

test('a wait whose holder exits before the check holds fails with the exit (H35.19-2)', async () => {
  const holder = new EventEmitter();
  const exit = once(holder, 'exit');
  let checks = 0;
  let checkedAgain: () => void = () => undefined;
  const again = new Promise<string>((resolve) => (checkedAgain = () => resolve('the wait checked again after the exit')));
  const check = async (): Promise<boolean> => {
    checks++;
    if (checks === 1) queueMicrotask(() => holder.emit('exit', 1, null));
    else checkedAgain();
    return false;
  };
  const waited = until(check, exit).then(
    () => 'the wait held',
    (error: unknown) => String(error),
  );
  assert.match(await Promise.race([waited, again]), /the process ended before the check held: \[1,null\]/);
});

test('a wait whose check holds ends without the process ending (H35.19-2)', async () => {
  const holder = new EventEmitter();
  let checks = 0;
  await until(async () => ++checks === 1, once(holder, 'exit'));
  assert.equal(checks, 1);
});
