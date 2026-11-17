// Tests that every cargo command of the Makefile runs through `cargo <dir> <args>` of the link script of kit (H35.14-1),
// which patches the polyspec crates to the providers of .links of a development checkout and runs cargo as given
// without them, so that no recipe needs a .cargo file.
//
// A line names cargo in two forms. A cargo command starts cargo with its arguments. The option `--cargo "<command>"`
// of the binding generator (H35.14-2) starts no cargo: its value is the command that the generator starts cargo with.
// The rule holds for both: a cargo command runs through the link script, and the value of the option is the link
// script command, `$(CARGO)` in the Makefile. A line that names cargo in any other form is read as a cargo command.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dryRun } from './make-dry-run.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// A command that starts cargo itself: at the start of a line, or after cd, a list operator or a pipe.
const BARE = /(?:^|&&|\|\||;|\|)\s*cargo\s/u;
// The option of the binding generator that names the cargo command, with its value in double quotes.
const OPTION = /\s--cargo\s+"([^"]*)"/gu;
// The link script command as make expands `$(CARGO)`: node, the link script of kit, `cargo` and the directory.
const LINK_COMMAND = /^\S+ \S*link\.m[jt]s cargo \S+$/u;

// The values of the option `--cargo "<command>"` of a line, and the line without these options.
function cargoOptions(line: string): { values: string[]; rest: string } {
  return { values: [...line.matchAll(OPTION)].map((match) => match[1] ?? ''), rest: line.replace(OPTION, ' ') };
}

// Whether a line of a dry run names cargo, as a command or as the value of the option.
function namesCargo(line: string): boolean {
  const { values, rest } = cargoOptions(line);
  return values.length > 0 || /\bcargo\s/u.test(rest);
}

// Whether a line of a dry run that names cargo runs it other than through the link script of kit.
function refused(line: string): boolean {
  const { values, rest } = cargoOptions(line);
  if (values.some((value) => !LINK_COMMAND.test(value))) return true;
  return /\bcargo\s/u.test(rest) && (BARE.test(rest) || !/link\.m[jt]s cargo \S+ /u.test(rest));
}

// Whether a recipe line of the Makefile starts cargo itself, or gives the binding generator another command than $(CARGO).
function refusedRecipe(line: string): boolean {
  const { values, rest } = cargoOptions(line);
  return values.some((value) => value !== '$(CARGO)') || BARE.test(rest);
}

test('no recipe line of the Makefile starts cargo itself (H35.14-1)', () => {
  const recipes = readFileSync(path.join(ROOT, 'Makefile'), 'utf8').split('\n').filter((line) => line.startsWith('\t'));
  const bare = recipes.filter(refusedRecipe);
  assert.deepEqual(bare, [], `Makefile: every cargo command is $(CARGO); these lines start cargo:\n${bare.join('\n')}`);
});

test('the cargo commands of the core and the bindings run through the link script of kit (H35.14-1)', () => {
  const lines = ['core-test', 'core-lint', 'core-fmt-check', 'test-bindings'].flatMap((target) => dryRun(target));
  const cargo = lines.filter(namesCargo);
  assert.ok(cargo.length >= 8, `make -n names the cargo commands of the core and the bindings:\n${lines.join('\n')}`);
  const bare = cargo.filter(refused);
  assert.deepEqual(bare, [], `make -n: these cargo commands do not run through link cargo of kit:\n${bare.join('\n')}`);
});

const LINK = '/r/var/tools/bin/node /r/node_modules/@polyspec/kit/dist/link.mjs cargo /r';
const GENERATE = '/r/var/tools/bin/node /r/node_modules/@polyspec/binding/dist/cli.js generate --root /r';

test('a cargo command through the link script and the option of the binding generator with it pass (H35.14-1, H35.14-2)', () => {
  for (const line of [`${LINK} test -p polyspec-hyper`, `cd packages/rust && ${LINK} fmt --check`, `${GENERATE} --cargo "${LINK}"`]) {
    assert.equal(namesCargo(line), true, line);
    assert.equal(refused(line), false, line);
  }
  assert.equal(refusedRecipe('\t$(NODE) $(BINDING) generate --root $(CURDIR) --cargo "$(CARGO)"'), false);
  assert.equal(refusedRecipe('\t$(CARGO) fmt --check -p polyspec-hyper'), false);
});

test('a line that starts cargo itself, or gives the binding generator another cargo command, is refused (H35.14-1)', () => {
  const lines = [
    'cargo test -p polyspec-hyper',
    'cd packages/rust && cargo build',
    '/usr/local/bin/cargo build ',
    // The value of the option is cargo itself, or a command in front of cargo that is not the link script.
    `${GENERATE} --cargo "cargo"`,
    `${GENERATE} --cargo "env RUSTFLAGS=-g cargo"`,
    // The option is given the link script, and a cargo command of the same line starts cargo itself.
    `${GENERATE} --cargo "${LINK}" && cargo fmt --check`,
    // The value is not in double quotes, so the line is read as a cargo command.
    `${GENERATE} --cargo cargo --verbose`,
    `${GENERATE} --cargo 'cargo' --verbose`,
  ];
  for (const line of lines) {
    assert.equal(namesCargo(line), true, line);
    assert.equal(refused(line), true, line);
  }
  for (const line of ['\tcargo test', '\tcd packages/rust && cargo build', '\t$(NODE) $(BINDING) generate --root $(CURDIR) --cargo "cargo"', '\t$(NODE) $(BINDING) check --cargo "$(CARGO)" && cargo fmt']) {
    assert.equal(refusedRecipe(line), true, line);
  }
});
