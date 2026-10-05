#!/usr/bin/env node
// The test runner of the repository. Every test target runs its test tool through this script, which prints
// each test as it starts, keeps running, passes, fails or is skipped, with the elapsed time, and gives every
// test its own timeout.
//
//   node scripts/run-tests.mjs <node|vitest|phpunit> [--timeout <seconds>] [--cwd <directory>] [--extension <file>] [--] [<arguments>]
//
// The arguments after the runner's options go to the tool. --extension loads a PHP extension into PHPUnit.
// node (node --test) and vitest stop a test at its timeout themselves; for phpunit this runner stops the tool
// when a test outlives it. A run in which no test ran, because no file, no test or no name pattern selected one, fails
// (HY-84): the progress reporters write their counts to the file of HYPER_TEST_RESULT, and the runner requires at least
// one test that passed, failed or ran out of time.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import { createProgress } from './test-progress/progress.mjs';
import { toolPath } from './toolchain.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'Usage: node scripts/run-tests.mjs <node|vitest|phpunit> [--timeout <seconds>] [--cwd <directory>] [--extension <file>] [--] [<arguments>]';
const DEFAULT_TIMEOUT_SECONDS = 30;

export function parseArguments(argv) {
  const [tool, ...rest] = argv;
  if (!['node', 'vitest', 'phpunit'].includes(tool)) throw new Error(USAGE);
  const options = { tool, timeoutSeconds: DEFAULT_TIMEOUT_SECONDS, cwd: ROOT, extension: null, args: [] };
  let index = 0;
  for (; index < rest.length; index += 2) {
    const [flag, value] = [rest[index], rest[index + 1]];
    if (flag === '--timeout') {
      if (!/^[1-9]\d*$/.test(value ?? '')) throw new Error(USAGE);
      options.timeoutSeconds = Number(value);
    } else if (flag === '--cwd') {
      if (!value) throw new Error(USAGE);
      options.cwd = path.resolve(ROOT, value);
    } else if (flag === '--extension') {
      if (!value || tool !== 'phpunit') throw new Error(USAGE);
      options.extension = path.resolve(ROOT, value);
    } else break;
  }
  options.args = rest.slice(rest[index] === '--' ? index + 1 : index);
  return options;
}

/** The command of a tool with its progress and timeout arguments. */
export function toolCommand({ tool, timeoutSeconds, cwd, extension, args }) {
  const milliseconds = String(timeoutSeconds * 1000);
  switch (tool) {
    case 'node':
      return {
        command: process.execPath,
        // A timed-out test can leave work pending; the file's process ends when its tests end.
        args: ['--test', '--test-force-exit', `--test-timeout=${milliseconds}`, `--test-reporter=${path.join(ROOT, 'scripts/test-progress/node-reporter.mjs')}`, '--test-reporter-destination=stdout', ...args],
      };
    case 'vitest':
      return {
        // npm installs no bin links (HY-79), so the runner starts the entry of the vitest package with node.
        command: process.execPath,
        args: [path.join(ROOT, 'node_modules/vitest/vitest.mjs'), 'run', `--testTimeout=${milliseconds}`, `--hookTimeout=${milliseconds}`, `--reporter=${path.join(ROOT, 'scripts/test-progress/vitest-reporter.mjs')}`, ...args],
      };
    case 'phpunit':
      return { command: 'php', args: [...(extension ? ['-d', `extension=${extension}`] : []), path.join(cwd, 'vendor/bin/phpunit'), '--teamcity', ...args] };
  }
  throw new Error(USAGE);
}

