// No test waits by polling (H35.19-2, HR-89): a wait ends by the event that makes its state, raced with the end of the
// processes that make it, and never repeats a check with a pause. The checks read the tracked test files: the module
// tests/scripts/until.mts, which repeated a check every 100 ms, is gone, and no loop of a test file pauses with `delay`
// of node:timers/promises or with `setTimeout`.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const SOURCE = /\.(?:ts|mts|cts|js|mjs|cjs)$/;
const LOOP = /\b(?:for|while)\s*\(/;
const PAUSE = /\bdelay\(|\bsetTimeout\(/;

// The tracked source files below tests/.
function testFiles(): string[] {
  return execFileSync('git', ['ls-files', 'tests'], { encoding: 'utf8' }).split('\n').filter((file) => SOURCE.test(file));
}

// The lines of `text` that pause inside the body of a loop, as `line: text`, read by the braces of the blocks that open
// on each line; a loop whose body is on its own line counts too.
function pausesInLoops(text: string): string[] {
  const found: string[] = [];
  const blocks: boolean[] = [];
  for (const [index, line] of text.split('\n').entries()) {
    const code = line.replace(/\/\/.*$/, '');
    const loop = LOOP.test(code);
    if (PAUSE.test(code) && (loop || blocks.includes(true))) found.push(`${String(index + 1)}: ${line.trim()}`);
    for (const character of code) {
      if (character === '{') blocks.push(loop);
      else if (character === '}') blocks.pop();
    }
  }
  return found;
}

const REPEAT = /^\s*(?:for\s*\(\s*;\s*;\s*\)|while\s*\()/;
const REQUEST = /\b(?:fetch|post)\(/;

// The loops of `text` that send a request again until its answer changes, with or without a pause: a `for (;;)` or a
// `while` whose header or body sends a request and reads its `status`, as `line: text` of the head of the loop.
function repeatedRequests(text: string): string[] {
  const found: string[] = [];
  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    if (!REPEAT.test(line)) continue;
    let depth = 0;
    let body = '';
    for (const next of lines.slice(index)) {
      body += `${next}\n`;
      for (const character of next.replace(/\/\/.*$/, '')) {
        if (character === '{') depth += 1;
        else if (character === '}') depth -= 1;
      }
      if (depth <= 0 && body.includes('{')) break;
      if (depth <= 0 && !next.trimEnd().endsWith('{')) break;
    }
    if (REQUEST.test(body) && /\.status\b|\bstatus\b/.test(body)) found.push(`${String(index + 1)}: ${line.trim()}`);
  }
  return found;
}

test('tests/scripts/until.mts, which repeated a check with a pause, is removed (H35.19-2)', () => {
  assert.equal(existsSync('tests/scripts/until.mts'), false, 'tests/scripts/until.mts still exists');
});

test('no loop of a test file pauses with delay or setTimeout (H35.19-2, HR-89)', () => {
  const files = testFiles();
  assert.ok(files.length > 0, 'git ls-files tests lists no source file');
  const found = files.flatMap((file) => pausesInLoops(readFileSync(file, 'utf8')).map((line) => `${file}:${line}`));
  assert.deepEqual(found, [], `loops that pause:\n${found.join('\n')}`);
});

test('no loop of a test file sends a request again until its status changes (H35.19-2, HR-89)', () => {
  const found = testFiles().flatMap((file) => repeatedRequests(readFileSync(file, 'utf8')).map((line) => `${file}:${line}`));
  assert.deepEqual(found, [], `loops that send a request again:\n${found.join('\n')}`);
});
