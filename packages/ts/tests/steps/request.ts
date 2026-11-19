// The steps of contracts/request.json: the text that a host gives a request (HY-42.7), the files of a request
// (HY-113.2), the path and the query of a request target (HY-42, HY-56) and the values that a request gives.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Cookies } from '../../src/http/cookies.js';
import { Request, UploadedFile } from '../../src/index.js';
import type { CaseReader } from '../case-reader.js';
import { failureOf, raisesOf } from '../case-rules.js';
import { listOf, textOf } from '../inputs.js';
import { bytesOf } from '../support.js';

// Returns a member of the request of a case that is a string, or the default for a case without it.
function textIn(request: Map<unknown, unknown>, name: string, fallback: string | null): string {
  const value: unknown = request.has(name) ? request.get(name) : fallback;
  if (typeof value !== 'string') throw new Error(`the case field request.${name} is not a string`);
  return value;
}

// Returns a map of names to texts of a case as a record, and fails for any other value.
function textsIn(value: unknown, what: string): Record<string, string> {
  if (!(value instanceof Map)) throw new Error(`${what} is not a map`);
  const texts: Record<string, string> = {};
  for (const [name, item] of value) {
    if (typeof name !== 'string' || typeof item !== 'string') throw new Error(`${what} holds a value that is not a string`);
    texts[name] = item;
  }
  return texts;
}

// Returns a list of strings of a case, and fails for any other value.
function namesIn(reader: CaseReader, field: string): string[] {
  const value = reader.input(field);
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) throw new Error(`the case field ${field} is not a list of strings`);
  return value;
}

// Returns the pairs of a field of a case, each a name and one more value, and fails for any other value.
function pairsIn(reader: CaseReader, field: string): [string, unknown][] {
  const value = reader.input(field);
  if (!Array.isArray(value)) throw new Error(`the case field ${field} is not a list`);
  return value.map((pair: unknown): [string, unknown] => {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string') throw new Error(`an item of the case field ${field} is not a name and a value`);
    return [pair[0], pair[1]];
  });
}

// Builds the request of a case as a host does: the path and the query of its target, its headers as they are, its body
// as bytes, and the cookies of the one parse of its Cookie header (HY-129.13) or the cookie map that the case states.
function requestOfCase(reader: CaseReader): Request {
  const stated = reader.input('request');
  if (!(stated instanceof Map)) throw new Error('the case field request is not a map');
  const target = textIn(stated, 'target', null);
  const headers = stated.has('headers') ? textsIn(stated.get('headers'), 'the case field request.headers') : {};
  const header = Object.entries(headers).find(([name]) => name.toLowerCase() === 'cookie')?.[1] ?? null;
  const cookies = stated.has('cookies') ? new Map(Object.entries(textsIn(stated.get('cookies'), 'the case field request.cookies'))) : Cookies.parse(header === null ? [] : [header]);
  let request = new Request({
    method: textIn(stated, 'method', 'GET'),
    path: Request.targetPath(target),
    query: Request.targetQuery(target),
    headers,
    body: bytesOf(textIn(stated, 'body', '')),
    cookies,
    https: stated.has('https') && stated.get('https') === true,
  });
  if (stated.has('selection')) request = request.withSelection(stated.get('selection'));
  if (stated.has('media')) request = request.withMedia(textIn(stated, 'media', null));
  return request;
}

// Returns the answer of a question about the selected media type of a request, or the text `caller error` when the
// request holds none and the question fails with the logic error of HY-116.21, an error of exactly the class Error.
function kindOf(ask: () => boolean): boolean | string {
  try {
    return ask();
  } catch (error) {
    if (!(error instanceof Error) || error.constructor !== Error || !error.message.includes('the request holds no selected media type')) throw error;
    return 'caller error';
  }
}

// Returns the kind and the category of the failure of an awaited call, without the status and the message that the case
// does not state, or null when the call does not fail.
async function failureKindOf(call: () => Promise<unknown>): Promise<{ kind: unknown; category: unknown } | null> {
  try {
    await call();
    return null;
  } catch (error) {
    const raises = raisesOf(error);
    return { kind: raises.kind, category: raises.category };
  }
}

