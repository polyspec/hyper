// Tests that each CI group installs the tools that its job starts (HR-91). Both sides are read from dry runs of the
// Makefile: what a group installs is what the command lines of its setup steps (CI_SETUP_<group>) install, in their
// order, and what it starts is what the command lines of its setup steps and its targets (CI_TARGETS_<group>) name,
// the recipes of the prerequisites included. A target that gains a prerequisite which starts a new tool, such as the
// build of the native addon with Cargo before `make board`, fails here for every group that reaches it, with the
// group, the target and the tool.
//
// INSTALLS and STARTED are the whole detection. INSTALLS reads the tools that a command line of a setup step installs:
// the selectors that install-tools of kit gets, which are CI_TOOLS_<group>, and the tool of a mise install of one tool.
// STARTED is a pattern of a command line and the tools without which the matched program does not start. A program that
// is not in STARTED is not judged: Node.js and npm, which the bootstrap of the job installs, the programs of the runner
// (cp, test, a C compiler, the libclang of hyper-ext), and what a setup step of the group installs for itself (Chromium,
// Redis, the packages of Composer and uv).
//
// The job release of release.yml is judged in the same way (HR-95): its make calls are those of the bootstrap action
// and the makes that its recipe ci-release-release starts, and a tool counts as installed for the command lines after
// the line that installs it. A cargo command line that names a Rust target needs the standard library of that target,
// which install-tools installs only for the targets of rust-toolchain.toml. What a utility of kit starts inside its
// process (npm pack, git archive, gh) is in no dry run and is not judged here.
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dryRun } from './make-dry-run.mts';
import { requireBuilt } from './requires.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAKEFILE = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');

// The tools that a command line of a setup step installs.
const INSTALLS: readonly { name: string; tools: (line: string) => string[] }[] = [
  // install-tools of kit installs the selectors that follow its option.
  { name: 'install-tools of kit', tools: (line) => (/\/install-tools\.m[jt]s --no-self-update (.+)$/u.exec(line)?.[1] ?? '').split(' ').filter(Boolean) },
  // install-wasm-bindgen of packages/release.mk installs the wasm-bindgen CLI alone with the mise of the checkout.
  { name: 'mise install of wasm-bindgen', tools: (line) => (line.endsWith('/var/tools/bin/mise install --locked github:wasm-bindgen/wasm-bindgen') ? ['wasm-bindgen'] : []) },
];

