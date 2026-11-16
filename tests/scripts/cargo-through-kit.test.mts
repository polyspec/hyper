// Tests that every cargo command of the Makefile runs through `cargo <dir> <args>` of the link script of kit (H35.14-1),
// which patches the polyspec crates to the providers of .links of a development checkout and runs cargo as given
// without them, so that no recipe needs a .cargo file.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dryRun } from './make-dry-run.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LOCAL = ['BINDING_COMMIT=local', 'BINDING=/lane/cli.js'];
// A command that starts cargo itself: at the start of a line, or after cd, a list operator or a pipe.
const BARE = /(?:^|&&|\|\||;|\|)\s*cargo\s/u;

test('no recipe line of the Makefile starts cargo itself (H35.14-1)', () => {
  const recipes = readFileSync(path.join(ROOT, 'Makefile'), 'utf8').split('\n').filter((line) => line.startsWith('\t'));
  const bare = recipes.filter((line) => BARE.test(line));
  assert.deepEqual(bare, [], `Makefile: every cargo command is $(CARGO); these lines start cargo:\n${bare.join('\n')}`);
});

test('the cargo commands of the core and the bindings run through the link script of kit (H35.14-1)', () => {
  const lines = ['core-test', 'core-lint', 'core-fmt-check', 'test-bindings'].flatMap((target) => dryRun(target, { variables: LOCAL }));
  const cargo = lines.filter((line) => /\bcargo\s/u.test(line));
  assert.ok(cargo.length >= 8, `make -n names the cargo commands of the core and the bindings:\n${lines.join('\n')}`);
  const bare = cargo.filter((line) => BARE.test(line) || !/link\.m[jt]s cargo \S+ /u.test(line));
  assert.deepEqual(bare, [], `make -n: these cargo commands do not run through link cargo of kit:\n${bare.join('\n')}`);
});
