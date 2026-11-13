// The steps of contracts/manifest.json (HY-1, HY-2, HY-37, HY-54): the manifests that the server reads or rejects. The
// Node server has no manifest unit (HY-54.3), so the step opens an application whose template index does not exist: an
// open that reaches the index has read the manifest.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from '../../src/index.js';
import type { CaseReader } from '../case-reader.js';
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
      const build = join(directory, 'build.json');
      const index = join(directory, 'absent', 'templates.index.json');
      writeFileSync(manifest, fileOf(reader));
      writeFileSync(build, `{"build":"${'1'.repeat(64)}"}`);
      let failure: unknown;
      try {
        await App.open({ manifest, build, templates: { index, root: join(directory, 'absent') }, handlers: {}, timezone: 'Z', log: () => {} });
      } catch (error) {
        failure = error;
      }
      if (failure === undefined) throw new Error('the open read a template index that does not exist');
      // The missing template index is read after the manifest, so its system error tells that the manifest was read.
      const read = failure instanceof Error && 'code' in failure && failure.code === 'ENOENT' && failure.message.includes(index);
      reader.compare('rejected', read ? null : failure);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
};
