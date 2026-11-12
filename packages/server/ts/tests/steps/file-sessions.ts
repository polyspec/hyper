// The steps of contracts/file-sessions.json (HY-45, HY-104): the session files that the requests of a case read and
// write, the session cookie, and the options that the store refuses.
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UnserializeError } from '@polyspec/php-serialize';
import { FileSessions } from '../../src/file-sessions.js';
import { RecordSession } from '../../src/record-session.js';
import type { CaseReader } from '../case-reader.js';
import { bytesOf } from '../support.js';
import { requests, textOf } from './session-requests.js';

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

// Returns the message of the open error of a call, an error of exactly the class Error (HY-106.6); a call that returns
// fails the step, and an error of another class is an error of the step.
function openError(open: () => unknown): string {
  try {
    open();
  } catch (error) {
    if (!(error instanceof Error) || error.constructor !== Error) throw error;
    return error.message;
  }
  throw new Error('the store was made with the options of the case');
}

export const steps = {
  async requests(reader: CaseReader): Promise<void> {
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
      const sessions = new FileSessions({ directory });
      const records: [string, string][][] = [];
      const touched: string[][] = [];
      const outcome = await requests(reader.input('steps'), {
        open: (cookie) => sessions.open(cookie),
        failure: (error) => {
          if (error instanceof UnserializeError) return 'unserialize';
          return error instanceof Error && error.constructor === Error ? 'record' : null;
        },
        call: (method, _args, made) => {
          if (method !== 'directory') throw new Error(`the method ${method} of the case is unknown`);
          return names(directory, made);
        },
        other: (step) => {
          if (step.get('collect') !== true) throw new Error('a step of the case is neither a request nor a collection');
          return [sessions.collect()];
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
  },

  cookie(reader: CaseReader): void {
    const identifier = textOf(reader.input('identifier'), 'the identifier of the case');
    const https = reader.input('https') === true;
    reader.compare('name', RecordSession.cookieName(https));
    reader.compare('header', RecordSession.cookieHeader(identifier, https));
  },

  open(reader: CaseReader): void {
    const given = textOf(reader.input('directory'), 'the directory of the case');
    const temporary = given === 'temporary' ? mkdtempSync(join(tmpdir(), 'hyper-file-sessions-')) : null;
    const directory = temporary ?? given;
    try {
      const message = reader.has('lifetime')
        ? openError(
            () =>
              new FileSessions({
                directory,
                // @ts-expect-error -- a case gives the lifetime as a JSON value of any type, which the store checks (HY-104.19)
                lifetime: reader.input('lifetime'),
              }),
          )
        : openError(() => new FileSessions({ directory }));
      reader.compare('error', message);
    } finally {
      if (temporary !== null) rmSync(temporary, { recursive: true, force: true });
    }
  },
};
