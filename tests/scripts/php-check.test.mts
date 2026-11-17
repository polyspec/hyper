// Tests the PHP of the checkout (HR-81, H35.16-4, H35.16-5): var/tools/bin/php is a wrapper of the php that was first on
// PATH when make install-tools wrote it, and a later install keeps it, so `make php-check` compares its minor release
// with .php-version before a recipe starts PHP, and each recipe that compiles the crate of the PHP extension gives Cargo
// a target directory that the API of the PHP behind the wrapper names, so the extension of another PHP is built in
// another directory. Each test runs the Makefile in a directory of its own with a php and a php-config that it writes
// (HR-85).
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

/**
 * A PHP that the wrapper of a test stands for: its minor release, the version number of its headers and its build, the
 * debug build and the thread safety as the recipes ask for them (`-nts`, `-zts`, `-debug-nts`, `-debug-zts`).
 */
type Php = { minor: string; headers: string; build: string };
const RELEASE: Php = { minor: PINNED, headers: '80427', build: '-nts' };

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
  if (php !== undefined) wrappers(directory, php);
  return directory;
}

/**
 * Writes var/tools/bin/php and php-config of `directory` for `php`, in place of the wrappers that it holds: the paths
 * stay and the PHP behind them changes, as when the wrapper of a checkout is written again for another PHP. The php
 * loads only a library whose content is the API of that PHP, which the cargo of extensionTree writes.
 */
function wrappers(directory: string, php: Php): void {
  script(path.join(directory, 'var/tools/bin/php'), [
    'case "$*" in',
    `  *PHP_MINOR_VERSION*) printf '%s' '${php.minor}' ;;`,
    `  *PHP_ZTS*) printf '%s' '${php.build}' ;;`,
    `  *PHP_BINARY*) printf '%s' '${php.minor}.99 at /machine/bin/php' ;;`,
    `  *extension_loaded*) for word; do case "$word" in extension=*) test "$(cat "\${word#extension=}")" = '${php.headers}${php.build}' || exit 1 ;; esac; done ;;`,
    '  *) echo "the php of the test does not answer: $*" >&2; exit 64 ;;',
    'esac',
  ]);
  script(path.join(directory, 'var/tools/bin/php-config'), [`test "$1" = --vernum && printf '%s' '${php.headers}'`]);
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
  const result = make(tree(t, RELEASE), 'php-check');
  assert.equal(result.status, 0, result.stderr);
});

