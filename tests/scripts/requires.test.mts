// requireBuilt names the target that writes a missing input and says that it runs before the test, because no check
// target runs an install target (HR-85, HR-89).
import assert from 'node:assert/strict';
import test from 'node:test';

import { requireBuilt } from './requires.mts';

test('a missing input names the target that writes it and asks for it before the tests', () => {
  assert.throws(
    () => requireBuilt('hyper-install-python', 'var/no-such-input'),
    // The first line is the message; node appends the difference of the values after it.
    {
      message:
        /^var\/no-such-input is missing; `make hyper-install-python` writes it; run it before `make hyper-test-scripts`$/m,
    },
  );
});
