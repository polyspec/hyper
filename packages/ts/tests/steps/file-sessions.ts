// The steps of contracts/file-sessions.json (HY-45, HY-104): the session files that the requests of a case read and
// write, and the session cookie.
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSessions as LibraryFileSessions } from '@polyspec/session-store';
import { FileSession } from '../../src/session/file-session.js';
import { FileSessions } from '../../src/session/file-sessions.js';
import { RecordSession } from '../../src/session/record-session.js';
import type { CaseReader } from '../case-reader.js';
import { raisesOf } from '../case-rules.js';
import { bytesOf } from '../support.js';
import { textOf } from '../inputs.js';
import { requests } from './session-requests.js';

const PREFIX = 'sess_';

// Returns the name of a session file as a case writes it: the file of the identifier that step n created is `sess_#n`.
function written(name: string, made: readonly (string | null)[]): string {
  const index = name.startsWith(PREFIX) ? made.indexOf(name.slice(PREFIX.length)) : -1;
  return index < 0 ? name : `${PREFIX}#${index}`;
}

// Returns the names of the files of a directory as a case writes them, sorted.
function names(directory: string, made: readonly (string | null)[]): string[] {
  return readdirSync(directory).map((name) => written(name, made)).sort();
}

// Runs the requests of a case on a store of session files and compares the files, the results and the cookies; the
// cases of tests/legacy/file-store-sessions.json run the same way.
export async function sessionFileRequests(reader: CaseReader): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-file-sessions-'));
  try {
    const start = Date.now();
    const files = reader.has('files') ? reader.input('files') : [];
    if (!Array.isArray(files)) throw new Error('the files of the case are not a list');
    const identifiers: string[] = [];
    // The files that the case gives with an age, by name, with the seconds of that age.
    const aged = new Map<string, number>();
    for (const file of files) {
      if (!(file instanceof Map)) throw new Error('a file of the case is not a map');
      const identifier = textOf(file.get('identifier'), 'the identifier of a file');
      const path = join(directory, `${PREFIX}${identifier}`);
      writeFileSync(path, bytesOf(textOf(file.get('bytes'), 'the bytes of a file')), { mode: 0o600 });
      chmodSync(path, 0o600);
      identifiers.push(identifier);
      const age: unknown = file.get('age');
      if (age === undefined) continue;
      if (typeof age !== 'number') throw new Error('the age of a file is not a number');
      const time = new Date(start - age * 1000);
      utimesSync(path, time, time);
      aged.set(`${PREFIX}${identifier}`, age);
    }
    // The constructor of Node takes the store that the library made (HY-104.46).
    const sessions = new FileSessions(await LibraryFileSessions.inDirectory(directory));
    const records: [string, string][][] = [];
    const touched: string[][] = [];
    const outcome = await requests(reader.input('steps'), {
      open: (cookie) => FileSession.opened(sessions.library, cookie),
      // The names that the case files give the two failures of a record, by the kind of the error of hyper: a record
      // that cannot be decoded (kind `record`) is `unserialize`, and a record that holds no array (kind
      // `record_not_array`) is `record`.
      failure: (error) => {
        const kind: unknown = error instanceof Error ? Reflect.get(error, 'kind') : undefined;
        if (kind === 'record') return 'unserialize';
        return kind === 'record_not_array' ? 'record' : null;
      },
      call: (method, _args, made) => {
        if (method !== 'directory') throw new Error(`the method ${method} of the case is unknown`);
        return names(directory, made);
      },
      other: async (step) => {
        if (step.get('collect') !== true) throw new Error('a step of the case is neither a request nor a collection');
        return [await sessions.collect()];
      },
      identifiers,
      after: (made) => {
        const listed = readdirSync(directory).map((name): [string, string] => [written(name, made), readFileSync(join(directory, name)).toString('latin1')]);
        records.push(listed.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
        const later = [...aged].filter(([name, age]) => existsSync(join(directory, name)) && statSync(join(directory, name)).mtimeMs > start - (age * 1000) / 2);
        touched.push(later.map(([name]) => written(name, made)).sort());
      },
    });
    reader.compare('results', outcome.results);
    reader.compare('created', outcome.created);
    reader.compare('errors', outcome.errors);
    reader.compare('message', outcome.message);
    reader.compare('records', records);
    reader.compare('touched', touched);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export const steps = {
  async requests(reader: CaseReader): Promise<void> {
    await sessionFileRequests(reader);
  },

  // The failure of making a store or of the first request of a session, with its kind, status and category (HY-133.3).
  // An error that is no error of hyper fails the case, because `raisesOf` throws it again.
  async storeFailures(reader: CaseReader): Promise<void> {
    const root = mkdtempSync(join(tmpdir(), 'hyper-file-sessions-'));
    try {
      const files = reader.has('files') ? reader.input('files') : [];
      if (!Array.isArray(files)) throw new Error('the files of the case are not a list');
      for (const file of files) {
        if (!(file instanceof Map)) throw new Error('a file of the case is not a map');
        writeFileSync(join(root, `${PREFIX}${textOf(file.get('identifier'), 'the identifier of a file')}`), bytesOf(textOf(file.get('bytes'), 'the bytes of a file')), { mode: 0o600 });
      }
      const named = reader.has('directory') ? reader.input('directory') : null;
      let directory = root;
      if (named === 'missing') directory = join(root, 'missing');
      else if (named === 'relative') directory = 'hyper-sessions-of-the-case';
      else if (named === 'file') {
        directory = join(root, 'file');
        writeFileSync(directory, '');
      } else if (named !== null) throw new Error('the directory of the case is not missing, file or relative');
      const lifetime = reader.has('lifetime') ? reader.input('lifetime') : undefined;
      const cookie = reader.has('cookie') ? textOf(reader.input('cookie'), 'the cookie of the case') : null;
      // The first failure counts: the session is closed also after a read that failed.
      let failure: unknown = null;
      try {
        // @ts-expect-error -- a case gives the lifetime as a JSON value of any type, which the maker refuses (HY-104.32)
        const sessions = await FileSessions.inDirectory(lifetime === undefined ? { directory } : { directory, lifetime });
        if (cookie !== null) {
          const store = await FileSession.opened(sessions.library, cookie);
          try {
            store.get('a');
          } catch (error) {
            failure = error;
          }
          try {
            await store.close();
          } catch (error) {
            failure ??= error;
          }
        }
      } catch (error) {
        failure ??= error;
      }
      reader.compare('raises', failure === null ? null : raisesOf(failure));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },

  cookie(reader: CaseReader): void {
    const identifier = textOf(reader.input('identifier'), 'the identifier of the case');
    const https = reader.input('https') === true;
    reader.compare('name', RecordSession.cookieName(https));
    reader.compare('header', RecordSession.cookieHeader(identifier, https));
  },
};