export const steps = {
  // Compares the path and the raw query that the request gives for a request target.
  targets(reader: CaseReader): void {
    const target = reader.input('target');
    if (typeof target !== 'string') throw new Error('the case field target is not a string');
    reader.compare('path', Request.targetPath(target));
    reader.compare('query', Request.targetQuery(target));
  },
  // Builds the request of the case, copies it with the headers of `with`, and compares the stated members of the copy
  // and the headers of the original.
  values(reader: CaseReader): void {
    const original = requestOfCase(reader);
    let read = original;
    if (reader.has('with')) {
      for (const [name, value] of pairsIn(reader, 'with')) {
        if (typeof value !== 'string') throw new Error('a header value of the case field with is not a string');
        read = read.withHeader(name, value);
      }
    }
    // A member that fails ends the comparison, and the failure is compared with `raises`.
    reader.compare('raises', failureOf(() => members(reader, read, original)).raises);
  },
  // Creates a request of the texts of the case and records the error of its creation, or null.
  texts(reader: CaseReader): void {
    let failure: unknown = null;
    try {
      new Request({
        method: 'GET',
        path: textOf(reader.input('path'), 'path'),
        query: textOf(reader.input('query'), 'query'),
        headers: textsIn(reader.input('headers'), 'headers'),
      });
    } catch (error) {
      failure = error;
    }
    reader.outcome('request', failure);
  },
  // Makes the file of the case with the constructor and compares its members, then moves it when the case names a move
  // and compares the failure of the move, the bytes at the path, and the failures of content() and of a second move
  // after it (HY-113.8, HY-131.28, HY-131.34).
  async uploads(reader: CaseReader): Promise<void> {
    const given = reader.input('file');
    if (!(given instanceof Map)) throw new Error('the case field file is not a map');
    const file = new UploadedFile(textIn(given, 'name', null), textIn(given, 'filename', null), textIn(given, 'contentType', null), bytesOf(textIn(given, 'content', null)));
    reader.compare('name', file.name());
    reader.compare('contentType', file.contentType());
    reader.compare('size', file.size());
    reader.compare('content', Buffer.from(await file.content()).toString('latin1'));
    if (!reader.has('move')) return;
    const directory = mkdtempSync(join(tmpdir(), 'hyper-uploads-'));
    try {
      const path = join(directory, 'moved');
      const move = textOf(reader.input('move'), 'the case field move');
      if (move === 'existing') writeFileSync(path, 'old bytes');
      else if (move !== 'new') throw new Error('the move of the case is neither new nor existing');
      let raises = null;
      try {
        await file.moveTo(path);
      } catch (error) {
        raises = raisesOf(error);
      }
      reader.compare('raises', raises);
      if (raises !== null) return;
      reader.compare('moved', readFileSync(path).toString('latin1'));
      reader.compare('after', await failureKindOf(() => file.content()));
      reader.compare('again', await failureKindOf(() => file.moveTo(join(directory, 'again'))));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
  // Reads the body of the case as a request and records the last file of each name and the pairs of the files.
  files(reader: CaseReader): void {
    const request = new Request({ method: 'POST', path: '/', headers: { 'Content-Type': bytesOf(textOf(reader.input('type'), 'type')).toString('latin1') }, body: bytesOf(textOf(reader.input('body'), 'body')) });
    // `names` is optional: a case of a failing limit states no files (HY-114.12).
    if (reader.has('names')) reader.compare('last', namesIn(reader, 'names').map((name) => request.file(name)?.filename() ?? null));
    reader.compare('pairs', request.files().map(([name, files]) => [name, files.map((file) => file.filename())]));
    if (reader.has('limits')) {
      const limits = listOf(reader.input('limits'), 'the case field limits').map((limit) => {
        if (typeof limit !== 'number' || !Number.isInteger(limit)) throw new Error('a limit of the case is not an integer');
        return limit;
      });
      const outcome = failureOf(() => limits.map((limit) => request.fileOver(limit)));
      reader.compare('over', outcome.result);
      reader.compare('raises', outcome.raises);
    }
  },
};

// Compares the stated members of the copy of the request and the headers of the original.
function members(reader: CaseReader, read: Request, original: Request): void {
  reader.compare('method', read.method);
  reader.compare('path', read.path());
  reader.compare('rawQuery', read.rawQuery());
  reader.compare('query', read.query());
  if (reader.has('queryInt')) {
    reader.compare('queryInt', pairsIn(reader, 'integers').map(([name, fallback]) => {
      if (typeof fallback !== 'number') throw new Error('a default of the case field integers is not a number');
      return read.queryInt(name, fallback);
    }));
  }
  reader.compare('form', read.form());
  if (reader.has('formString')) reader.compare('formString', namesIn(reader, 'formNames').map((name) => read.formString(name)));
  if (reader.has('cookie')) reader.compare('cookie', namesIn(reader, 'cookieNames').map((name) => read.cookie(name)));
  const headerNames = reader.has('header') || reader.has('original.header') ? namesIn(reader, 'headerNames') : [];
  if (reader.has('header')) reader.compare('header', headerNames.map((name) => read.header(name)));
  reader.compare('https', read.https);
  reader.compare('selection', read.selection());
  reader.compare('valid', read.validInput());
  reader.compare('bodySize', read.bodySize());
  reader.compare('currentPath', read.currentPath());
  reader.compare('mediaType', read.mediaType());
  if (reader.has('wantsJson')) reader.compare('wantsJson', kindOf(() => read.wantsJson()));
  if (reader.has('isRegionRequest')) reader.compare('isRegionRequest', kindOf(() => read.isRegionRequest()));
  if (reader.has('original.header')) reader.compare('original.header', headerNames.map((name) => original.header(name)));
}
