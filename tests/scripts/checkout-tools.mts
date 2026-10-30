// HR-81: every checkout, a linked worktree too, runs and installs the tools of its own var/tools (kit K858).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** The declared tools of the checkout of `root`, the var/tools of its top-level folder. */
export function checkoutTools(root = resolve('.')): string {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `git rev-parse --show-toplevel in ${root}: ${result.stderr}`);
  return join(realpathSync(result.stdout.trim()), 'var/tools');
}
