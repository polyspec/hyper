// The waits of the session tests (HR-89): a test orders events by events, so no file of them decides a result by the
// callback of a timer.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { ROOT } from './session-workers.mts';

const DIRECTORY = path.join(ROOT, 'tests/scripts');

test('no session test decides a result by the callback of a timer (HR-89)', () => {
  const files = readdirSync(DIRECTORY).filter((file) => /^session-.*\.mts$/.test(file) && file !== 'session-waits.test.mts');
  assert.notDeepEqual(files, [], 'the session tests are read');
  const found = files.flatMap((file) => readFileSync(path.join(DIRECTORY, file), 'utf8').split('\n').flatMap((line, index) => (/\bsetTimeout\s*\(/.test(line) ? [`tests/scripts/${file}:${String(index + 1)}: ${line.trim()}`] : [])));
  assert.deepEqual(found, [], 'a timer callback orders the events of a test; the test awaits the event that decides its result');
});
