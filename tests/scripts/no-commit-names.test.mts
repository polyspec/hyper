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
//   digest, integrity or inputs within 24 characters before it, or it is followed by `...`, the abbreviation of a
//   digest.
// - A generated document holds what its generator writes: docs/spec/protocol.md and docs/spec/protocol.ko.md, which
//   `make spec-docs` writes from contracts/protocol.json, are not read.
// The workflows of .github pin each action by its commit (HR-90), and they are no document of config/documents.json.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { matchesGlob } from 'node:path';
import { test } from 'node:test';

const GENERATED = new Set(['docs/spec/protocol.md', 'docs/spec/protocol.ko.md']);
const WORD = /(?<![0-9A-Za-z_-])[0-9a-f]{7,40}(?![0-9A-Za-z_-])/g;
const LABEL = /(?:sha1|sha256|sha512|shasum|digest|integrity|inputs)\b/i;

// The tracked documents that the include globs of config/documents.json select, without the generated ones.
function documents(): string[] {
  const config: unknown = JSON.parse(readFileSync('config/documents.json', 'utf8'));
  if (typeof config !== 'object' || config === null || !('include' in config) || !Array.isArray(config.include)) {
    throw new Error('config/documents.json has no list include');
  }
  const globs = config.include.filter((glob: unknown): glob is string => typeof glob === 'string');
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  return tracked.filter((file) => !GENERATED.has(file) && globs.some((glob) => matchesGlob(file, glob)));
}

// Each commit name of a text, as `file:line: word`.
function commitNames(file: string, text: string): string[] {
  const names: string[] = [];
  text.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(WORD)) {
      const word = match[0];
      const at = match.index;
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
});

test('no tracked document names a Git commit', () => {
  const files = documents();
  assert.ok(files.length > 0, 'config/documents.json selects no tracked document');
  const names = files.flatMap((file) => commitNames(file, readFileSync(file, 'utf8')));
  assert.deepEqual(names, [], `${String(names.length)} commit names in ${String(files.length)} documents; name the row id or describe the change`);
});
