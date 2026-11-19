// The urlencoded, multipart and streamed steps of fields.json and the multipart step of forms.json of the http-form
// release that config/release-files.json pins (HY-56, HY-57, HY-113, HY-131; H35.11). A body and a text are
// `{"hex": …}`, the limits are the record `limits`, and a failure is `raises` with its kind, its status, its category
// and its message. Each step reads through the functions that the server calls: the core reads every body.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rules, type BodyLimits, type CoreForm, type CoreRequestBody } from '../../src/app/core-rules.js';
import { Fields } from '../../src/form/fields.js';
import { UploadedFile } from '../../src/form/uploaded-file.js';
import type { CaseReader } from '../case-reader.js';

const UNBOUNDED: BodyLimits = { limit: Number.MAX_SAFE_INTEGER, valueLimit: Number.MAX_SAFE_INTEGER, partLimit: Number.MAX_SAFE_INTEGER, fileLimit: Number.MAX_SAFE_INTEGER };

function text(reader: CaseReader, name: string): string {
  const value = reader.input(name);
  if (typeof value !== 'string') throw new Error(`the case field ${name} is not a string`);
  return value;
}

// The bytes of a field `{"hex": …}` of the case.
function bytes(reader: CaseReader, name: string): Uint8Array {
  const value = reader.input(name);
  const hex = typeof value === 'object' && value !== null && 'hex' in value ? value.hex : undefined;
  if (typeof hex !== 'string' || !/^(?:[0-9a-f]{2})*$/.test(hex)) throw new Error(`the case field ${name} is no {"hex": …}`);
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

// The record `limits` of the case as the core takes it.
function limitsOf(reader: CaseReader): BodyLimits {
  const value = reader.input('limits');
  const read = (name: string): number => {
    const limit: unknown = typeof value === 'object' && value !== null ? Reflect.get(value, name) : undefined;
    if (typeof limit !== 'number') throw new Error(`the limit ${name} of the case is not a number`);
    return limit;
  };
  return { limit: read('limit'), valueLimit: read('value_limit'), partLimit: read('part_limit'), fileLimit: read('file_limit') };
}

// The failure of the core as the field `raises` states it, or a rejection of any other error.
function raised(error: unknown): { kind: string; status: number | null; category: string; message: string } {
  if (!(error instanceof Error) || !('kind' in error) || typeof error.kind !== 'string') throw error;
  const status = 'status' in error && typeof error.status === 'number' ? error.status : null;
  const category = 'category' in error && typeof error.category === 'string' ? error.category : error instanceof TypeError ? 'type' : 'value';
  return { kind: error.kind, status, category, message: error.message };
}

function fileRows(form: CoreForm, size: boolean): Promise<unknown>[] {
  return form.files.flatMap(([, list]) => list.map((core) => UploadedFile.ofCore(core))).map(async (file) => ({
    name: file.name(),
    filename: file.filename(),
    contentType: file.contentType(),
    content: Buffer.from(await file.content()).toString('latin1'),
    ...(size ? { size: file.size() } : {}),
  }));
}

// Reads the form of the body held as one value and compares its fields and files, or its failure (HY-57, HY-113).
async function held(reader: CaseReader): Promise<void> {
  let form: CoreForm;
  try {
    form = rules().formReadHeld(text(reader, 'content_type'), bytes(reader, 'body'), UNBOUNDED);
  } catch (error) {
    reader.compare('raises', raised(error));
    return;
  }
  reader.compare('fields', form.fields);
  reader.compare('files', await Promise.all(fileRows(form, false)));
}

export const fieldsSteps = {
  // Parses the text and records its pairs and its names, or its failure (HY-42, HY-56).
  urlencoded(reader: CaseReader): void {
    let fields: Fields;
    try {
      fields = Fields.of(rules().formParseUrlencoded(bytes(reader, 'text')));
    } catch (error) {
      reader.compare('raises', raised(error));
      return;
    }
    reader.compare('fields', fields.pairs());
    reader.compare('names', fields.names());
  },
  multipart: held,
  // Reads the body in chunks as the host does, and records what the body holds, its parts, the files of its directory,
  // the move of its first file and the removal of the directory (HY-131).
  async streamed(reader: CaseReader): Promise<void> {
    const body = bytes(reader, 'body');
    const chunk = reader.input('chunk');
    const move = text(reader, 'move');
    if (typeof chunk !== 'number') throw new Error('the chunk of the case is not a number');
    const read: CoreRequestBody = await rules().formStart(text(reader, 'content_type'), null, reader.input('stream') === true, limitsOf(reader));
    const scratch = mkdtempSync(join(tmpdir(), 'hyper-case-'));
    try {
      let failure: unknown = null;
      for (let at = 0; at < body.length && failure === null; at += chunk) {
        await read.feed(body.subarray(at, at + chunk)).catch((error: unknown) => {
          failure = error;
        });
      }
      const stopped = failure !== null;
      if (!stopped) await read.finish().catch((error: unknown) => {
        failure = error;
      });
      if (failure !== null) reader.compare('raises', raised(failure));
      const kind = failure === null ? null : raised(failure).kind;
      const heldBytes = Buffer.from(read.held());
      let form: CoreForm | null = null;
      if (failure === null) {
        try {
          form = read.streamed() ? read.parts() : rules().formReadHeld(text(reader, 'content_type'), heldBytes, UNBOUNDED);
        } catch (error) {
          reader.compare('raises', raised(error));
        }
      }
      const directory = read.directory();
      const count = (): number | null => (directory === null ? null : readdirSync(directory).length);
      reader.compare('stopped', stopped);
      reader.compare('exceeded', kind !== null && ['body_limit', 'value_limit', 'part_limit', 'file_limit'].includes(kind));
      reader.compare('held', heldBytes.toString('latin1'));
      reader.compare('fields', form?.fields ?? null);
      reader.compare('files', form === null ? null : await Promise.all(fileRows(form, true)));
      reader.compare('entries', count());
      const firstCore = form?.files[0]?.[1][0];
      if (move === 'none' || firstCore === undefined) {
        reader.compare('moved', null);
      } else {
        const first = UploadedFile.ofCore(firstCore);
        const target = join(scratch, 'target');
        if (move === 'exists') writeFileSync(target, 'taken');
        const attempt = async (work: () => Promise<unknown>): Promise<[string, string] | null> => {
          try {
            await work();
            return null;
          } catch (error) {
            if (error instanceof TypeError) return [error.message, 'type'];
            if (error instanceof RangeError) return [error.message, 'value'];
            throw error;
          }
        };
        // @ts-expect-error -- a caller may pass a path of any type
        let failed = await attempt(() => first.moveTo(move === 'type' ? 7 : target));
        let content: string;
        let after: string | null = null;
        if (failed === null) {
          content = readFileSync(target).toString('latin1');
          failed = await attempt(() => first.moveTo(join(scratch, 'second')));
          after = (await attempt(() => first.content()))?.[0] ?? null;
        } else {
          content = Buffer.from(await first.content()).toString('latin1');
        }
        reader.compare('moved', { content, left: count(), again: failed?.[0] ?? null, read: after, class: failed?.[1] ?? null });
      }
      await read.remove();
      reader.compare('removed', directory === null ? null : !existsSync(directory));
    } finally {
      await read.remove();
      rmSync(scratch, { recursive: true, force: true });
    }
  },
};

export const formsSteps = {
  multipart: held,
};