// A command line pattern and the tools without which the matched program does not start.
const STARTED: readonly { program: string; pattern: RegExp; tools: readonly string[] }[] = [
  // The link script of kit starts the cargo of the pinned Rust toolchain.
  { program: 'cargo', pattern: /\/link\.m[jt]s cargo /u, tools: ['rust'] },
  // maturin builds the native module of the Python package with Cargo.
  { program: 'maturin', pattern: /\/link\.m[jt]s maturin |\/mise\/shims\/maturin\b/u, tools: ['maturin', 'rust'] },
  // var/tools/bin/php is the wrapper that install-tools writes for the php of the job; a recipe also starts php by its name.
  { program: 'php', pattern: /\/var\/tools\/bin\/php\b|(?:^|&& |\|\| |; |\(command -v )php(?:-config)?\b/u, tools: ['php'] },
  { program: 'composer', pattern: /\/mise\/shims\/composer\b/u, tools: ['composer'] },
  { program: 'pie', pattern: /\/mise\/shims\/pie\b/u, tools: ['pie'] },
  { program: 'go', pattern: /\/mise\/shims\/go(?:fmt)?\b/u, tools: ['go'] },
  { program: 'wasm-bindgen', pattern: /\/mise\/shims\/wasm-bindgen\b/u, tools: ['wasm-bindgen'] },
  { program: 'uv', pattern: /\/mise\/shims\/uv\b|\/uv-install\.m[jt]s /u, tools: ['uv'] },
  // The virtual environment of a Python package is made by the python of mise, and the Python test runner starts it.
  { program: 'python', pattern: /\/mise\/shims\/python3?\b|\/python-venv\.m[jt]s |\/run-tests\.m[jt]s python /u, tools: ['python'] },
  { program: 'alint', pattern: /\/mise\/shims\/alint\b/u, tools: ['alint'] },
  // The lint scripts of kit start the lint programs of the checkout.
  { program: 'phpcs and phpstan', pattern: /\/lint-php\.m[jt]s\b/u, tools: ['php', 'phpcs', 'phpstan'] },
  { program: 'ruff and vulture', pattern: /\/lint-python\.m[jt]s\b/u, tools: ['ruff', 'vulture'] },
];

// The line of php-check-installed, which install-tools runs: it starts the PHP wrapper only in a checkout that holds
// one, which an install that selects no PHP tool does not write, so the line starts no tool that the group lacks.
const WHERE_INSTALLED = /^test ! -e \S+\/var\/tools\/bin\/php \|\| /u;

/** The words of the simple variable `name` of the Makefile, with each $(<variable>) replaced by the words of that variable. */
function makeWords(name: string): string[] {
  const value = new RegExp(`^${name} := (.*)$`, 'm').exec(MAKEFILE)?.[1];
  if (value === undefined) throw new Error(`the Makefile declares no ${name}`);
  return value.split(' ').filter(Boolean).flatMap((word) => {
    const variable = /^\$\((\w+)\)$/.exec(word)?.[1];
    return variable === undefined ? [word] : makeWords(variable);
  });
}

const printed = new Map<string, string[]>();

/** The command lines of `make -n <target> <variables>`, each dry run made once. */
function commands(target: string, variables: string[] = []): string[] {
  const key = [target, ...variables].join('\n');
  const known = printed.get(key);
  if (known) return known;
  const lines = dryRun(target, { variables });
  assert.ok(lines.length > 0, `make -n ${target} prints no command`);
  printed.set(key, lines);
  return lines;
}

/** The variables that the call of the job gives the setup step `step` of the group `group` (ci_step_args of the Makefile). */
function setupVariables(group: string, step: string): string[] {
  if (step === 'install-tools') return [`TOOLS=${makeWords(`CI_TOOLS_${group}`).join(' ')}`];
  if (step !== 'install-symbols') return [];
  return [`EXTRACTORS=${new RegExp(`^CI_SYMBOLS_${group} := `, 'm').test(MAKEFILE) ? makeWords(`CI_SYMBOLS_${group}`).join(' ') : ''}`];
}

interface Call { target: string; variables: string[] }

/**
 * The make calls of a job whose one run step is `make <recipe> <variables>` (HR-90), in their order: the run steps of
 * the bootstrap action, then the makes that the recipe starts, each with the variables of its line; a variable whose
 * value the shell computes is left out. A dry run prints a line that starts a make through CI_MAKE and does not run it.
 */
function jobCalls(recipe: string, variables: string[] = []): Call[] {
  const action = readFileSync(path.join(ROOT, '.github/actions/bootstrap/action.yml'), 'utf8');
  const bootstrap = [...action.matchAll(/^\s+run: make (\S+)((?: \S+=\S+)*)$/gmu)].map((call) => ({ target: call[1] ?? '', variables: (call[2] ?? '').split(' ').filter(Boolean) }));
  assert.ok(bootstrap.length > 0, 'the bootstrap action runs no make target');
  const started = commands(recipe, variables).flatMap((line) => {
    const call = / --no-print-directory ([a-z][\w-]*)((?: [A-Z_]+=(?:"[^"$]*"|[^\s"$]*))*)/u.exec(line);
    if (!call) return [];
    return [{ target: call[1] ?? '', variables: [...(call[2] ?? '').matchAll(/([A-Z_]+)=(?:"([^"]*)"|(\S*))/gu)].map((variable) => `${variable[1]}=${variable[2] ?? variable[3] ?? ''}`) }];
  });
  assert.ok(started.length > 0, `make -n ${recipe} starts no make`);
  return [...bootstrap, ...started];
}

/** The make calls of the job release of release.yml (HR-95). */
const releaseCalls = (): Call[] => jobCalls('ci-release-release', ['TAG=v0.0.0', 'VERSION=0.0.0']);

// A command line that installs every tool of the checkout: install-tools of kit without a selector, and release-tools of
// kit, which runs it for a configuration that holds a Composer package or a wheel.
const INSTALLS_ALL = /\/install-tools\.m[jt]s --no-self-update\s*$|\/release-tools\.m[jt]s\s*$/u;

// The Rust target that a cargo command line builds for, when it names one by its triple.
const CARGO_TARGET = /\/link\.m[jt]s cargo .* --target ([a-z0-9_]+(?:-[a-z0-9_]+)+)/u;

test('each CI group installs every tool that its setup steps and its targets start (HR-91, H35.16-6)', () => {
  const groups = [...makeWords('CI_GROUPS'), 'bench'];
  const found: string[] = [];
  const matched = new Set<string>();
  const installing = new Set<string>();
  let judged = 0;
  let conditional = 0;
  for (const group of groups) {
    const installed = new Set<string>();
    /** Adds a finding for each tool that the lines of `target` start and the steps so far did not install. */
    const judge = (target: string, lines: string[]): void => {
      judged += 1;
      conditional += lines.filter((line) => WHERE_INSTALLED.test(line)).length;
      const started = lines.filter((line) => !WHERE_INSTALLED.test(line));
      for (const entry of STARTED) {
        const line = started.find((text) => entry.pattern.test(text));
        if (line === undefined) continue;
        matched.add(entry.program);
        for (const tool of entry.tools) {
          if (!installed.has(tool)) found.push(`${group}: make ${target} starts ${entry.program}, and no setup step of the group before it installs ${tool} (CI_TOOLS_${group}, CI_SETUP_${group}): ${line.trim().slice(0, 200)}`);
        }
      }
    };
    // The setup steps run in their order with the variables that the call of the job gives them (ci_step_args), and a
    // step may start what it installs itself: install-tools checks the PHP wrapper that it wrote.
    for (const step of makeWords(`CI_SETUP_${group}`)) {
      const lines = commands(step, setupVariables(group, step));
      for (const install of INSTALLS) {
        for (const tool of lines.flatMap(install.tools)) {
          installed.add(tool);
          installing.add(install.name);
        }
      }
      judge(step, lines);
    }
    assert.deepEqual([...installed].filter((tool) => tool !== 'wasm-bindgen').sort(), makeWords(`CI_TOOLS_${group}`).sort(), `the setup of the group ${group} installs CI_TOOLS_${group} with install-tools`);
    for (const target of makeWords(`CI_TARGETS_${group}`)) judge(target, commands(target));
  }
  assert.ok(judged > groups.length, `${judged} targets were judged`);
  // A row that no command line matches judges nothing (HR-84).
  assert.deepEqual(STARTED.map((entry) => entry.program).filter((program) => !matched.has(program)), [], 'a row of STARTED matches no command line of any CI group');
  assert.ok(conditional > 0, 'no setup step prints the check of the PHP wrapper with its condition');
  assert.deepEqual(found, []);
  assert.deepEqual(INSTALLS.map((install) => install.name).filter((name) => !installing.has(name)), [], 'a row of INSTALLS matches no command line of any setup step');
});

test('the job of release.yml installs every tool that its steps start, before the command line that starts it (HR-95, H35.35)', () => {
  const kinds = (JSON.parse(readFileSync(path.join(ROOT, 'config/release.json'), 'utf8')) as { packages: { kind: string }[] }).packages.map((item) => item.kind);
  assert.ok(kinds.includes('composer') || kinds.includes('wheel'), 'config/release.json holds no Composer package and no wheel, so release-tools of kit installs no tool');
  const every = new Set(STARTED.flatMap((entry) => entry.tools));
  const installed = new Set<string>();
  const matched = new Set<string>();
  const found: string[] = [];
  let installs = 0;
  // The command lines run in their order, those of the makes that a recipe starts included, so a tool counts as
  // installed only for the lines after the line that installs it.
  for (const call of releaseCalls()) {
    for (const line of commands(call.target, call.variables)) {
      if (WHERE_INSTALLED.test(line)) continue;
      for (const entry of STARTED) {
        if (!entry.pattern.test(line)) continue;
        matched.add(entry.program);
        for (const tool of entry.tools) {
          if (!installed.has(tool)) found.push(`release: make ${call.target} starts ${entry.program}, and no command line of the job before it installs ${tool}: ${line.trim().slice(0, 200)}`);
        }
      }
      if (!INSTALLS_ALL.test(line)) continue;
      installs += 1;
      for (const tool of every) installed.add(tool);
    }
  }
  // release-go-module generates the Go binding with cargo; a dry run that does not name it judged nothing (HR-84).
  assert.deepEqual(['cargo'].filter((program) => !matched.has(program)), [], 'no command line of the release starts a program that its steps build with');
  assert.ok(installs >= 1, `${installs} command lines of the release install the tools: release-tools`);
  assert.deepEqual(found, []);
});

test('rust-toolchain.toml names every Rust target that a cargo command line of a CI group or of the release builds for (HR-81, H35.35)', () => {
  // install-tools of kit passes the targets of rust-toolchain.toml to rustup with the toolchain, and no other step adds one.
  const list = /^targets = \[(.*)\]$/mu.exec(readFileSync(path.join(ROOT, 'rust-toolchain.toml'), 'utf8'))?.[1] ?? '';
  const declared = [...list.matchAll(/"([^"]+)"/gu)].map((target) => target[1] ?? '');
  const named = new Map<string, string>();
  const read = (where: string, lines: string[]): void => {
    for (const line of lines) {
      const target = CARGO_TARGET.exec(line)?.[1];
      if (target !== undefined && !named.has(target)) named.set(target, where);
    }
  };
  for (const group of [...makeWords('CI_GROUPS'), 'bench']) {
    for (const step of makeWords(`CI_SETUP_${group}`)) read(`${group}: make ${step}`, commands(step, setupVariables(group, step)));
    for (const target of makeWords(`CI_TARGETS_${group}`)) read(`${group}: make ${target}`, commands(target));
  }
  for (const call of releaseCalls()) read(`release: make ${call.target}`, commands(call.target, call.variables));
  assert.ok(named.size > 0, 'no cargo command line of a CI group or of the release names a Rust target');
  assert.deepEqual([...named].filter(([target]) => !declared.includes(target)).map(([target, where]) => `${where} builds for the Rust target ${target}, which rust-toolchain.toml does not name in targets, so install-tools installs no standard library of it`), []);
});

test('install-wasm-bindgen of a tree without packages/release.mk writes the file first and installs the wasm-bindgen CLI with the mise of the checkout (H35.16-6)', (t) => {
  requireBuilt('install-packages', 'node_modules/@polyspec/binding/dist/cli.js');
  requireBuilt('install-tools', 'var/tools/bin/node');
  const tree = mkdtempSync(path.join(tmpdir(), 'hyper-install-wasm-bindgen-'));
  t.after(() => rmSync(tree, { recursive: true, force: true }));
  for (const file of ['Makefile', 'config/toolchain.json', 'packages/rust/interface.json', 'packages/ts/package.json', 'packages/go/go.mod']) {
    mkdirSync(path.dirname(path.join(tree, file)), { recursive: true });
    copyFileSync(path.join(ROOT, file), path.join(tree, file));
  }
  const variables = [`NODE=${path.join(ROOT, 'var/tools/bin/node')}`, `BINDING=${path.join(ROOT, 'node_modules/@polyspec/binding/dist/cli.js')}`];
  const lines = dryRun('install-wasm-bindgen', { cwd: tree, variables });
  assert.ok(existsSync(path.join(tree, 'packages/release.mk')), `make wrote packages/release.mk before it read install-wasm-bindgen:\n${lines.join('\n')}`);
  // The line downloads, so it lifts the offline settings of the Makefile ($(ONLINE)), and names the mise of the tree.
  assert.deepEqual(lines.filter((line) => line.includes('mise install')), [`env -u npm_config_offline -u COMPOSER_DISABLE_NETWORK ${path.join(tree, 'var/tools/bin/mise')} install --locked github:wasm-bindgen/wasm-bindgen`]);
});

test('the group core is the one CI group that starts wasm-bindgen, and its setup writes the release recipes and installs it after install-tools (H35.16-6)', () => {
  const starting = makeWords('CI_GROUPS').filter((group) => makeWords(`CI_TARGETS_${group}`).some((target) => commands(target).some((line) => /\/mise\/shims\/wasm-bindgen\b/u.test(line))));
  assert.deepEqual(starting, ['core']);
  assert.deepEqual(makeWords('CI_SETUP_core'), ['install-tools', 'release-recipes', 'install-wasm-bindgen']);
});
