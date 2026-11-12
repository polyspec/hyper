// What the steps of contracts/client.json and contracts/app.json record of one request: the calls of the session
// store, the reports of the response hook and the texts of the log, each with one meaning in both files.
import type { Reply, Request, Response } from '../../src/index.js';
import type { SessionStore } from '../../src/session-store.js';
import type { CaseReader } from '../case-reader.js';

// A session store that records every call that the application makes of the four methods of the store, each as the
// method name and its key, and keeps the values in the store it wraps.
export class RecordingStore implements SessionStore {
  readonly calls: string[] = [];
  private readonly inner: SessionStore;

  constructor(inner: SessionStore) {
    this.inner = inner;
  }

  get(key: string): unknown {
    this.calls.push(`get ${key}`);
    return this.inner.get(key);
  }

  set(key: string, value: unknown): void {
    this.calls.push(`set ${key}`);
    this.inner.set(key, value);
  }

  remove(key: string): void {
    this.calls.push(`remove ${key}`);
    this.inner.remove(key);
  }

  renew(): void {
    this.calls.push('renew');
    this.inner.renew();
  }
}

// Gives the reader the first seven characters of the message of a failure and the text that the message of an error of
// the Node server starts with (HY-106.10).
export function messageStart(reader: CaseReader, failure: unknown): void {
  reader.outcome('messageStart', [failure instanceof Error ? failure.message.slice(0, 7) : '', 'hyper: ']);
}

// Returns the error of a rejected open, or null when the open did not fail.
export function failureOf(open: Promise<unknown>): Promise<unknown> {
  return open.then(
    () => null,
    (error: unknown) => error,
  );
}

// Gives the reader the failure of an open: the outcome `open`, the start of its message and the field `openError`.
export function comparesOpen(reader: CaseReader, failure: unknown): void {
  reader.outcome('open', failure);
  messageStart(reader, failure);
  reader.compare('openError', failure instanceof Error ? failure.message : '');
}

// A call of the response hook: what it received (HY-60).
export interface Report {
  request: Request | null;
  response: Response;
  elapsed: number;
  reply: Reply;
  failure: string | null;
}

// What the server showed during one request besides its response: the calls of the store, the reports of the response
// hook and the texts that it gave to its log.
export class Recorded {
  readonly reports: Report[] = [];
  readonly logged: string[] = [];

  // The response hook that the step gives to `open`.
  readonly onResponse = (request: Request | null, response: Response, elapsed: number, reply: Reply, failure: string | null): void => {
    this.reports.push({ request, response, elapsed, reply, failure });
  };

  // The log function that the step gives to `open`.
  readonly log = (message: string): void => {
    this.logged.push(message);
  };

  // Forgets what the requests so far showed.
  clear(): void {
    this.reports.length = 0;
    this.logged.length = 0;
  }

  // Compares the fields of both case files that state the store calls, the log and the reports of the hook: `storeCalls`
  // and `firstStoreCalls`, `logged` and `logCount`, `reported`, and `reportedHeaders` and `notes` of the last report. A
  // field that the section does not declare is not compared.
  compare(reader: CaseReader, store: RecordingStore): void {
    if (reader.has('storeCalls')) reader.compare('storeCalls', store.calls);
    if (reader.has('firstStoreCalls')) reader.compare('firstStoreCalls', store.calls);
    if (reader.has('logged')) reader.compare('logged', this.logged.join('\n'));
    if (reader.has('logCount')) reader.compare('logCount', this.logged.length);
    if (reader.has('reported')) {
      reader.compare('reported', this.reports.map((report: Report) => [report.request === null ? 'null' : `${report.request.method} ${report.request.path()}`, report.response.status]));
    }
    if (reader.has('reportedHeaders')) reader.compare('reportedHeaders', this.last().response.headers);
    if (reader.has('notes')) reader.compare('notes', this.last().reply.notes());
  }

  // Returns the last report of the response hook, and fails when the hook received no call.
  last(): Report {
    const last = this.reports.at(-1);
    if (last === undefined) throw new Error('the response hook received no call');
    return last;
  }
}
