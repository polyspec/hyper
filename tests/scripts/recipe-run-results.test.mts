// The recipe check reads only the case results that its own run wrote (H35.144, HR-82). Each run writes its results into a
// directory of its own run id, so a file of an earlier run in another directory is never read as this run's result. A
// runner that wrote no file in this run fails the check with "runner did not run" and not with RESULT_MISSING per case.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { track } from '../../scripts/recipe/mutations.mts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const fixture = path.join(here, 'fixtures', 'recipe');
const check = path.join(repo, 'scripts', 'recipe', 'check.mts');

test('recipe-check reads no results file of an earlier run and names a runner that did not run in this run (H35.144)', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'recipe-run-results-'));
  try {
    cpSync(fixture, root, { recursive: true });
    track(root);
    // The results of an earlier run: node.txt was written before, and this run's node runner wrote nothing.
    const results = path.join(root, 'var', 'recipe', 'results');
    mkdirSync(results, { recursive: true });
    writeFileSync(path.join(results, 'node.txt'), 'CASE stale.json stale FAIL written by an earlier run\n');
    const run = path.join(results, 'this-run');
    mkdirSync(run);
    for (const lang of ['php', 'python', 'browser', 'build']) writeFileSync(path.join(run, `${lang}.txt`), '');

    const result = spawnSync(
      process.execPath,
      // The argument that gave the node runner's file before this change (`--results`) names the stale file, which the
      // check must not read; the current argument names this run's directory.
      [check, '--root', root, '--php-autoload', path.join(root, 'vendor', 'autoload.php'), '--results', `node=${path.join(results, 'node.txt')}`, '--run-dir', run],
      { encoding: 'utf8' },
    );
    const output = result.stdout + result.stderr;
    assert.notEqual(result.status, 0, `the check passed with a runner that did not run:\n${output}`);
    assert.doesNotMatch(output, /stale/u, `the check read the results file of an earlier run:\n${output}`);
    assert.match(output, /RUNNER_NOT_RUN runner did not run: node /u, `no line names the node runner as not run:\n${output}`);
    assert.doesNotMatch(output, /node prints no line/u, `the node runner was reported per case, not as not run:\n${output}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
