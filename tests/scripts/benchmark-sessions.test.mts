// The benchmark of the Redis sessions runs each server and reports what it counted (HY-115). Its PHP server loads the
// json, the template, the session-store and the hyper extension, as every PHP server of a run does (HY-48.23, HY-48.25,
// HY-132.2).
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { dryRun } from './make-dry-run.mts';
import { NODE_ADDON, phpServerExtensions, requireBuilt } from './requires.mts';
import { NAMES, ROOT } from './session-workers.mts';

interface Result { server: string; processes: number; requests: number; requestsPerSecond: number }

function requireInputs(): void {
  requireBuilt('hyper-install-redis', 'var/redis/redis-server', 'var/redis/redis.so');
  requireBuilt('packages', 'packages/ts/dist/index.js');
  requireBuilt('node-addon', NODE_ADDON);
  requireBuilt('hyper-install-python', 'packages/python/.venv/bin/python');
  requireBuilt('hyper-install-php', 'vendor/autoload.php');
}

test('the benchmark of the Redis sessions counts the requests of each server', { timeout: 120_000 }, async () => {
  requireInputs();
  const extensions = phpServerExtensions().flatMap((file) => ['--extension', file]);
  const { stdout } = await promisify(execFile)(process.execPath, ['benchmarks/sessions.mts', '--requests', '5', '--json', ...extensions], { cwd: ROOT });
  const results: unknown = JSON.parse(stdout);
  assert.ok(Array.isArray(results));
  assert.deepEqual(results.map(({ server, processes, requests }: Result) => [server, processes, requests]), NAMES.flatMap((name) => [[name, 1, 5], [name, 4, 20]]));
  for (const { requestsPerSecond } of results as Iterable<Result>) assert.ok(requestsPerSecond > 0);
});

test('the benchmark of the Redis sessions measures nothing when its PHP does not load the three extensions', { timeout: 120_000 }, async () => {
  requireInputs();
  const hyper = phpServerExtensions().at(-1) ?? '';
  for (const extensions of [[], ['--extension', hyper]]) {
    await assert.rejects(
      promisify(execFile)(process.execPath, ['benchmarks/sessions.mts', '--requests', '5', '--json', ...extensions], { cwd: ROOT }),
      (error: { code?: unknown; stdout?: unknown; stderr?: unknown }) => {
        assert.equal(error.code, 1);
        assert.equal(error.stdout, '', 'no result is printed');
        assert.match(String(error.stderr), /PHP did not load polyspec_json, polyspec_template/);
        return true;
      },
    );
  }
});

test('make bench-sessions passes the PHP extensions of a server in their order to the benchmark', () => {
  const lines = dryRun('bench-sessions').filter((line) => line.includes('benchmarks/sessions.mts'));
  assert.equal(lines.length, 1, lines.join('\n'));
  const words = (lines[0] ?? '').split(' ');
  const libraries = words.flatMap((word, index) => (word === '--extension' ? [words[index + 1] ?? ''] : []));
  // The linked template library is libpolyspec_template of a cargo build; the others are the libraries of PIE and of hyper-ext.
  // PHP loads polyspec_session_store beside json and template, before polyspec_hyper (HY-48.25).
  assert.deepEqual(libraries.map((file) => file.slice(file.lastIndexOf('/') + 1).replace(/^lib/, '').replace(/\..*$/, '')), ['polyspec_json', 'polyspec_template', 'polyspec_session_store', 'polyspec_hyper']);
});