test('php-check fails for a wrapper of another minor release and names both releases and the install (H35.16-4)', (t) => {
  const directory = tree(t, { ...RELEASE, minor: OTHER });
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

test('php-check-installed, the check of install-tools, passes without the wrapper and fails for a wrapper of another minor release (H35.16-7)', (t) => {
  const absent = make(tree(t, undefined), 'php-check-installed');
  assert.equal(absent.status, 0, absent.stderr);
  const pinned = make(tree(t, RELEASE), 'php-check-installed');
  assert.equal(pinned.status, 0, pinned.stderr);
  const other = make(tree(t, { ...RELEASE, minor: OTHER }), 'php-check-installed');
  assert.notEqual(other.status, 0, other.stdout);
  assert.ok(other.stderr.includes(`runs PHP ${OTHER} (${OTHER}.99 at /machine/bin/php), and .php-version names PHP ${PINNED}.`), other.stderr);
});

test('a target that starts PHP fails at php-check before its recipe runs (H35.16-4)', (t) => {
  const result = make(tree(t, { ...RELEASE, minor: OTHER }), 'hyper-lint');
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
const STARTS_PHP = /(?:^|[\s;&|(])php(?:-config)? |\$\((?:PIE|COMPOSER_BIN|PHP_SERVER_ARGUMENTS|PHPUNIT_EXTENSIONS|PHP_SERVER_EXTENSIONS|PHP_EXT_CARGO|php_api_target)\)|\/(?:pint|phpstan|phpcs) |\/(?:lint-php|install-symbols)\.\$\(KIT_EXT\)|polyspec-hyper-php-ext|--php-autoload /u;
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
  // make install-tools writes the wrapper, so it runs the check after the install; php-check-installed holds the
  // condition that the wrapper exists.
  assert.ok((all.get('install-tools') ?? []).includes('\t@$(MAKE) --no-print-directory php-check-installed'), 'install-tools runs php-check-installed');
  assert.deepEqual(all.get('php-check-installed'), ['\t@test ! -e $(CHECKOUT_PHP) || { $(php_check); }']);
});

/** A start of the cargo of a test: its subcommand and arguments, its target directory and the PHP and PHP_CONFIG that it got. */
type CargoStart = { args: string; target: string; php: string; config: string };

/**
 * A tree for the recipes that compile the crate of the PHP extension, without a PHP: `wrappers` writes one. CARGO is a
 * program of the test that records each start in cargo.log with the target directory that Cargo would take (the option
 * --target-dir, else CARGO_TARGET_DIR, else target of the directory) and, for a build of the extension, writes a
 * library whose content is the API of the PHP of PATH, as the build script of the crate writes the API of that PHP
 * into the library. NODE is the node of the test, which runs the copy of scripts/publish.mts, and LLVM_ROOT a folder
 * with the files that the recipe of hyper-ext requires. Returns the directory, the variables and the starts of a make.
 */
function extensionTree(t: TestContext): { directory: string; run: (...words: string[]) => CargoStart[] } {
  const directory = tree(t, undefined);
  script(path.join(directory, 'llvm/bin/clang'), ['exit 0']);
  mkdirSync(path.join(directory, 'llvm/lib'));
  writeFileSync(path.join(directory, 'llvm/lib/libclang.so'), '');
  for (const file of ['scripts/publish.mts', 'packages/cli/lib/publish.mjs']) {
    mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    copyFileSync(path.join(ROOT, file), path.join(directory, file));
  }
  const log = path.join(directory, 'cargo.log');
  script(path.join(directory, 'cargo'), [
    'target="${CARGO_TARGET_DIR:-$PWD/target}"',
    'previous=',
    'for word; do',
    '  case "$previous" in --target-dir) target="$word" ;; esac',
    '  case "$word" in --target-dir=*) target="${word#--target-dir=}" ;; esac',
    '  previous="$word"',
    'done',
    `printf 'target=%s php=%s config=%s args=%s\\n' "$target" "$PHP" "$PHP_CONFIG" "$*" >> '${log}'`,
    'case "$*" in build*polyspec-hyper-php-ext*)',
    '  mkdir -p "$target/debug"',
    `  for extension in so dylib; do printf '%s%s' "$(php-config --vernum)" "$(php -n -r 'echo PHP_ZTS;')" > "$target/debug/libpolyspec_hyper.$extension"; done ;;`,
    'esac',
  ]);
  const variables = [`CARGO=${path.join(directory, 'cargo')}`, `NODE=${process.execPath}`, 'LLVM_MAJOR=1', `LLVM_ROOT=${path.join(directory, 'llvm')}`];
  const run = (...words: string[]): CargoStart[] => {
    rmSync(log, { force: true });
    // -o keeps make from the recipes of the prerequisites, which write the sources of the bindings and run their tests.
    const result = make(directory, '-o', 'bindings', '-o', 'test-wasm', '-o', 'test-go', ...words, ...variables);
    assert.equal(result.status, 0, `make ${words.join(' ')}:\n${result.stdout}\n${result.stderr}`);
    const starts = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => /^target=(\S*) php=(\S*) config=(\S*) args=(.*)$/u.exec(line));
    return starts.map((start) => ({ target: start?.[1] ?? '', php: start?.[2] ?? '', config: start?.[3] ?? '', args: start?.[4] ?? '' }));
  };
  return { directory, run };
}

test('hyper-ext builds the extension of each API of PHP in a target directory of its own and publishes the library of the PHP of the checkout (H35.16-5)', (t) => {
  const { directory, run } = extensionTree(t);
  const published = () => readFileSync(path.join(directory, 'build/hyper-ext/polyspec_hyper.so'), 'utf8');
  /** The target directory of the build of the extension for `php`, the PHP that the wrappers of the tree then run. */
  const built = (php: Php): string => {
    wrappers(directory, php);
    const starts = run('hyper-ext');
    assert.equal(starts.length, 1, 'the recipe of hyper-ext starts cargo once');
    const start = starts[0];
    assert.ok(start !== undefined, 'the recipe of hyper-ext starts cargo');
    assert.equal(start.args, 'build --locked -p polyspec-hyper-php-ext');
    // The paths that the build script of ext-php-rs reads are those of the wrappers, which do not change with the PHP.
    assert.equal(start.php, path.join(directory, 'var/tools/bin/php'));
    assert.equal(start.config, path.join(directory, 'var/tools/bin/php-config'));
    assert.equal(published(), `${php.headers}${php.build}`, 'build/hyper-ext holds the library of the PHP of the checkout');
    return start.target;
  };
  const first = built(RELEASE);
  // The wrappers keep their paths, so nothing but the directory tells Cargo that the PHP behind them is another one.
  const headers = built({ ...RELEASE, headers: '80510' });
  assert.notEqual(headers, first, 'a PHP with other headers builds in the directory of the PHP before it, whose library Cargo keeps');
  const threads = built({ ...RELEASE, build: '-zts' });
  const debug = built({ ...RELEASE, build: '-debug-nts' });
  assert.deepEqual([first, headers, threads, debug], ['php-80427-nts', 'php-80510-nts', 'php-80427-zts', 'php-80427-debug-nts'].map((name) => path.join(directory, 'target', name)));
  // The library of an API stays in its directory when another PHP builds, and the PHP of that API loads it again.
  for (const [target, api] of [[first, '80427-nts'], [headers, '80510-nts'], [threads, '80427-zts'], [debug, '80427-debug-nts']] as const) {
    assert.equal(readFileSync(path.join(target, 'debug/libpolyspec_hyper.so'), 'utf8'), api);
  }
  assert.equal(built(RELEASE), first);
});

test('hyper-ext does not publish a library that the PHP of the checkout does not load (H35.16-5)', (t) => {
  const { directory, run } = extensionTree(t);
  wrappers(directory, RELEASE);
  run('hyper-ext');
  // A library of another API in the directory of this API, which only a build outside the recipe leaves there.
  writeFileSync(path.join(directory, 'cargo'), '#!/bin/sh\nexit 0\n');
  for (const extension of ['so', 'dylib']) writeFileSync(path.join(directory, `target/php-80427-nts/debug/libpolyspec_hyper.${extension}`), '80510-nts');
  const result = make(directory, '-o', 'bindings', 'hyper-ext', `CARGO=${path.join(directory, 'cargo')}`, `NODE=${process.execPath}`, 'LLVM_MAJOR=1', `LLVM_ROOT=${path.join(directory, 'llvm')}`);
  assert.notEqual(result.status, 0, result.stdout);
  assert.equal(readFileSync(path.join(directory, 'build/hyper-ext/polyspec_hyper.so'), 'utf8'), '80427-nts', 'build/hyper-ext keeps the library that loaded');
});

test('lint-bindings and test-bindings compile the crate of the PHP extension in the target directory of the API of PHP (H35.16-5)', (t) => {
  const { directory, run } = extensionTree(t);
  wrappers(directory, RELEASE);
  const starts = run('test-bindings');
  const extension = starts.filter((start) => start.args.includes('polyspec-hyper-php-ext'));
  assert.deepEqual(extension.map((start) => start.args.split(' ')[0]), ['clippy', 'test'], starts.map((start) => start.args).join('\n'));
  assert.deepEqual(extension.map((start) => start.target), [path.join(directory, 'target/php-80427-nts'), path.join(directory, 'target/php-80427-nts')]);
  // The other crates read no header of PHP and keep the target directory of the workspace.
  const others = starts.filter((start) => !start.args.includes('polyspec-hyper-php-ext'));
  assert.ok(others.length >= 3, starts.map((start) => start.args).join('\n'));
  assert.deepEqual([...new Set(others.map((start) => start.target))], [path.join(directory, 'target')]);
});
