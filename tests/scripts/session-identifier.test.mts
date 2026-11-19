// Every server accepts a session identifier of 22 to 256 characters of `A-Za-z0-9,-` (H35.85, HY-104.42), the range of
// `session.sid_length` of PHP and of SE-5.1 of the session-store library. The Node and Python stores give the cookie to
// the session-store library, which checks its form (SE-5.1); the PHP server checks it itself, so the test reads its
// pattern.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const SOURCES = ['packages/php/src/Session/NativeSession.php'];
const PATTERN = /\[A-Za-z0-9,-\]\{(\d+),(\d+)\}/g;

for (const source of SOURCES) {
  test(`HY-104.42: ${source} accepts 22 to 256 characters`, () => {
    const ranges = [...readFileSync(source, 'utf8').matchAll(PATTERN)].map((match) => `${match[1]},${match[2]}`);
    assert.notEqual(ranges.length, 0, `${source}: expected the identifier pattern, found none`);
    assert.deepEqual(ranges, ranges.map(() => '22,256'), `${source}: the identifier ranges are ${ranges.join(' ')}`);
  });
}
