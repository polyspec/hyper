// The tracked Git hooks of the repository. Every make run sets core.hooksPath to HOOKS_PATH (Makefile); the push gate
// (`node scripts/push-gate.mjs hooks-check`, `make hooks-check`) and the guard of the full run (scripts/full-run.mjs)
// fail while the hooks are not installed.
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import path from 'node:path';

export const HOOKS_PATH = '.githooks';
export const PRE_PUSH = `${HOOKS_PATH}/pre-push`;

/** Why the pre-push hook of the checkout `root` does not run on a push, or null when it is installed. */
export function hooksProblem(root) {
  const config = spawnSync('git', ['config', 'core.hooksPath'], { cwd: root, encoding: 'utf8' });
  if (config.error) throw config.error;
  // git config exits with 1 when the key is not set.
  const value = config.status === 0 ? config.stdout.trim() : '';
  if (value !== HOOKS_PATH) {
    return `the pre-push hook is not installed: core.hooksPath is ${value ? `'${value}'` : 'not set'}, not ${HOOKS_PATH}; run make hooks`;
  }
  const hook = path.join(root, PRE_PUSH);
  if (!existsSync(hook)) return `${PRE_PUSH} is missing; restore it with git checkout -- ${PRE_PUSH}`;
  try {
    accessSync(hook, constants.X_OK);
  } catch {
    return `${PRE_PUSH} is not executable; restore it with git checkout -- ${PRE_PUSH}`;
  }
  return null;
}
