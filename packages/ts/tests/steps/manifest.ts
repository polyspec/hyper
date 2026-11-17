// The steps of contracts/manifest.json (HY-1, HY-2, HY-37, HY-54): the manifests that the server reads or rejects. The
// Node server has no manifest unit, so the step opens an application whose program does not exist: the core judges
// the manifest before the server reads the program, so an open that fails for the program has read the manifest.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from '../../src/index.js';
import type { CaseReader } from '../case-reader.js';
import { raisesOf } from '../case-rules.js';
import { plain } from '../inputs.js';

// Returns the bytes of the manifest file of a case: the JSON text of `manifest`, the UTF-8 bytes of `text`, or the
// bytes of the hexadecimal digits of `bytes`.
function fileOf(reader: CaseReader): string | Buffer {
  if (reader.has('manifest')) return JSON.stringify(plain(reader.input('manifest')));
  if (reader.has('text')) {
    const text = reader.input('text');
    if (typeof text !== 'string') throw new Error('the case field text is not a string');
    return Buffer.from(text, 'utf8');
  }
  const bytes = reader.input('bytes');
  if (typeof bytes !== 'string' || !/^(?:[0-9a-f]{2})*$/u.test(bytes)) throw new Error('the case field bytes is not hexadecimal digits');
  return Buffer.from(bytes, 'hex');
}

export const steps = {
  async checks(reader: CaseReader): Promise<void> {
    const directory = mkdtempSync(join(tmpdir(), 'hyper-manifest-'));
    try {
      const manifest = join(directory, 'manifest.json');
      // The program does not exist: an open that fails only for it has read the manifest (HY-2.7).
      const program = join(directory, 'absent');
      writeFileSync(manifest, fileOf(reader));
      let failure: unknown;
      try {
        await App.open({ manifest, program, handlers: {}, timezone: 'Z', log: () => {} });
      } catch (error) {
        failure = error;
      }
      if (failure === undefined) throw new Error('the application opened without a program');
      const read = failure instanceof Error && failure.message.startsWith(`${join(program, 'reads.json')} of the server program`);
      reader.compare('read', read ? true : null);
      reader.compare('raises', read ? null : raisesOf(failure));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
};
