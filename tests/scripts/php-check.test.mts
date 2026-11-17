// Tests the PHP of the checkout (HR-81, H35.16-4, H35.16-5): var/tools/bin/php is a wrapper of the php that was first on
// PATH when make install-tools wrote it, and a later install keeps it, so `make php-check` compares its minor release
// with .php-version before a recipe starts PHP, and `make hyper-ext` gives the build the PHP behind the wrapper as an
// input, so Cargo builds the extension again for another PHP. Each test runs the Makefile in a directory of its own
// with a php and a php-config that it writes (HR-85).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAKEFILE = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
const PINNED = readFileSync(path.join(ROOT, '.php-version'), 'utf8').trim();
const CALLER = ['MAKEFLAGS', 'MFLAGS', 'MAKELEVEL', 'MAKEOVERRIDES'];

/** A PHP that the wrapper of a test stands for: its minor release, its PHP_VERSION_ID and the version number of its headers. */
type Php = { minor: string; id: string; headers: string };

/** Writes the executable `file` with the lines of a sh script. */
function script(file: string, lines: string[]): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, ['#!/bin/sh', ...lines, ''].join('\n'));
  chmodSync(file, 0o755);
}

/**
 * A directory with the Makefile and the .php-version of the checkout and, for `php`, a var/tools/bin/php that answers
 * the questions of the recipes as that PHP would, with its php-config. The test removes the directory when it ends.
 */
function tree(t: TestContext, php: Php | undefined): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-php-check-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const file of ['Makefile', '.php-version']) copyFileSync(path.join(ROOT, file), path.join(directory, file));
  if (php === undefined) return directory;
  script(path.join(directory, 'var/tools/bin/php'), [
    'case "$*" in',
    `  *PHP_MINOR_VERSION*) printf '%s' '${php.minor}' ;;`,
    `  *PHP_VERSION_ID*) printf '%s' '${php.id}_nts' ;;`,
    `  *PHP_BINARY*) printf '%s' '${php.minor}.99 at /machine/bin/php' ;;`,
    '  *) echo "the php of the test does not answer: $*" >&2; exit 64 ;;',
    'esac',
  ]);
  script(path.join(directory, 'var/tools/bin/php-config'), [`test "$1" = --vernum && printf '%s' '${php.headers}'`]);
  return directory;
}

/** Runs `make <words>` in `directory` without the variables of a calling make. */
function make(directory: string, ...words: string[]): { status: number | null; stdout: string; stderr: string } {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !CALLER.includes(name)));
  const result = spawnSync('make', ['--no-print-directory', ...words], { cwd: directory, encoding: 'utf8', env });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** A minor release other than the pinned one. */
const OTHER = `${PINNED.split('.')[0] ?? ''}.${Number(PINNED.split('.')[1]) + 1}`;

test('php-check passes for a wrapper that runs the minor release of .php-version (H35.16-4)', (t) => {
  assert.match(PINNED, /^\d+\.\d+$/u, '.php-version holds one minor release');
  const result = make(tree(t, { minor: PINNED, id: '1', headers: '1' }), 'php-check');
  assert.equal(result.status, 0, result.stderr);
});

test('php-check fails for a wrapper of another minor release and names both releases and the install (H35.16-4)', (t) => {
  const directory = tree(t, { minor: OTHER, id: '1', headers: '1' });
  const result = make(directory, 'php-check');
  assert.notEqual(result.status, 0, result.stdout);
  const wrapper = path.join(directory, 'var/tools/bin/php');
  assert.ok(result.stderr.includes(`php-check: ${wrapper} runs PHP ${OTHER} (${OTHER}.99 at /machine/bin/php), and .php-version names PHP ${PINNED}.`), result.stderr);
  assert.ok(result.stderr.includes(`put the php of PHP ${PINNED} first on PATH (Homebrew: php@${PINNED}), remove ${wrapper} and run make install-tools`), result.stderr);
});

test('php-check fails for a checkout without the wrapper and names make install-tools (H35.16-4)', (t) => {
  const result = make(tree(t, undefined), 'php-check');
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /php-check: \S+\/var\/tools\/bin\/php, the PHP of the checkout, does not exist; .* run make install-tools/u, result.stderr);
});

test('a target that starts PHP fails at php-check before its recipe runs (H35.16-4)', (t) => {
  const result = make(tree(t, { minor: OTHER, id: '1', headers: '1' }), 'hyper-lint');
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /php-check: \S+ runs PHP /u, result.stderr);
  assert.ok(!result.stdout.includes('pint'), `the recipe of hyper-lint did not run:\n${result.stdout}`);
});

/** The targets of the Makefile with the lines of their recipes. */
function recipes(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  let targets: string[] = [];
  for (const line of MAKEFILE.split('\n')) {
    const rule = /^([a-z][a-z0-9-]*(?: [a-z][a-z0-9-]*)*):(?!=)/u.exec(line);
    if (rule !== null) targets = (rule[1] ?? '').split(' ');
    else if (line.startsWith('\t')) for (const target of targets) found.set(target, [...(found.get(target) ?? []), line]);
    else if (line.trim() !== '' && !/^(?:ifeq|ifneq|else|endif)\b/u.test(line)) targets = [];
  }
  return found;
}

