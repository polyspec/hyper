// The steps of contracts/hooks.json (HY-67, HY-97, HY-99): a hook that is no function fails when the server is created
// or when the application opens.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App, FileSessions, type AppOptions, type ServerOptions } from '../../src/index.js';
import type { CaseReader } from '../case-reader.js';
import { FIXTURES, TEMPLATES, type Services } from '../support.js';
import { fixtureHandlers } from './client.js';
import { messageStart } from './recorded.js';

// The options of the fixture application of contracts/client.json without a client rendering, which opens.
function fixture(): AppOptions<Services> {
  return { manifest: `${FIXTURES}app.json`, build: `${FIXTURES}build.json`, templates: TEMPLATES, handlers: fixtureHandlers(), timezone: '+09:00', log: () => {} };
}

// Returns the error of a call that fails with exactly the open error (HY-106.6), and fails the case for a call that
// returns or that raises an error of another class.
function creationError(entry: string, create: () => unknown): Error {
  try {
    create();
  } catch (error) {
    if (!(error instanceof Error) || error.constructor !== Error) throw error;
    return error;
  }
  throw new Error(`${entry} was created with a hook that is no function`);
}

export const steps = {
  async creation(reader: CaseReader): Promise<void> {
    const hook = reader.input('hook');
    if (hook === 'disconnect') {
      let failure: unknown = null;
      try {
        // @ts-expect-error -- a case gives a text in the place of the disconnect hook, which the open checks (HY-67.13)
        await App.open<Services>({ ...fixture(), onDisconnect: 'no function' });
      } catch (error) {
        failure = error;
      }
      reader.outcome('creation', failure);
      messageStart(reader, failure);
      reader.compare('message', failure instanceof Error ? failure.message : '');
      return;
    }
    if (hook !== 'around' && hook !== 'written') throw new Error(`the hook ${String(hook)} of the case is unknown`);
    const app = await App.open<Services>(fixture());
    // A session store over a directory of the step, which no entry uses, because no entry listens.
    const directory = mkdtempSync(join(tmpdir(), 'hyper-hooks-'));
    try {
      const sessions = new FileSessions({ directory });
      // The text stands in the place of the hook, which each host entry checks (HY-97.7, HY-99.14).
      const options: ServerOptions = { [hook]: 'no function' };
      const errors: [Error, Error] = [
        creationError('App.server', () => {
          // A server that is created although it should have failed is closed; it never listened.
          app.server(sessions, options).close();
        }),
        creationError('App.listener', () => app.listener(sessions, options)),
      ];
      const [first, second] = errors;
      if (first.message !== second.message) throw new Error(`the host entries fail with two messages: ${first.message} and ${second.message}`);
      reader.outcome('creation', first);
      messageStart(reader, first);
      reader.compare('message', first.message);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
};
