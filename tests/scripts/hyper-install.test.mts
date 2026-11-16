// Tests the steps of `make hyper-install` (H35.1): it writes the generated
// sources of the bindings before it installs the PHP and Python packages, since the Python package builds its native
// module from packages/python/native/generated, which only `make bindings` writes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dryRun } from './make-dry-run.mts';

const steps = dryRun('hyper-install')
  .map((line) => /--no-print-directory (\S+)/u.exec(line)?.[1])
  .filter((step) => step !== undefined);

test('hyper-install writes the sources of the bindings before it installs the PHP and Python packages (H35.1)', () => {
  const at = (step: string) => {
    const index = steps.indexOf(step);
    assert.ok(index >= 0, `hyper-install runs ${step}: ${steps.join(' ')}`);
    return index;
  };
  assert.ok(at('bindings') < at('hyper-install-php'), `bindings runs before hyper-install-php: ${steps.join(' ')}`);
  assert.ok(at('bindings') < at('hyper-install-python'), `bindings runs before hyper-install-python: ${steps.join(' ')}`);
});

test('hyper-install-python builds the native module with maturin of the link script and uv sync does not build it (H35.24)', () => {
  const lines = dryRun('hyper-install-python').join('\n');
  assert.match(lines, /UV_SYNC='[^']*--no-install-project[^']*'/u, lines);
  assert.match(lines, /MATURIN=\S+ \S+ \S+\/link\.m[jt]s maturin \S+\/packages\/python build --locked --offline/u, lines);
  assert.match(lines, /pip install --offline --python \S+\/packages\/python\/\.venv\/bin\/python --no-deps --reinstall/u, lines);
});

