#!/usr/bin/env node
// Keeps the GitHub ruleset of the protected branch and the merge settings equal to .github/ruleset.json (HY-94):
//
//   node scripts/github-ruleset.mjs apply --gh <program>   change the declared settings and create or update the ruleset
//                                                          of the declared name where they differ, then compare again
//   node scripts/github-ruleset.mjs check --gh <program>   change nothing; fail when the live ruleset or a setting differs
//
// The declaration names the repository, the repository settings that the pull request flow needs (`settings`, fields
// of PATCH /repos/{owner}/{repo}) and the ruleset as the REST API takes it (`ruleset`). Every change reaches the
// protected branch through a pull request and the merge queue that the ruleset requires; this script publishes nothing.
//
// `--gh` names the GitHub CLI, authenticated with administration access to the repository; the Makefile passes its
// variable GH. The script reads nothing of the repository but the declaration and imports no module of it.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DECLARATION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.github/ruleset.json');
const USAGE = 'Usage: node scripts/github-ruleset.mjs apply | check --gh <program>';

/** A request failed; the message names its cause. */
class Stop extends Error {}

const log = line => process.stdout.write(`${line}\n`);
const error = line => process.stderr.write(`${line}\n`);

/** JSON with the keys of every object sorted, so two values compare by content. */
function canonical(value) {
  const sorted = entry => {
    if (Array.isArray(entry)) return entry.map(sorted);
    if (entry !== null && typeof entry === 'object') return Object.fromEntries(Object.keys(entry).sort().map(key => [key, sorted(entry[key])]));
    return entry;
  };
  return JSON.stringify(sorted(value) ?? null);
}

const byCanonical = (a, b) => (canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0);

