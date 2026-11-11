// The steps of contracts/build.json (HY-125): the build id that a `build.json` file gives.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Build } from '../../src/build.js';
import { InvalidBuild } from '../../src/invalid-build.js';
import type { CaseReader } from '../case-reader.js';

export const steps = {
  read(reader: CaseReader): void {
    const directory = mkdtempSync(join(tmpdir(), 'hyper-build-'));
    const file = join(directory, 'build.json');
    try {
      const text = reader.input('text');
      if (typeof text === 'string') writeFileSync(file, text);
      let build: string | null = null;
      let error: string | null = null;
      try {
        build = Build.read(file);
      } catch (failure) {
        if (!(failure instanceof InvalidBuild)) throw failure;
        error = failure.message.includes(file) ? 'invalid-build' : failure.message;
      }
      reader.compare('build', build);
      reader.compare('error', error);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
};
