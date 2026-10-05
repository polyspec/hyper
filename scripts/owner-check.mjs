#!/usr/bin/env node
// Runs the owner checks of changed paths (HY-88). scripts/owner-checks.json declares, for globs of repository paths,
// the make targets and the node test files that own them; `make owner-check` runs exactly the owners of the paths that
// a change touches, never the full suite, which `make check` runs once when every active task is done. The node test
// files run through `make test-scripts TESTS=<files>`, which writes the inputs that they read first (HY-85).
//
// The declaration is checked on every run, before any owner runs: every tracked path matches at least one owner
// rule, every glob matches at least one tracked path (new files not ignored count as tracked), every target exists in the Makefile and is not the full suite,
// and every test file exists. A failure names the path, the glob or the target. `always` lists the tests that run for
// every change; they do not make a path owned.
//
// A glob matches a repository path: `*` within one path segment, `**` across segments, `{a,b}` either alternative.
// A rule with `variable` passes the matched paths to its targets in that make variable (for example CASES).
//
// Usage: node scripts/owner-check.mjs [--paths "<path> ..."] [--base <revision>] [--dry-run] [--validate]
//   --paths     the changed paths; default: the uncommitted tracked changes and the untracked files not ignored
//   --base      the changed paths are those between <revision> and the working tree
//   --dry-run   print the selection without running it
//   --validate  check the declaration only
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DECLARATION = 'scripts/owner-checks.json';