/** `gh api` as a function: { status, body }; never fails for an HTTP status. */
function githubApi(gh) {
  return async (method, apiPath, body) => {
    const child = spawn(gh, ['api', '--method', method, '--include', apiPath, ...(body === undefined ? [] : ['--input', '-'])], { stdio: [body === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', chunk => (stderr += chunk));
    if (body !== undefined) child.stdin.end(JSON.stringify(body));
    const status = await new Promise((resolve, reject) => {
      child.on('error', cause => reject(new Stop(`${gh} api could not start: ${cause.message}`)));
      child.on('close', code => resolve(code));
    });
    // gh exits with 1 for an HTTP error status; the status line is still on standard output.
    const found = /^HTTP\/[\d.]+ (\d{3})/.exec(stdout);
    if (!found) throw new Stop(`gh api ${method} ${apiPath} failed: ${stderr.trim() || `exit status ${status}`}`);
    const text = stdout.split(/\r?\n\r?\n/).slice(1).join('\n\n').trim();
    return { status: Number(found[1]), body: text ? JSON.parse(text) : null };
  };
}

async function expectOk(api, method, apiPath, body) {
  const answer = await api(method, apiPath, body);
  if (answer.status >= 300) throw new Stop(`${method} ${apiPath} answered ${answer.status}: ${canonical(answer.body)}`);
  return answer.body;
}

/**
 * The fields of a ruleset that the declaration sets, in an order-free form: rules sorted, the required checks and the
 * bypass actors sorted. Fields that GitHub adds (id, source, _links, timestamps) are not compared.
 */
function normalize(ruleset, keys) {
  const picked = Object.fromEntries(keys.map(key => [key, ruleset?.[key] ?? null]));
  if (Array.isArray(picked.bypass_actors)) picked.bypass_actors = [...picked.bypass_actors].sort(byCanonical);
  if (Array.isArray(picked.rules)) {
    picked.rules = picked.rules
      .map(rule => {
        const checks = rule.parameters?.required_status_checks;
        return Array.isArray(checks) ? { ...rule, parameters: { ...rule.parameters, required_status_checks: [...checks].sort(byCanonical) } } : rule;
      })
      .sort(byCanonical);
  }
  return picked;
}

/** The fields of `declared` whose live value differs: [[field, actual, wanted]], empty when they match. */
function differences(declared, live, prefix = '') {
  const keys = Object.keys(declared);
  const wanted = normalize(declared, keys);
  const actual = normalize(live, keys);
  return keys.filter(key => canonical(actual[key]) !== canonical(wanted[key])).map(key => [prefix + key, actual[key], wanted[key]]);
}

/** The live ruleset of the declared name, or null; fails when the name is not unique. */
async function liveRuleset(declaration, api) {
  const repo = `repos/${declaration.repository}`;
  const { name } = declaration.ruleset;
  const listed = (await expectOk(api, 'GET', `${repo}/rulesets?includes_parents=false&per_page=100`)) ?? [];
  const named = listed.filter(ruleset => ruleset.name === name);
  if (named.length > 1) {
    throw new Stop(`${declaration.repository} has ${named.length} rulesets named ${name} (ids ${named.map(ruleset => ruleset.id).join(', ')}); delete all but one`);
  }
  return named.length === 1 ? expectOk(api, 'GET', `${repo}/rulesets/${named[0].id}`) : null;
}

/** Compares the declaration with the live repository: { live, settingChanges, rulesetChanges }. Reads only. */
async function plan(declaration, api) {
  const settings = declaration.settings ?? {};
  const settingChanges = Object.keys(settings).length > 0 ? differences(settings, await expectOk(api, 'GET', `repos/${declaration.repository}`), 'settings.') : [];
  const live = await liveRuleset(declaration, api);
  if (live === null) return { live, settingChanges, rulesetChanges: [['ruleset', null, declaration.ruleset.name]] };
  return { live, settingChanges, rulesetChanges: differences(declaration.ruleset, live) };
}

/**
 * Changes the declared settings and creates or updates the ruleset where they differ, then compares again: the second
 * comparison must be empty. Returns the changes.
 */
async function apply(declaration, api) {
  const repo = `repos/${declaration.repository}`;
  const { live, settingChanges, rulesetChanges } = await plan(declaration, api);
  for (const [field, actual, wanted] of [...settingChanges, ...rulesetChanges]) log(`[ruleset] ${field}: ${canonical(actual)} -> ${canonical(wanted)}`);
  if (settingChanges.length > 0) await expectOk(api, 'PATCH', repo, declaration.settings);
  if (live === null) await expectOk(api, 'POST', `${repo}/rulesets`, declaration.ruleset);
  else if (rulesetChanges.length > 0) await expectOk(api, 'PUT', `${repo}/rulesets/${live.id}`, declaration.ruleset);
  const left = await plan(declaration, api);
  const remaining = [...left.settingChanges, ...left.rulesetChanges];
  if (remaining.length > 0) throw new Stop(`the repository still differs after applying: ${remaining.map(([field]) => field).join(', ')}`);
  return [...settingChanges, ...rulesetChanges];
}

async function main(argv) {
  const [mode, flag, gh] = argv;
  if (argv.length !== 3 || !['apply', 'check'].includes(mode) || flag !== '--gh' || !gh) {
    error(USAGE);
    return 2;
  }
  const api = githubApi(gh);
  let name;
  let changes;
  try {
    const declaration = JSON.parse(readFileSync(DECLARATION, 'utf8'));
    name = `${declaration.repository} ruleset ${declaration.ruleset.name}`;
    if (mode === 'apply') {
      changes = await apply(declaration, api);
      log(`[ruleset] ${name}: ${changes.length} field(s) changed; the repository matches .github/ruleset.json`);
      return 0;
    }
    const found = await plan(declaration, api);
    changes = [...found.settingChanges, ...found.rulesetChanges];
  } catch (cause) {
    if (!(cause instanceof Stop) && !(cause instanceof SyntaxError) && cause.code !== 'ENOENT') throw cause;
    error(`[ruleset] ${cause.message}`);
    return 1;
  }
  for (const [field, actual, wanted] of changes) error(`[ruleset] differs: ${field}: live ${canonical(actual)}, declared ${canonical(wanted)}`);
  if (changes.length > 0) {
    error(`[ruleset] ${name} differs from .github/ruleset.json; run make github-ruleset`);
    return 1;
  }
  log(`[ruleset] ${name}: the repository matches .github/ruleset.json`);
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
