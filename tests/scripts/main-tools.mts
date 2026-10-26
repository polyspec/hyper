// HR-81: native installs of worktrees reuse the tools of their main checkout.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** The declared checkout tools, discovered through Git's common directory rather than a sibling path. */
export function mainTools(root = resolve('.')): string {
  const result = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `git rev-parse --git-common-dir in ${root}: ${result.stderr}`);
  return join(realpathSync(dirname(result.stdout.trim())), 'var/tools');
}
