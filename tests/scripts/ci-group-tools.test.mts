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
// The crates of Cargo.lock are an install of the same kind (HR-89, H35.39): `make hyper-install-crates` is the one
// target that downloads them, with `cargo fetch --locked`, and every other command line starts cargo offline. CRATES
// are the programs that read the fetched crates: cargo itself, maturin, and the binding generator, whose generate and
// check run `cargo metadata --locked --offline`. A group that starts one of them before a setup step fetched the
// crates fails here, and so does a cargo command line without --offline, which would download in a check.
// The job release of release.yml is judged in the same way (HR-95): its make calls are those of the bootstrap action
// and the makes that its recipe ci-release-release starts, and a tool counts as installed for the command lines after
// the line that installs it. A cargo command line that names a Rust target needs the standard library of that target,
// which install-tools installs only for the targets of rust-toolchain.toml. What a utility of kit starts inside its
// process (npm pack, git archive, gh) is in no dry run and is not judged here.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dryRun } from './make-dry-run.mts';
import { treeWithoutReleaseRecipes } from './release-recipes-tree.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAKEFILE = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');

// The tools that a command line of a setup step installs.
const INSTALLS: readonly { name: string; tools: (line: string) => string[] }[] = [
  // install-tools of kit installs the selectors that follow its option.
  { name: 'install-tools of kit', tools: (line) => (/\/install-tools\.m[jt]s --no-self-update (.+)$/u.exec(line)?.[1] ?? '').split(' ').filter(Boolean) },
  // install-wasm-bindgen of packages/release.mk installs the wasm-bindgen CLI alone with the mise of the checkout.
  { name: 'mise install of wasm-bindgen', tools: (line) => (line.endsWith('/var/tools/bin/mise install --locked github:wasm-bindgen/wasm-bindgen') ? ['wasm-bindgen'] : []) },];

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
  // binding check, with and without --release, computes the go.sum of packages/go/go.mod with `go mod download`, and
  // binding release-go-module proves the module with go; both start the go of PATH inside their process.
  { program: 'go of binding', pattern: /\/binding\/dist\/cli\.js (?:check|release-go-module) /u, tools: ['go'] },
  { program: 'wasm-bindgen', pattern: /\/mise\/shims\/wasm-bindgen\b/u, tools: ['wasm-bindgen'] },
  { program: 'uv', pattern: /\/mise\/shims\/uv\b|\/uv-install\.m[jt]s /u, tools: ['uv'] },
  // The virtual environment of a Python package is made by the python of mise, and the Python test runner starts it.
  { program: 'python', pattern: /\/mise\/shims\/python3?\b|\/python-venv\.m[jt]s |\/run-tests\.m[jt]s python /u, tools: ['python'] },
  { program: 'alint', pattern: /\/mise\/shims\/alint\b/u, tools: ['alint'] },
  // The lint scripts of kit start the lint programs of the checkout.
  { program: 'phpcs and phpstan', pattern: /\/lint-php\.m[jt]s\b/u, tools: ['php', 'phpcs', 'phpstan'] },
  { program: 'ruff and vulture', pattern: /\/lint-python\.m[jt]s\b/u, tools: ['ruff', 'vulture'] },
];

