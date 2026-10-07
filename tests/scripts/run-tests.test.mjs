// Tests scripts/run-tests.mjs: every test prints its start, its result and its elapsed time, and a test that
// outlives its timeout fails by its name while the run ends.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseArguments, phpunitEvents, toolCommand } from '../../scripts/run-tests.mjs';
import { createProgress } from '../../scripts/test-progress/progress.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RUNNER = path.join(ROOT, 'scripts/run-tests.mjs');

function recorder() {
  const lines = [];
  const progress = createProgress({ write: (text) => lines.push(text.replace(/^\[\s*[\d.]+s\] /, '').trim()), now: () => 0, heartbeatMs: 60_000 });
  return { lines, progress };
}

async function withDirectory(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hyper-run-tests-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('arguments select a tool, a per-test timeout, a directory and a PHP extension', () => {
  assert.deepEqual(parseArguments(['node', '--timeout', '5', '--', 'a.test.mjs']), { tool: 'node', timeoutSeconds: 5, cwd: ROOT, extension: null, args: ['a.test.mjs'] });
  assert.equal(parseArguments(['vitest', '--cwd', 'packages/hyper-js']).cwd, path.join(ROOT, 'packages/hyper-js'));
  assert.deepEqual(parseArguments(['vitest', '--cwd', 'packages/hyper-js', 'tests/keep.test.ts']).args, ['tests/keep.test.ts']);
  assert.deepEqual(parseArguments(['node', '--test-name-pattern', 'x']).args, ['--test-name-pattern', 'x']);
  for (const argv of [[], ['jest'], ['go'], ['node', '--timeout', '0'], ['node', '--timeout', '1.5'], ['node', '--cwd'], ['node', '--extension', 'a.so'], ['phpunit', '--extension']]) {
    assert.throws(() => parseArguments(argv), /Usage/, JSON.stringify(argv));
  }
  assert.ok(toolCommand(parseArguments(['node', '--timeout', '5'])).args.includes('--test-timeout=5000'));
  const vitest = toolCommand(parseArguments(['vitest', '--timeout', '5'])).args;
  assert.ok(vitest.includes('--testTimeout=5000') && vitest.includes('--hookTimeout=5000'), vitest.join(' '));
  const phpunit = toolCommand(parseArguments(['phpunit', '--cwd', 'packages/hyper-php', '--extension', 'build/ext/a.so', '--', '--filter', 'X']));
  assert.deepEqual(phpunit, {
    command: 'php',
    args: ['-d', `extension=${path.join(ROOT, 'build/ext/a.so')}`, path.join(ROOT, 'vendor/bin/phpunit'), '--teamcity', '--filter', 'X'],
  });
});

test('PHPUnit TeamCity messages name each test by class and method and other lines are printed', () => {
  const { lines, progress } = recorder();
  const read = phpunitEvents(progress);
  for (const line of [
    'PHPUnit 11.5.56 by Sebastian Bergmann and contributors.',
    '',
    "##teamcity[testSuiteStarted name='Suite' flowId='1']",
    "##teamcity[testSuiteStarted name='A\\ATest' locationHint='php_qn:///t/ATest.php::\\A\\ATest' flowId='1']",
    "##teamcity[testSuiteStarted name='testA' locationHint='php_qn:///t/ATest.php::\\A\\ATest::testA' flowId='1']",
    "##teamcity[testStarted name='testA with data set \"x\"' locationHint='php_qn:///t/ATest.php::\\\\A\\\\ATest::testA with data set \"x\"' flowId='1']",
    "##teamcity[testFailed name='testA with data set \"x\"' message='Failed asserting |'1|'' details='at ATest.php:3|n' flowId='1']",
    "##teamcity[testFinished name='testA with data set \"x\"' duration='12' flowId='1']",
    "##teamcity[testSuiteFinished name='testA' flowId='1']",
    "##teamcity[testStarted name='testB' locationHint='php_qn:///t/ATest.php::\\\\A\\\\ATest::testB' flowId='1']",
    "##teamcity[testFinished name='testB' duration='0' flowId='1']",
    "##teamcity[testSuiteFinished name='A\\ATest' flowId='1']",
    "##teamcity[testSuiteFinished name='Suite' flowId='1']",
    'Test file "/missing.php" not found',
  ]) read(line);
  // The class and the data provider method are suites, not tests: two tests ran.
  assert.deepEqual(progress.counts, { passed: 1, failed: 1, skipped: 0, timedOut: 0 });
  assert.deepEqual(lines, [
    'PHPUnit 11.5.56 by Sebastian Bergmann and contributors.', '▶ Suite', '▶ ATest::testA with data set "x"', '✖ ATest::testA with data set "x" (0.0s)', "Failed asserting '1'", 'at ATest.php:3',
    '▶ ATest::testB', '✔ ATest::testB (0.0s)', '✔ Suite (0.0s)', 'Test file "/missing.php" not found',
  ]);
});

// Runs the runner with `args` and resolves its status and output when it ends. A runner that does not stop a test at
// its timeout never ends, and the timeout of the case fails the case; no case measures the time of the run.
function runToEnd(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [RUNNER, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.once('error', reject);
    child.once('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('a node test that outlives its timeout fails by its name and the run ends', async () => {
  await withDirectory(async (directory) => {
    const file = path.join(directory, 'hang.test.mjs');
    // The test never ends by itself: only the timeout of the runner ends it.
    await writeFile(file, "import test from 'node:test';\ntest('hangs', () => new Promise(() => setInterval(() => {}, 1000)));\ntest('passes', () => {});\n");
    const run = await runToEnd(['node', '--timeout', '1', '--', file]);
    assert.notEqual(run.status, 0);
    assert.match(run.stdout, /▶ .*hang\.test\.mjs › hangs\n/);
    assert.match(run.stdout, /✖ .*hang\.test\.mjs › hangs \(1\.0s\)\n\s+test timed out after 1000ms/);
    assert.match(run.stdout, /✔ .*hang\.test\.mjs › passes \(\d+\.\ds\)/);
  });
});

test('a vitest test that outlives its timeout fails by its name and the run ends', async () => {
  await withDirectory(async (directory) => {
    await writeFile(path.join(directory, 'hang.test.mjs'), "import { test } from 'vitest';\ntest('hangs', () => new Promise(() => setInterval(() => {}, 1000)));\ntest('passes', () => {});\n");
    const run = await runToEnd(['vitest', '--timeout', '1', '--cwd', directory]);
    assert.notEqual(run.status, 0);
    assert.match(run.stdout, /▶ .*hang\.test\.mjs › hangs\n/);
    assert.match(run.stdout, /✖ .*hang\.test\.mjs › hangs \(1\.0s\)\n\s+Error: Test timed out in 1000ms/);
    assert.match(run.stdout, /✔ .*hang\.test\.mjs › passes \(\d+\.\ds\)/);
    assert.match(run.stdout, /✖ vitest: 1 passed, 1 failed, 0 timed out, 0 skipped, 1 group failed \(\d+\.\ds\)/);
  });
});

test('a PHPUnit test that outlives its timeout stops PHPUnit and fails by its name', async () => {
  await withDirectory(async (directory) => {
    const file = path.join(directory, 'HangTest.php');
    await writeFile(file, '<?php\nuse PHPUnit\\Framework\\TestCase;\nfinal class HangTest extends TestCase {\n    public function testHangs(): void { while (true) { sleep(1); } }\n}\n');
    const run = await runToEnd(['phpunit', '--timeout', '1', '--cwd', 'packages/hyper-php', '--', '--no-configuration', file]);
    assert.notEqual(run.status, 0);
    assert.match(run.stdout, /▶ HangTest::testHangs\n/);
    assert.match(run.stdout, /⏱ HangTest::testHangs exceeded its 1\.0s timeout\n/);
    assert.match(run.stdout, /✖ HangTest::testHangs \(\d+\.\ds\)\n\s+the test did not finish/);
    assert.match(run.stdout, /✖ phpunit .*: 0 passed, 1 failed, 1 timed out, 0 skipped \(\d+\.\ds\)/);
  });
});

test('a node run that ends with a failure after its tests passed says so on a failure line', async () => {
  // The reporter prints its passing summary from inside node --test; when node --test itself then ends on a
  // signal or a nonzero code, the run fails and a line names why.
  await withDirectory(async (directory) => {
    const file = path.join(directory, 'killed.test.mjs');
    await writeFile(file, "import test from 'node:test';\ntest('passes', () => {});\ntest.after(() => process.kill(process.ppid, 'SIGKILL'));\n");
    const run = spawnSync(process.execPath, [RUNNER, 'node', '--timeout', '10', '--', file], { encoding: 'utf8' });
    assert.notEqual(run.status, 0);
    assert.match(run.stdout, /✖ node .*killed\.test\.mjs: the tool ended on SIGKILL/);
  });
});

test('a node hook that runs out of time fails its file with the file and the elapsed time', async () => {
  // node --test reports a timed-out hook of a file only as a failure of the file's process, without a
  // completion of that test; the file itself still completes as passed.
  await withDirectory(async (directory) => {
    const file = path.join(directory, 'hook.test.mjs');
    await writeFile(file, "import test from 'node:test';\ntest('passes', () => {});\ntest.after(() => new Promise(resolve => setTimeout(resolve, 600_000)), { timeout: 300 });\n");
    const run = spawnSync(process.execPath, [RUNNER, 'node', '--timeout', '10', '--', file], { encoding: 'utf8' });
    assert.notEqual(run.status, 0);
    assert.match(run.stdout, /✔ .*hook\.test\.mjs › passes/);
    assert.match(run.stdout, /✖ .*hook\.test\.mjs › hook \(\d+\.\ds\)\n\s+test timed out after 300ms/);
    assert.match(run.stdout, /✖ node --test: 1 passed, 1 failed, 0 timed out, 0 skipped, 1 group failed/);
  });
});

test('a vitest hook that runs out of time is printed with its file, suite, cause and elapsed time', async () => {
  await withDirectory(async (directory) => {
    await writeFile(path.join(directory, 'file-hook.test.mjs'), "import { afterAll, test } from 'vitest';\ntest('passes', () => {});\nafterAll(() => new Promise(resolve => setTimeout(resolve, 600_000)), 300);\n");
    await writeFile(path.join(directory, 'suite-hook.test.mjs'), "import { afterAll, describe, test } from 'vitest';\ndescribe('suite', () => {\n  afterAll(() => new Promise(resolve => setTimeout(resolve, 600_000)), 300);\n  test('passes', () => {});\n});\n");
    const run = spawnSync(process.execPath, [RUNNER, 'vitest', '--timeout', '10', '--cwd', directory], { encoding: 'utf8' });
    assert.notEqual(run.status, 0);
    assert.match(run.stdout, /✖ .*file-hook\.test\.mjs \(\d+\.\ds\)\n\s+Error: Hook timed out in 300ms/);
    assert.match(run.stdout, /✖ .*suite-hook\.test\.mjs › suite \(\d+\.\ds\)\n\s+Error: Hook timed out in 300ms/);
    assert.match(run.stdout, /✖ vitest: 2 passed, 0 failed, 0 timed out, 0 skipped, 3 groups failed/);
  });
});

test('a run in which no test ran fails for node, vitest and PHPUnit and says so (HY-84)', async () => {
  await withDirectory(async (directory) => {
    const noTest = /no test ran: expected at least 1 test that passes, fails or runs out of time, actual 0/;
    const empty = path.join(directory, 'empty');
    await mkdir(empty);
    const none = spawnSync(process.execPath, [RUNNER, 'node', '--', empty], { encoding: 'utf8' });
    assert.notEqual(none.status, 0, none.stdout);
    assert.match(none.stdout, noTest);
    const file = path.join(directory, 'one.test.mjs');
    await writeFile(file, "import test from 'node:test';\ntest('passes', () => {});\n");
    const unselected = spawnSync(process.execPath, [RUNNER, 'node', '--', '--test-name-pattern=selects-nothing', file], { encoding: 'utf8' });
    assert.notEqual(unselected.status, 0, unselected.stdout);
    assert.match(unselected.stdout, noTest);
    const vitest = path.join(directory, 'vitest');
    await mkdir(vitest);
    await writeFile(path.join(vitest, 'one.test.mjs'), "import { test } from 'vitest';\ntest('passes', () => {});\n");
    const filtered = spawnSync(process.execPath, [RUNNER, 'vitest', '--cwd', vitest, '--', '-t', 'selects-nothing'], { encoding: 'utf8' });
    assert.notEqual(filtered.status, 0, filtered.stdout);
    assert.match(filtered.stdout, noTest);
    const php = path.join(directory, 'OneTest.php');
    await writeFile(php, '<?php\nuse PHPUnit\\Framework\\TestCase;\nfinal class OneTest extends TestCase {\n    public function testPasses(): void { $this->assertTrue(true); }\n}\n');
    const phpunit = spawnSync(process.execPath, [RUNNER, 'phpunit', '--cwd', 'packages/hyper-php', '--', '--no-configuration', '--filter', 'selectsNothing', php], { encoding: 'utf8' });
    assert.notEqual(phpunit.status, 0, phpunit.stdout);
    assert.match(phpunit.stdout, noTest);
    const ran = spawnSync(process.execPath, [RUNNER, 'node', '--', file], { encoding: 'utf8' });
    assert.equal(ran.status, 0, ran.stdout);
  });
});

// node --test runs with --test-force-exit, which ends a file when its registered tests end, so a test that a file
// registers after a top-level await never runs and is not counted.
test('no node test file awaits at its top level (HY-84)', async () => {
  const directories = ['tests/scripts', 'tests/package-install'];
  const files = directories.flatMap((directory) => readdirSync(path.join(ROOT, directory)).filter((name) => /\.test\.(mjs|ts)$/.test(name)).map((name) => path.join(directory, name)));
  assert.ok(files.length > 10, files.join('\n'));
  const found = files.flatMap((file) => readFileSync(path.join(ROOT, file), 'utf8').split('\n')
    .map((line, index) => ({ line, at: `${file}:${index + 1}` }))
    .filter(({ line }) => /^[^\s/].*\bawait\b|^await\b/.test(line)).map(({ at, line }) => `${at}: ${line}`));
  assert.deepEqual(found, []);
  await withDirectory(async (directory) => {
    const file = path.join(directory, 'late.test.mjs');
    await writeFile(file, "import test from 'node:test';\ntest('first', () => {});\nawait new Promise((resolve) => setTimeout(resolve, 200));\ntest('late', () => {});\n");
    const run = spawnSync(process.execPath, [RUNNER, 'node', '--', file], { encoding: 'utf8' });
    assert.match(run.stdout, /✔ .*late\.test\.mjs › first/);
    assert.doesNotMatch(run.stdout, /› late/, 'node --test --test-force-exit ran a test registered after a top-level await');
  });
});

test('a test that reads an input of another target fails with its path and the target that writes it (HY-85)', async () => {
  const { requireBuilt } = await import('./requires.mjs');
  assert.throws(() => requireBuilt('packages', 'node_modules/@polyspec/does-not-exist/dist/index.js'),
    /node_modules\/@polyspec\/does-not-exist\/dist\/index\.js is missing; `make packages` writes it, and `make test-scripts` runs it first/);
  assert.doesNotThrow(() => requireBuilt('install', 'package.json'));
});

// A case asserts behaviour, never the wall time of a step, which grows with the load of the machine (HY-89): a run that
// must stop is awaited until it ends, and the timeout of the case fails a run that does not.
test('no test of the check scripts asserts the wall time of a step', () => {
  const directory = path.join(ROOT, 'tests/scripts');
  const found = readdirSync(directory).filter((name) => name.endsWith('.test.mjs')).flatMap((name) => readFileSync(path.join(directory, name), 'utf8').split('\n').map((line, index) => [name, index + 1, line]))
    .filter(([, , line]) => /assert[\w.]*\(.*(?:Date|performance)\.now\(\) - /.test(line)).map(([name, line]) => `${name}:${line}`);
  assert.deepEqual(found, []);
});
