// The steps of contracts/build.json (HY-125): the build id that a `build.json` file gives.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Build } from '../../src/build.js';
import { InvalidBuild } from '../../src/invalid-build.js';
import type { CaseReader } from '../case-reader.js';

export const steps = {
  read(reader: CaseReader): void {
    const directory = mkdtempSync(join(tmpdir(), 'hyper-cli-'));
    const file = join(directory, 'build.json');
    try {
      // A null `text` is a missing file, unless `bytes` gives the bytes of the file as hexadecimal digits.
      const text = reader.input('text');
      if (typeof text === 'string') writeFileSync(file, text);
      else if (text !== null) throw new Error('the case field text is neither a string nor null');
      else if (reader.has('bytes')) {
        const bytes = reader.input('bytes');
        if (typeof bytes !== 'string' || !/^(?:[0-9a-f]{2})*$/u.test(bytes)) throw new Error('the case field bytes is not hexadecimal digits');
        writeFileSync(file, Buffer.from(bytes, 'hex'));
      }
      let build: string | null = null;
      let error: string | null = null;
      let message: string | null = null;
      try {
        build = Build.read(file);
      } catch (failure) {
        if (!(failure instanceof InvalidBuild)) throw failure;
        error = failure.message.includes(file) ? 'invalid-build' : failure.message;
        message = failure.message;
      }
      reader.compare('build', build);
      reader.compare('error', error);
      reader.compare('message', message);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
};
