// The steps of tests/legacy/file-store-sessions.json (HY-45, HY-104): the fixed copy of the store cases that the sessions
// library holds, which the server reads until it calls the core and S-4 removes the copy; the requests run as those of
// contracts/file-sessions.json, and the options that the store refuses give the open error.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSessions } from '../../src/file-sessions.js';
import type { CaseReader } from '../case-reader.js';
import { textOf } from '../inputs.js';
import { sessionFileRequests } from './file-sessions.js';

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
    await sessionFileRequests(reader);
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
