// The fixture and the run of `hyper build` that the tests of the command tool share (HR-85): a copy of the tracked files of a
// fixture in a temporary directory that the test removes, and one run of the bin with its output below that copy.
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { copyTracked } from '../../scripts/tracked-files.mts';

const bin = resolve('packages/cli/bin/hyper.mjs');

/** A copy of the tracked files of tests/scripts/fixtures/<name>, removed after the test. */
export function fixture(name: string, t: { after: (fn: () => void) => void }): string {
  const app = mkdtempSync(join(tmpdir(), `hyper-build-${name}-`));
  t.after(() => rmSync(app, { recursive: true, force: true }));
  copyTracked({ repository: resolve('.'), path: `tests/scripts/fixtures/${name}`, target: app, base: `tests/scripts/fixtures/${name}` });
  return app;
}

/** One run of `hyper build --app <app> --output <app>/out` with the options. */
export function runBuild(app: string, ...options: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [bin, 'build', '--app', app, '--output', join(app, 'out'), ...options], { encoding: 'utf8' });
}