// The command line of hyper-install-crates, which downloads the crates of Cargo.lock.
const FETCH = /\/link\.m[jt]s cargo \S+ fetch --locked$/u;
// A cargo command line with its subcommand; the value of the option --cargo of the binding generator ends the line or
// its quotes, so it is no such line.
const CARGO_COMMAND = /\/link\.m[jt]s cargo \S+ ([a-z]+) /u;
// The programs that read the crates which hyper-install-crates fetched.
const CRATES: readonly { program: string; pattern: RegExp }[] = [
  { program: 'cargo', pattern: CARGO_COMMAND },
  { program: 'maturin', pattern: /\/link\.m[jt]s maturin /u },
  { program: 'the binding generator', pattern: /\/@polyspec\/binding\/dist\/cli\.js (?:generate|check) /u },
];
// The cargo subcommands that read no crate of the lock from the network, so they carry no --offline.
const NO_CRATES = ['fmt'];
// A command line of an install target or of a target that writes a lock lifts the offline settings with $(ONLINE):
// it downloads by its purpose (HR-89), as cargo update of cargo-lock does, so the rule of the fetched crates and of
// --offline does not read it.
const ONLINE = /^env -u npm_config_offline -u COMPOSER_DISABLE_NETWORK /u;
// The programs that only a recipe of the release starts, which no CI group matches: the wheel build of release-wheel of
// binding (GN-19c), whose maturin compiles the crate with cargo for the interpreter python3, and the napi CLI, which
// builds the Node addon with cargo.
const RELEASE_STARTED: typeof STARTED = [
  { program: 'wheel build', pattern: /\/mise\/shims\/maturin build --release /u, tools: ['maturin', 'python', 'rust'] },
  { program: 'napi', pattern: /\/node_modules\/\.bin\/napi build /u, tools: ['rust'] },
];
// The installs that only a recipe of the release makes: release-wheel of binding installs maturin alone with the mise of
// the checkout before it starts it (GN-19c).
const RELEASE_INSTALLS: typeof INSTALLS = [
  { name: 'mise install of maturin', tools: (line) => (line.endsWith('/var/tools/bin/mise install --locked github:PyO3/maturin') ? ['maturin'] : []) },
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
  const reading = new Set<string>();
  const fetching = new Set<string>();
  let judged = 0;
  let conditional = 0;
  for (const group of groups) {
    const installed = new Set<string>();
    let fetched = false;
    /** Adds a finding for each tool that the lines of `target` start and the steps so far did not install. */
    const judge = (target: string, lines: string[]): void => {
      judged += 1;
      for (const line of lines.filter((text) => !ONLINE.test(text))) {
        const subcommand = CARGO_COMMAND.exec(line)?.[1];
        if (subcommand !== undefined && NO_CRATES.includes(subcommand)) continue;
        const reader = CRATES.find((entry) => entry.pattern.test(line));
        if (reader === undefined) continue;
        reading.add(reader.program);
        if (!fetched) found.push(`${group}: make ${target} starts ${reader.program} before a setup step of the group fetched the crates of Cargo.lock (hyper-install-crates in CI_SETUP_${group}): ${line.trim().slice(0, 200)}`);
        if (subcommand !== undefined && !line.includes(' --offline')) found.push(`${group}: make ${target} starts cargo ${subcommand} without --offline, so a check may download a crate outside an install target (HR-89): ${line.trim().slice(0, 200)}`);
      }
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
      if (lines.some((line) => FETCH.test(line))) {
        fetched = true;
        fetching.add(group);
      }
    }
    assert.deepEqual([...installed].filter((tool) => tool !== 'wasm-bindgen').sort(), makeWords(`CI_TOOLS_${group}`).sort(), `the setup of the group ${group} installs CI_TOOLS_${group} with install-tools`);
    for (const target of makeWords(`CI_TARGETS_${group}`)) judge(target, commands(target));
  }
  assert.ok(judged > groups.length, `${judged} targets were judged`);
  // A row that no command line matches judges nothing (HR-84).
  assert.deepEqual(STARTED.map((entry) => entry.program).filter((program) => !matched.has(program)), [], 'a row of STARTED matches no command line of any CI group');
  assert.ok(conditional > 0, 'no setup step prints the check of the PHP wrapper with its condition');
  assert.deepEqual(CRATES.map((entry) => entry.program).filter((program) => !reading.has(program)), [], 'a row of CRATES matches no command line of any CI group');
  assert.ok(fetching.size > 0, 'no setup step of any CI group prints the command line of hyper-install-crates');
  assert.deepEqual(found, []);
  assert.deepEqual(INSTALLS.map((install) => install.name).filter((name) => !installing.has(name)), [], 'a row of INSTALLS matches no command line of any setup step');
});

test('the job of release.yml installs every tool that its steps start, before the command line that starts it (HR-95, H35.35)', () => {
  const kinds = (JSON.parse(readFileSync(path.join(ROOT, 'config/release.json'), 'utf8')) as { packages: { kind: string }[] }).packages.map((item) => item.kind);
  assert.ok(kinds.includes('composer') || kinds.includes('wheel'), 'config/release.json holds no Composer package and no wheel, so release-tools of kit installs no tool');
  const judged = jobToolProblems('release', releaseCalls(), []);
  // release-go-module generates the Go binding with cargo; a dry run that does not name it judged nothing (HR-84).
  assert.deepEqual(['cargo', 'go of binding'].filter((program) => !judged.matched.has(program)), [], 'no command line of the release starts a program that its steps build with');
  assert.ok(judged.installs >= 1, `${judged.installs} command lines of the release install the tools: release-tools`);
  assert.deepEqual(judged.found, []);
});