function git(...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} exited with ${result.status}: ${result.stderr.trim()}`);
  return result.stdout.split('\n').filter(Boolean);
}

/** The regular expression source of a glob. */
function globSource(glob) {
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (glob.startsWith('**/', index)) { source += '(?:.*/)?'; index += 2; }
    else if (glob.startsWith('**', index)) { source += '.*'; index += 1; }
    else if (character === '*') source += '[^/]*';
    else if (character === '{') {
      const end = glob.indexOf('}', index);
      source += `(?:${glob.slice(index + 1, end).split(',').map(globSource).join('|')})`;
      index = end;
    } else source += character.replace(/[.+?^$()|[\]\\]/g, '\\$&');
  }
  return source;
}

/** The regular expression of a glob. */
export function globExpression(glob) {
  return new RegExp(`^${globSource(glob)}$`);
}

/** The make targets of the Makefile. */
function makeTargets(makefile) {
  return new Set([...makefile.matchAll(/^([a-zA-Z0-9_-]+):(?!=)/gm)].map(match => match[1]));
}

/**
 * The targets of the Makefile that run the full suite: `check`, `rerun-failed`, and every target whose recipe starts the
 * guard scripts/full-run.mjs.
 */
export function fullSuiteTargets(makefile) {
  const result = new Set(['check', 'rerun-failed']);
  for (const match of makefile.matchAll(/^([a-zA-Z0-9_-]+):(?!=)[^\n]*\n((?:\t[^\n]*\n?)*)/gm)) {
    if (/scripts\/full-run\.mjs/.test(match[2])) result.add(match[1]);
  }
  return result;
}

/** The errors of the declaration against the tracked paths and the Makefile. */
export function validate(declaration, tracked, makefile, exists) {
  const errors = [];
  const targets = makeTargets(makefile);
  const fullSuite = fullSuiteTargets(makefile);
  const suite = (makefile.match(/^CHECK_TARGETS := (.*)$/m)?.[1] ?? '').split(/\s+/).filter(Boolean);
  const rules = declaration.owners.map(rule => ({ ...rule, expressions: rule.paths.map(globExpression) }));
  for (const rule of rules) {
    rule.paths.forEach((glob, index) => {
      if (!tracked.some(path => rule.expressions[index].test(path))) errors.push(`${DECLARATION}: the glob ${glob} matches no tracked path`);
    });
    for (const target of rule.targets ?? []) {
      if (!targets.has(target)) errors.push(`${DECLARATION}: the target ${target} of ${rule.paths.join(' ')} is not a target of the Makefile`);
      if (fullSuite.has(target)) errors.push(`${DECLARATION}: the target ${target} runs the full suite, which an owner check never runs`);
    }
    for (const test of rule.tests ?? []) if (test !== '$path' && !exists(test)) errors.push(`${DECLARATION}: the test ${test} of ${rule.paths.join(' ')} does not exist`);
  }
  for (const test of declaration.always ?? []) if (!exists(test)) errors.push(`${DECLARATION}: the test ${test} of always does not exist`);
  if (suite.length && rules.some(rule => suite.every(target => rule.targets?.includes(target)))) errors.push(`${DECLARATION}: a rule selects every target of CHECK_TARGETS`);
  for (const path of tracked) {
    if (!rules.some(rule => rule.expressions.some(expression => expression.test(path)))) errors.push(`${path}: the path matches no owner in ${DECLARATION}`);
  }
  return errors;
}

/** The owners of the changed paths: the targets with their make variables, and the test files. A removed path that no
 * rule owns selects nothing; an existing path that no rule owns is unowned. */
export function select(declaration, changed, order, exists = () => true) {
  const rules = declaration.owners.map(rule => ({ ...rule, expressions: rule.paths.map(globExpression) }));
  const targets = new Map();
  const selected = new Set(declaration.always ?? []);
  const reasons = [];
  const unowned = [];
  for (const path of changed) {
    const matched = rules.filter(rule => rule.expressions.some(expression => expression.test(path)));
    if (!matched.length && !exists(path)) reasons.push(`${path} -> nothing: the path was removed and no rule owns it`);
    else if (!matched.length) unowned.push(path);
    for (const rule of matched) {
      // A test that is the changed path itself runs only while the path exists.
      const tests = (rule.tests ?? []).flatMap(test => (test !== '$path' ? [test] : exists(path) ? [path] : []));
      const owned = [...(rule.targets ?? []), ...tests];
      reasons.push(`${path} -> ${owned.join(' ')}`);
      for (const target of rule.targets ?? []) {
        const variables = targets.get(target) ?? {};
        if (rule.variable) variables[rule.variable] = [...(variables[rule.variable] ?? []), path];
        targets.set(target, variables);
      }
      for (const test of tests) selected.add(test);
    }
  }
  const position = target => (order.includes(target) ? order.indexOf(target) : order.length);
  const sorted = [...targets].sort(([a], [b]) => position(a) - position(b) || a.localeCompare(b));
  return { targets: sorted.map(([target, variables]) => ({ target, variables })), tests: [...selected].sort(), reasons, unowned };
}

function changedPaths(values) {
  if (values.paths !== undefined) return values.paths.split(/\s+/).filter(Boolean);
  const changed = values.base ? git('diff', '--name-only', values.base) : git('diff', '--name-only', 'HEAD');
  return [...new Set([...changed, ...git('ls-files', '--others', '--exclude-standard')])].sort();
}

function step(name, command, args) {
  console.log(`[owner-check] start ${name}`);
  const started = performance.now();
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const passed = result.status === 0;
  console.log(`[owner-check] ${name} ${passed ? 'passed' : `failed with ${result.status ?? result.signal}`} in ${seconds} s`);
  return passed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { paths: { type: 'string' }, base: { type: 'string' }, 'dry-run': { type: 'boolean' }, validate: { type: 'boolean' } } });
  const declaration = JSON.parse(readFileSync(join(root, DECLARATION), 'utf8'));
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  const errors = validate(declaration, git('ls-files', '--cached', '--others', '--exclude-standard'), makefile, path => existsSync(join(root, path)));
  if (errors.length) {
    for (const error of errors) console.error(`[owner-check] ${error}`);
    process.exit(1);
  }
  if (values.validate) {
    console.log(`[owner-check] ${DECLARATION} owns every tracked path`);
    process.exit(0);
  }
  const changed = changedPaths(values);
  const order = (makefile.match(/^CHECK_TARGETS := (.*)$/m)?.[1] ?? '').split(/\s+/).filter(Boolean);
  const selection = select(declaration, changed, order, path => existsSync(join(root, path)));
  if (selection.unowned.length) {
    for (const path of selection.unowned) console.error(`[owner-check] ${path}: the path matches no owner in ${DECLARATION}`);
    process.exit(1);
  }
  for (const reason of selection.reasons) console.log(`[owner-check] ${reason}`);
  const commands = [
    ...selection.targets.map(({ target, variables }) => {
      const assignments = Object.entries(variables).map(([name, paths]) => `${name}=${paths.join(' ')}`);
      return { name: [target, ...assignments].join(' '), command: 'make', args: ['--no-print-directory', target, ...assignments] };
    }),
    ...(selection.tests.length ? [{ name: `test-scripts TESTS=${selection.tests.join(' ')}`, command: 'make', args: ['--no-print-directory', 'test-scripts', `TESTS=${selection.tests.join(' ')}`] }] : []),
  ];
  console.log(`[owner-check] ${changed.length} changed paths select ${commands.map(command => command.name).join('; ') || 'nothing'}`);
  if (values['dry-run']) process.exit(0);
  const failed = commands.filter(command => !step(command.name, command.command, command.args)).map(command => command.name);
  console.log(`[owner-check] ${failed.length ? `failed: ${failed.join('; ')}` : 'every owner check passed'}`);
  process.exitCode = failed.length ? 1 : 0;
}
