// The Python case runner of the recipe check runs the venv of the Python server package. recipe-check runs offline
// (HR-89), so it does not create that venv: hyper-install-python creates it, and recipe-check fails with the advice to
// run that target when the venv is missing (H35.143, which replaces the rule of H35.43).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dryRun } from './make-dry-run.mts';

test('recipe-check does not create the Python venv and names hyper-install-python when it is missing (H35.143)', () => {
  const lines = dryRun('recipe-check');
  assert.ok(
    !lines.some((line) => line.includes('python-venv.')),
    'make -n recipe-check prints the venv creation (python-venv.mjs): recipe-check would install offline, which HR-89 forbids',
  );
  assert.ok(
    !lines.some((line) => line.includes('uv-install.')),
    'make -n recipe-check prints the uv install of the Python package: recipe-check would download offline, which HR-89 forbids',
  );
  assert.ok(
    lines.some((line) => line.includes('run make hyper-install-python')),
    'make -n recipe-check prints no check that names "run make hyper-install-python" for a missing packages/python/.venv',
  );
});