/**
 * The tools that the command lines of the make calls `calls` of the job `job` start before a line of the job installs
 * them, with the programs that were matched and the count of the lines that install. The command lines run in their
 * order, those of the makes that a recipe starts included, so a tool counts as installed only for the lines after the
 * line that installs it; `provided` are the tools that a uses: step of the job sets up before its run step.
 */
function jobToolProblems(job: string, calls: Call[], provided: string[]): { found: string[]; matched: Set<string>; installs: number } {
  const rows = [...STARTED, ...RELEASE_STARTED];
  const every = new Set(rows.flatMap((entry) => entry.tools));
  const installed = new Set<string>(provided);
  const matched = new Set<string>();
  const found: string[] = [];
  let installs = 0;
  for (const call of calls) {
    for (const line of commands(call.target, call.variables)) {
      if (WHERE_INSTALLED.test(line)) continue;
      for (const entry of rows) {
        if (!entry.pattern.test(line)) continue;
        matched.add(entry.program);
        for (const tool of entry.tools) {
          if (!installed.has(tool)) found.push(`${job}: make ${call.target} starts ${entry.program}, and no command line of the job before it installs ${tool}: ${line.trim().slice(0, 200)}`);
        }
      }
      const selected = [...INSTALLS, ...RELEASE_INSTALLS].flatMap((install) => install.tools(line));
      const all = INSTALLS_ALL.test(line);
      if (all || selected.length > 0) installs += 1;
      for (const tool of all ? every : selected) installed.add(tool);
    }
  }
  return { found, matched, installs };
}

// The jobs of assets.yml: the recipe of each, the variables that its matrix gives, and the tools that a uses: step of the
// job sets up, which the recipe does not install: the job php takes the PHP of its matrix entry from setup-php.
const ASSET_JOBS: readonly { job: string; variables: string[]; provided: string[]; programs: string[] }[] = [
  { job: 'platform', variables: [], provided: [], programs: ['cargo', 'go of binding', 'maturin', 'wheel build', 'napi'] },
  { job: 'php', variables: ['EXPECTED_PHP_MINOR=8.4'], provided: ['php'], programs: ['cargo', 'go of binding'] },
  { job: 'npm', variables: [], provided: [], programs: ['cargo', 'go of binding', 'wasm-bindgen'] },
];

test('each job of assets.yml installs every tool that its recipe starts, before the command line that starts it, in CI and in a release (H35.35-5)', () => {
  const workflow = readFileSync(path.join(ROOT, '.github/workflows/assets.yml'), 'utf8');
  const found: string[] = [];
  for (const { job, variables, provided, programs } of ASSET_JOBS) {
    // A tool that a uses: step provides is one that the job sets up: the job php holds the setup-php step.
    if (provided.includes('php')) assert.match(/^ {2}php:\n((?: {4}.*\n|\n)*)/mu.exec(workflow)?.[1] ?? '', /uses: shivammathur\/setup-php@/u, 'the job php of assets.yml sets up no PHP');
    for (const release of [[], ['RELEASE=true']]) {
      const judged = jobToolProblems(`assets ${job}${release.length ? ' of a release' : ''}`, jobCalls(`ci-assets-${job}`, [...variables, ...release]), provided);
      found.push(...judged.found);
      // The programs of the build and the check of binding are named; a dry run that names none judged nothing (HR-84).
      assert.deepEqual(programs.filter((program) => !judged.matched.has(program)), [], `the recipe ci-assets-${job} ${release.join(' ')} starts none of the programs that its job builds with`);
      assert.ok(judged.installs >= 1, `the recipe ci-assets-${job} installs no tool`);
    }
  }
  assert.deepEqual(found, []);
});