const unescapeTeamcity = (value) => value.replace(/\|(['|\][nr])/g, (match, character) => ({ n: '\n', r: '\r' })[character] ?? character);

/**
 * Read PHPUnit TeamCity messages into progress lines. Other lines, such as the summary with the warnings that
 * fail the run under failOnWarning, are printed as they are.
 */
export function phpunitEvents(progress) {
  const failures = new Map();
  // A test is named by its class and method; testFinished repeats only the method name.
  const ids = new Map();
  // Suites without a location (the configuration and the test suites) are printed as groups. A class or a data
  // provider method has a location on its start only, so its finish is matched by this set.
  const groups = new Set();
  const qualified = (attributes) => {
    const hint = /::\\?([^:]+)::(.+)$/.exec(attributes.locationHint ?? '');
    return hint ? `${hint[1].split('\\').pop()}::${hint[2]}` : attributes.name;
  };
  return (line) => {
    const message = /^##teamcity\[(\w+)((?: \w+='(?:[^'|]|\|.)*')*)\]$/.exec(line.trim());
    if (!message) return line.trim() ? progress.line(line) : undefined;
    const attributes = Object.fromEntries([...message[2].matchAll(/ (\w+)='((?:[^'|]|\|.)*)'/g)].map(([, key, value]) => [key, unescapeTeamcity(value)]));
    if (message[1] === 'testStarted') ids.set(attributes.name, qualified(attributes));
    const id = ids.get(attributes.name) ?? attributes.name;
    switch (message[1]) {
      case 'testSuiteStarted': {
        if (attributes.locationHint) return undefined;
        groups.add(id);
        return progress.start(id, { group: true });
      }
      case 'testSuiteFinished': return groups.delete(id) ? progress.pass(id) : undefined;
      case 'testStarted': return progress.start(id);
      case 'testFailed': failures.set(id, `${attributes.message ?? ''}\n${attributes.details ?? ''}`); return undefined;
      case 'testIgnored': return progress.skip(id);
      case 'testFinished': {
        const duration = Number(attributes.duration);
        if (failures.has(id)) { const text = failures.get(id); failures.delete(id); return progress.fail(id, duration, text); }
        return progress.pass(id, duration);
      }
      default: return undefined;
    }
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const { command, args } = toolCommand(options);
  const label = `${options.tool} ${path.relative(ROOT, options.cwd) || '.'}${options.extension ? ` with ${path.basename(options.extension)}` : ''}${options.args.length ? ` ${options.args.join(' ')}` : ''}`;
  process.stdout.write(`▶ ${label} (each test ${options.timeoutSeconds}s)\n`);
  const reads = options.tool === 'phpunit';
  // A runner started from inside node --test must not join that run as its child.
  // The tool and the programs that it starts find npm and Composer of this checkout first (HY-81).
  const results = mkdtempSync(path.join(tmpdir(), 'hyper-test-result-'));
  const resultFile = path.join(results, 'result.json');
  const env = { ...process.env, PATH: toolPath(), HYPER_TEST_RESULT: resultFile };
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(command, args, { cwd: options.cwd, env, stdio: ['ignore', reads ? 'pipe' : 'inherit', 'inherit'], detached: reads });
  let timedOut = false;
  const progress = reads ? createProgress({
    write: (text) => process.stdout.write(text),
    timeoutMs: options.timeoutSeconds * 1000,
    onTimeout: () => { timedOut = true; process.kill(-child.pid, 'SIGTERM'); },
  }) : undefined;
  if (reads) readline.createInterface({ input: child.stdout }).on('line', phpunitEvents(progress));
  const { status, signal } = await new Promise((resolve) => child.on('close', (status, signal) => resolve({ status, signal })));
  const code = status ?? (signal ? 1 : 0);
  let counts = null;
  if (progress) {
    counts = progress.close(label, { exitCode: timedOut ? 0 : code });
    process.exitCode = counts.ok && !timedOut ? 0 : 1;
  } else {
    // node --test and vitest print their summary from inside the tool; a tool that then ends on a signal or a
    // nonzero code fails the run, and this line names why.
    if (code !== 0) process.stdout.write(`✖ ${label}: the tool ended ${signal ? `on ${signal}` : `with exit code ${status}`}\n`);
    process.exitCode = code;
  }
  if (!progress && existsSync(resultFile)) counts = JSON.parse(readFileSync(resultFile, 'utf8'));
  rmSync(results, { recursive: true, force: true });
  if (counts === null) {
    process.stdout.write(`✖ ${label}: the progress reporter wrote no counts, so the run cannot show that a test ran\n`);
    process.exitCode = 1;
  } else if (counts.ran === 0) {
    process.stdout.write(`✖ ${label}: no test ran: expected at least 1 test that passes, fails or runs out of time, actual 0 (${counts.skipped} skipped)\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
