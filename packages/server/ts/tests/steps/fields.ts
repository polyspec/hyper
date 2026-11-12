// The urlencoded, multipart and uploaded steps of contracts/fields.json (HY-56, HY-57, HY-106.5, HY-113): a urlencoded
// text is the UTF-8 encoding of its JSON string, and a multipart type and body are text whose characters are their bytes.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Fields } from '../../src/fields.js';
import { Files } from '../../src/files.js';
import { Multipart } from '../../src/multipart.js';
import { RequestBody } from '../../src/request-body.js';
import { UploadedFile } from '../../src/uploaded-file.js';
import type { CaseReader } from '../case-reader.js';
import { bytesOf } from '../support.js';

function text(reader: CaseReader, name: string): string {
  const value = reader.input(name);
  if (typeof value !== 'string') throw new Error(`the case field ${name} is not a string`);
  return value;
}

function fieldsOf(fields: Fields | null): unknown {
  return fields?.pairs() ?? null;
}

function filesOf(files: Files | null): unknown {
  if (files === null) return null;
  return files.pairs().flatMap(([, list]) =>
    list.map((file) => ({ name: file.name(), filename: file.filename(), contentType: file.contentType(), content: Buffer.from(file.content()).toString('latin1') })),
  );
}

export const steps = {
  // Makes a file with the public constructor, as an application makes one, and compares its members (HY-106.5).
  uploaded(reader: CaseReader): void {
    const file = new UploadedFile(text(reader, 'name'), text(reader, 'filename'), text(reader, 'contentType'), bytesOf(text(reader, 'content')));
    reader.compare('file', { name: file.name(), filename: file.filename(), contentType: file.contentType(), size: file.size(), content: Buffer.from(file.content()).toString('latin1') });
  },
  // Parses the text and records its pairs and its names, or null for both when it fails with HY-42 (HY-56).
  urlencoded(reader: CaseReader): void {
    const fields = Fields.parse(Buffer.from(text(reader, 'text'), 'utf8'));
    reader.compare('fields', fields?.pairs() ?? null);
    reader.compare('names', fields?.names() ?? null);
  },
  // Reads the form values and the files of the body, or null for each when the body fails with HY-42 (HY-57, HY-113).
  multipart(reader: CaseReader): void {
    const type = bytesOf(text(reader, 'type')).toString('latin1');
    const body = bytesOf(text(reader, 'body'));
    const whole = [fieldsOf(Fields.fromBody(type, body)), filesOf(Files.fromBody(type, body))];
    // HY-131.6: the body read in two chunks, divided at every position, gives the result of the whole body, and the
    // reader holds between two chunks at most its bound; the first division that differs is the result of the case.
    const boundary = Multipart.boundary(type);
    let result = whole;
    if (boundary !== null) {
      const bound = Math.max(8192 + 3, boundary.length + 3);
      for (let at = 0; at <= body.length && result === whole; at += 1) {
        const parts = new Multipart(boundary, null, null, null, null);
        for (const chunk of [body.subarray(0, at), body.subarray(at)]) {
          parts.feed(chunk);
          if (parts.buffered() > bound) throw new Error(`the reader holds ${parts.buffered()} bytes after a chunk that ends at ${at}; its bound is ${bound}`);
        }
        const read = parts.result();
        const divided = [fieldsOf(read?.[0] ?? null), filesOf(read?.[1] ?? null)];
        if (JSON.stringify(divided) !== JSON.stringify(whole)) result = divided;
      }
    }
    reader.compare('fields', result[0]);
    reader.compare('files', result[1]);
  },
  // Reads the body in chunks as a host does, and records what the body holds, its parts, the files of its directory,
  // the move of its first file and the removal of the directory (HY-131).
  async streamed(reader: CaseReader): Promise<void> {
    const type = text(reader, 'type');
    const body = bytesOf(text(reader, 'body'));
    const chunk = reader.input('chunk');
    const limit = reader.input('limit');
    const move = text(reader, 'move');
    if (typeof chunk !== 'number' || typeof limit !== 'number') throw new Error('the chunk or the limit of the case is not a number');
    const limits = [reader.input('valueLimit'), reader.input('partLimit'), reader.input('fileLimit')];
    const [valueLimit, partLimit, fileLimit] = limits;
    if (typeof valueLimit !== 'number' || typeof partLimit !== 'number' || typeof fileLimit !== 'number') throw new Error('a limit of the case is not a number');
    const read = new RequestBody(type, limit, reader.input('stream') === true, valueLimit, partLimit, fileLimit);
    const scratch = mkdtempSync(join(tmpdir(), 'hyper-case-'));
    try {
      let stopped = false;
      for (let at = 0; at < body.length && !stopped; at += chunk) {
        stopped = !read.feed(body.subarray(at, at + chunk));
        await read.written();
      }
      const held = Buffer.from(read.held());
      const parts = read.streamed() ? read.parts() : null;
      const fields = read.streamed() ? (parts?.[0] ?? null) : stopped ? null : Fields.fromBody(type, held);
      const files = read.streamed() ? (parts?.[1] ?? null) : stopped ? null : Files.fromBody(type, held);
      const directory = read.directory();
      const count = (): number | null => (directory === null ? null : readdirSync(directory).length);
      reader.compare('stopped', stopped);
      reader.compare('exceeded', read.exceeded());
      reader.compare('held', held.toString('latin1'));
      reader.compare('fields', fieldsOf(fields));
      reader.compare('files', files === null ? null : files.pairs().flatMap(([, list]) => list.map((file) => ({ name: file.name(), filename: file.filename(), contentType: file.contentType(), content: Buffer.from(file.content()).toString('latin1'), size: file.size() }))));
      reader.compare('entries', count());
      const first = files?.pairs()[0]?.[1][0];
      if (move === 'none' || first === undefined) {
        reader.compare('moved', null);
      } else {
        const target = join(scratch, 'target');
        if (move === 'exists') writeFileSync(target, 'taken');
        const failure = (work: () => void): [string, string] | null => {
          try {
            work();
            return null;
          } catch (error) {
            if (error instanceof TypeError) return [error.message, 'type'];
            if (error instanceof RangeError) return [error.message, 'value'];
            throw error;
          }
        };
        // @ts-expect-error -- a caller may pass a path of any type
        let failed = failure(() => first.moveTo(move === 'type' ? 7 : target));
        let content: string;
        let after: string | null = null;
        if (failed === null) {
          content = readFileSync(target).toString('latin1');
          failed = failure(() => first.moveTo(join(scratch, 'second')));
          after = failure(() => first.content())?.[0] ?? null;
        } else {
          content = Buffer.from(first.content()).toString('latin1');
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