test('rust-toolchain.toml names every Rust target and component that a command line of a CI group, of an assets job or of the release needs (HR-81, H35.35, H35.35-5)', () => {
  // install-tools of kit passes the targets and the components of rust-toolchain.toml to rustup with the toolchain, and
  // no other step adds one.
  const toolchain = readFileSync(path.join(ROOT, 'rust-toolchain.toml'), 'utf8');
  const listed = (key: string): string[] => [...(new RegExp(`^${key} = \\[(.*)\\]$`, 'mu').exec(toolchain)?.[1] ?? '').matchAll(/"([^"]+)"/gu)].map((item) => item[1] ?? '');
  const targets = listed('targets');
  const components = listed('components');
  const named = new Map<string, string>();
  const tools = new Map<string, string>();
  const read = (where: string, lines: string[]): void => {
    for (const line of lines) {
      // A target that cargo builds for, and the musl target of each Linux host of release-go-static.
      for (const target of [CARGO_TARGET.exec(line)?.[1], ...[...line.matchAll(/\bmusl=([a-z0-9_]+-unknown-linux-musl)\b/gu)].map((musl) => musl[1])]) {
        if (target !== undefined && !named.has(target)) named.set(target, where);
      }
      // A program of the component llvm-tools, started from the folder of the toolchain.
      if (/\/lib\/rustlib\/[^/]+\/bin\/llvm-[a-z]+/u.test(line) && !tools.has('llvm-tools')) tools.set('llvm-tools', where);
    }
  };
  for (const group of [...makeWords('CI_GROUPS'), 'bench']) {
    for (const step of makeWords(`CI_SETUP_${group}`)) read(`${group}: make ${step}`, commands(step, setupVariables(group, step)));
    for (const target of makeWords(`CI_TARGETS_${group}`)) read(`${group}: make ${target}`, commands(target));
  }
  for (const { job, variables } of ASSET_JOBS) for (const call of jobCalls(`ci-assets-${job}`, variables)) read(`assets ${job}: make ${call.target}`, commands(call.target, call.variables));
  for (const call of releaseCalls()) read(`release: make ${call.target}`, commands(call.target, call.variables));
  assert.ok(named.has('wasm32-unknown-unknown') && [...named.keys()].some((target) => target.endsWith('-musl')) && tools.size > 0, `the dry runs name the WASM target, a musl target and a program of llvm-tools: ${[...named.keys(), ...tools.keys()].join(' ')}`);
  assert.deepEqual([
    ...[...named].filter(([target]) => !targets.includes(target)).map(([target, where]) => `${where} builds for the Rust target ${target}, which rust-toolchain.toml does not name in targets, so install-tools installs no standard library of it`),
    ...[...tools].filter(([component]) => !components.includes(component)).map(([component, where]) => `${where} starts a program of the Rust component ${component}, which rust-toolchain.toml does not name in components, so install-tools does not install it`),
  ], []);
});

test('install-wasm-bindgen of a tree without packages/release.mk writes the file first and installs the wasm-bindgen CLI with the mise of the checkout (H35.16-6)', (t) => {
  const { tree, variables } = treeWithoutReleaseRecipes(t, 'hyper-install-wasm-bindgen-');
  const lines = dryRun('install-wasm-bindgen', { cwd: tree, variables });
  assert.ok(existsSync(path.join(tree, 'packages/release.mk')), `make wrote packages/release.mk before it read install-wasm-bindgen:\n${lines.join('\n')}`);
  // The line downloads, so it lifts the offline settings of the Makefile ($(ONLINE)), and names the mise of the tree.
  assert.deepEqual(lines.filter((line) => line.includes('mise install')), [`env -u npm_config_offline -u COMPOSER_DISABLE_NETWORK ${path.join(tree, 'var/tools/bin/mise')} install --locked github:wasm-bindgen/wasm-bindgen`]);
});

test('the group core is the one CI group that starts wasm-bindgen, and its setup writes the release recipes and installs it after install-tools (H35.16-6)', () => {
  const starting = makeWords('CI_GROUPS').filter((group) => makeWords(`CI_TARGETS_${group}`).some((target) => commands(target).some((line) => /\/mise\/shims\/wasm-bindgen\b/u.test(line))));
  assert.deepEqual(starting, ['core']);
  assert.deepEqual(makeWords('CI_SETUP_core'), ['install-tools', 'hyper-install-crates', 'release-recipes', 'install-wasm-bindgen']);
});
