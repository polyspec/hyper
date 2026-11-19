// The Python case runner of the recipe check runs the venv of the Python server package. The venv is made only by
// hyper-install-python, so recipe-check must depend on that target: otherwise the runner cannot start, and every Python
// case reports RESULT_MISSING (H35.43 Python venv).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dryRun } from './make-dry-run.mts';

test('recipe-check makes the Python venv first, so the Python case runner can start (H35.43)', () => {
  const lines = dryRun('recipe-check');
  assert.ok(
    lines.some((line) => line.includes('python-venv.') && line.includes('.venv')),
    'make -n recipe-check prints no line that makes packages/python/.venv: the Python runner would start a missing interpreter',
  );
});
