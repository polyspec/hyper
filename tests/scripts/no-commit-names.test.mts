// Tests that no tracked document names a Git commit, of this repository or of another (AGENTS.md, Implementation): a
// row, a changelog entry or a plan points to a change by its row id or by a description, because a commit hash says
// nothing to a reader and does not survive a rewrite of the history. The documents are the tracked files that the
// `include` globs of config/documents.json select.
//
// A commit name is a word of 7 to 40 lower-case hexadecimal characters that holds at least one digit and at least one
// of the letters a to f, with no letter, digit, `_` or `-` on either side. The rules that exclude a word that is no
// commit name:
// - A word of digits only is a number or the id of a CI run, and a word of letters only is an English word, so the
//   word needs a digit and a letter.
// - A digest that its line labels is no commit: the word follows one of the labels sha1, sha256, sha512, shasum,
//   digest, integrity or inputs, or the Korean word for inputs in a Korean twin, within 24 characters before it, or it
//   is followed by `...`, the abbreviation of a digest.
// - A generated document holds what its generator writes: docs/spec/protocol.md and docs/spec/protocol.ko.md, which
//   `make spec-docs` writes from contracts/protocol.json, are not read.
// - The Verification cell of a checklist row whose state is `[o]` keeps its text, because a done row is a finished
//   record (AGENTS.md, P26): a word in the fourth cell of a row `| ID | Task | Deliverables | Verification | State |`
//   whose State cell starts with `[o]` is not read. Every other cell of that row, and every cell of another row, is.
// The workflows of .github pin each action by its commit (HR-90), and they are no document of config/documents.json.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { trackedDocuments } from './documents.mts';

const GENERATED = new Set(['docs/spec/protocol.md', 'docs/spec/protocol.ko.md']);
const WORD = /(?<![0-9A-Za-z_-])[0-9a-f]{7,40}(?![0-9A-Za-z_-])/g;
const LABEL = /(?:sha1|sha256|sha512|shasum|digest|integrity|inputs|입력)(?![A-Za-z])/i;

// The tracked documents that the include globs of config/documents.json select, without the generated ones.
function documents(): string[] {
  const { tracked, selected } = trackedDocuments();
  return tracked.filter((file) => !GENERATED.has(file) && selected(file));
}

// The range of the Verification cell of a done checklist row, or null for another line. The cells are split at each
// `|` that no backslash escapes.
function doneVerification(line: string): [number, number] | null {
  if (!/^\| H\d/.test(line)) return null;
  const bars = [...line.matchAll(/(?<!\\)\|/g)].map((bar) => bar.index);
  const [, , , verification, state, end] = bars;
  if (bars.length !== 6 || verification === undefined || state === undefined || end === undefined) return null;
  return line.slice(state + 1, end).trim().startsWith('[o]') ? [verification + 1, state] : null;
}

// Each commit name of a text, as `file:line: word`.
function commitNames(file: string, text: string): string[] {
  const names: string[] = [];
  text.split('\n').forEach((line, index) => {
    const kept = doneVerification(line);
    for (const match of line.matchAll(WORD)) {
      const word = match[0];
      const at = match.index;
      if (kept !== null && at > kept[0] && at < kept[1]) continue;
      if (!/[0-9]/.test(word) || !/[a-f]/.test(word)) continue;
      if (LABEL.test(line.slice(Math.max(0, at - 24), at))) continue;
      if (line.startsWith('...', at + word.length)) continue;
      names.push(`${file}:${String(index + 1)}: ${word}`);
    }
  });
  return names;
}

test('the rules tell a commit name from a number, a word and a labelled digest', () => {
  assert.deepEqual(commitNames('a.md', 'fixed by 4ed11336, see /rustc/88d9e12a.'), ['a.md:1: 4ed11336', 'a.md:1: 88d9e12a']);
  assert.deepEqual(commitNames('a.md', 'CI run 44130032438 and the number 9007199254740992'), []);
  assert.deepEqual(commitNames('a.md', 'the sha1 `02f0244bd3fd663b68576d0c740284306b3f8320` and sha256 dbdeb77e...2e7b'), []);
  assert.deepEqual(commitNames('a.md', 'the word deadbeef and the id H35-4ed1133'), []);
  assert.deepEqual(commitNames('a.ko.md', '그 build의 입력 `5b20342ee479`와 함께'), []);
  assert.deepEqual(commitNames('c.md', '| H1.1 | fixed by 4ed11336 | a.md | passed on 8e396163 | [o] |'), ['c.md:1: 4ed11336']);
  assert.deepEqual(commitNames('c.md', '| H1.2 | task | a.md | passed on 8e396163 | [v] |'), ['c.md:1: 8e396163']);
});

test('no tracked document names a Git commit', () => {
  const files = documents();
  assert.ok(files.length > 0, 'config/documents.json selects no tracked document');
  const names = files.flatMap((file) => commitNames(file, readFileSync(file, 'utf8')));
  assert.deepEqual(names, [], `${String(names.length)} commit names in ${String(files.length)} documents; name the row id or describe the change`);
});