// The words by which a recipe starts PHP: the php of PATH, Composer, PIE, PHPUnit, PHPStan, phpcs and Pint, a script
// that starts a PHP server with the extensions, the lint and the symbol extractor of kit, and Cargo for the crate of
// the PHP extension, whose build script runs php and php-config.
const STARTS_PHP = /(?:^|[\s;&|(])php(?:-config)? |\$\((?:PIE|COMPOSER_BIN|PHP_SERVER_ARGUMENTS|PHPUNIT_EXTENSIONS|PHP_SERVER_EXTENSIONS|BINDING_CRATES)\)|\/(?:pint|phpstan|phpcs) |\/(?:lint-php|install-symbols)\.\$\(KIT_EXT\)|polyspec-hyper-php-ext|--php-autoload /u;
// php-check is the check itself, and release-php-check judges the php of PATH before the release installs the wrapper.
const NOT_CHECKED = ['php-check', 'release-php-check'];

test('every target whose recipe starts PHP has php-check as a prerequisite (H35.16-4)', () => {
  const declared = (/^PHP_TARGETS := (.*)$/mu.exec(MAKEFILE)?.[1] ?? '').split(' ').filter(Boolean);
  assert.ok(declared.length > 0, 'the Makefile declares PHP_TARGETS');
  assert.match(MAKEFILE, /^\$\(PHP_TARGETS\): php-check$/mu);
  const all = recipes();
  assert.deepEqual(declared.filter((target) => !all.has(target)), [], 'each target of PHP_TARGETS has a recipe');
  const starting = [...all].filter(([target, lines]) => !NOT_CHECKED.includes(target) && lines.some((line) => STARTS_PHP.test(line))).map(([target]) => target);
  assert.ok(starting.includes('hyper-test-php') && starting.includes('template-ext') && starting.includes('bench-server'), `the recipes that start PHP are found: ${starting.join(' ')}`);
  assert.deepEqual(starting.filter((target) => !declared.includes(target)), []);
  // make install-tools writes the wrapper, so it runs the check after the install, when the wrapper exists.
  assert.ok((all.get('install-tools') ?? []).some((line) => line.endsWith('test ! -e $(CHECKOUT_PHP) || $(MAKE) --no-print-directory php-check')), 'install-tools runs php-check');
});

/**
 * The value of EXT_PHP_RS_ALLOWED_BINDINGS that the recipe of hyper-ext gives Cargo for `php`. CARGO is a program of
 * the test that prints the variable and fails, so the recipe stops after its build line; -o bindings keeps make from
 * writing the sources of the bindings, and LLVM_ROOT names a folder of the test with the files that the recipe requires.
 */
function buildInput(t: TestContext, php: Php): string {
  const directory = tree(t, php);
  script(path.join(directory, 'llvm/bin/clang'), ['exit 0']);
  mkdirSync(path.join(directory, 'llvm/lib'));
  writeFileSync(path.join(directory, 'llvm/lib/libclang.so'), '');
  script(path.join(directory, 'cargo'), [`printf 'input=%s php=%s config=%s\\n' "$EXT_PHP_RS_ALLOWED_BINDINGS" "$PHP" "$PHP_CONFIG"`, 'exit 7']);
  const result = make(directory, '-o', 'bindings', 'hyper-ext', `CARGO=${path.join(directory, 'cargo')}`, 'LLVM_MAJOR=1', `LLVM_ROOT=${path.join(directory, 'llvm')}`);
  assert.notEqual(result.status, 0, 'the cargo of the test stops the recipe');
  const printed = /^input=(\S*) php=(\S*) config=(\S*)$/mu.exec(result.stdout);
  assert.ok(printed !== null, `the recipe of hyper-ext started cargo:\n${result.stdout}\n${result.stderr}`);
  // The paths that the build script of ext-php-rs reads are those of the wrappers, which do not change with the PHP.
  assert.equal(printed[2], path.join(directory, 'var/tools/bin/php'));
  assert.equal(printed[3], path.join(directory, 'var/tools/bin/php-config'));
  return printed[1] ?? '';
}

test('hyper-ext gives the build of the extension the PHP behind the wrapper in a variable that its build script watches (H35.16-5)', (t) => {
  const first = buildInput(t, { minor: PINNED, id: '80427', headers: '80427' });
  assert.equal(first, 'polyspec_build_input_php_80427_nts_headers_80427');
  // bindgen reads each name of the variable as a pattern of its allow list: the value is one name, with no comma.
  assert.match(first, /^\w+$/u);
  assert.notEqual(buildInput(t, { minor: PINNED, id: '80428', headers: '80427' }), first, 'another release of the runtime is another input');
  assert.notEqual(buildInput(t, { minor: PINNED, id: '80427', headers: '80510' }), first, 'other headers are another input');
});
