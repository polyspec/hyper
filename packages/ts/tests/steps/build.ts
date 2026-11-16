// The steps of contracts/build.json (HY-125): the build id that a `build.json` file gives.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Build } from '../../src/app/build.js';
import type { CaseReader } from '../case-reader.js';
import { failureOf } from '../case-rules.js';

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
      const outcome = failureOf(() => Build.read(file));
      reader.compare('build', outcome.result);
      reader.compare('raises', outcome.raises);
      reader.compare('message', outcome.raises?.message ?? null);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
};
