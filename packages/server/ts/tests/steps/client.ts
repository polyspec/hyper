// The steps of contracts/client.json (HY-62): one server answers the client-rendered and the server-rendered pages of the
// fixture manifest. PHP and Python pass the same cases.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Csrf } from '../../src/csrf.js';
import { Representation, type Handlers, type RepresentationHandler, type Request } from '../../src/index.js';
import type { SessionStore } from '../../src/session.js';
import type { CaseReader } from '../case-reader.js';
import { client, Fixture, FIXTURES, handlers, parsed, plain, record, TOKEN, type Services } from '../support.js';

// What the representation handlers of a case received: the number of their calls, and the media parameters and the
// request of the last call.
interface Calls {
  handled: number;
  parameters: ReadonlyMap<string, string> | null;
  request: Request | null;
}

// Returns a representation handler that answers `response` and records its calls and what it receives (HY-122).
function representation(calls: Calls, response: Map<string, unknown>): RepresentationHandler<Services> {
  return ({ request, media }) => {
    calls.handled++;
    calls.parameters = media.parameters;
    calls.request = request;
    const headers = response.get('headers');
    return new Representation(response.get('status') as number, response.get('body') ?? null, headers instanceof Map ? Object.fromEntries(headers as Map<string, string>) : {});
  };
}

// Writes the manifest of the fixture application with the representations that the case declares for its routes, and
// returns its path in a directory that the caller removes, with the handlers of the fixture and of those entries. Each
// entry answers the response `handler` of the case, or its own.
function declared(representations: Map<string, Map<string, unknown>[]>, handler: Map<string, unknown> | null, calls: Calls): { directory: string; manifest: string; handlers: Handlers<Services> } {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-client-'));
  const manifest = join(directory, 'app.json');
  const document = record(parsed(readFileSync(`${FIXTURES}app.json`, 'utf8')));
  const all = handlers();
  const routes = { ...all.routes };
  for (const route of document.routes as { name: string; representations?: unknown }[]) {
    const entries = representations.get(route.name);
    if (entries === undefined) continue;
    route.representations = entries.map((entry) => plain(new Map([...entry].filter(([key]) => key !== 'handler'))));
    routes[route.name] = {
      ...routes[route.name],
      representations: Object.fromEntries(entries.map((entry) => [entry.get('type') as string, representation(calls, handler ?? (entry.get('handler') as Map<string, unknown>))])),
    };
  }
  writeFileSync(manifest, JSON.stringify(document));
  return { directory, manifest, handlers: { ...all, routes } };
}


// A session store that records the writes that the application makes to it, and keeps them in the store it wraps.
class RecordingStore implements SessionStore {
  readonly calls: string[] = [];
  private readonly inner: SessionStore;

  constructor(inner: SessionStore) {
    this.inner = inner;
  }

  get(key: string): unknown {
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

export const steps = {
  async cases(reader: CaseReader): Promise<void> {
    const fixture = new Fixture();
    const store = new RecordingStore(fixture.session);
    const headers = Object.fromEntries(reader.input('request.headers') as Map<string, string>);
    const method = reader.input('request.method') as string;
    const target = reader.input('request.target') as string;
    const form = reader.has('request.form') ? Object.fromEntries(reader.input('request.form') as Map<string, string>) : undefined;
    let fields = form;
    if (reader.has('request.csrf') && reader.input('request.csrf') === true) {
      fixture.session.set('_hyper_csrf', TOKEN);
      fields = { _csrf: Csrf.masked(TOKEN), ...fields };
    }
    const body = reader.has('request.body')
      ? (reader.input('request.body') as string)
      : fields === undefined ? undefined : new URLSearchParams(fields).toString();
    const calls: Calls = { handled: 0, parameters: null, request: null };
    const application = declared(
      reader.input('representations') as Map<string, Map<string, unknown>[]>,
      reader.has('handler') ? (reader.input('handler') as Map<string, unknown>) : null,
      calls,
    );
    let response;
    try {
      response = await fixture.handle({ method, target, headers, body }, { clientRendering: client(), manifest: application.manifest, handlers: application.handlers }, store);
    } finally {
      rmSync(application.directory, { recursive: true, force: true });
    }
    reader.compare('status', response.status);
    reader.compare('headers', response.headers);
    reader.compare('allHeaders', response.headers);
    reader.compare('body', response.body);
    reader.compare('absentHeaders', response.headers);
    if (reader.has('json')) {
      const json = record(parsed(response.body));
      reader.compare('json.route', json.route);
      reader.compare('json.params', json.params);
      reader.compare('json.regions', record(json.regions));
    }
    reader.compare('session', fixture.session.get('_hyper_csrf') !== undefined);
    reader.compare('actions', fixture.counter.actions);
    reader.compare('storeCalls', store.calls);
    reader.compare('handled', calls.handled);
    if (!reader.has('received')) return;
    // The headers that the handler received are among the headers of the request.
    const received: Record<string, string> = {};
    for (const name of Object.keys(headers)) {
      const value = calls.request?.header(name) ?? null;
      if (value !== null) received[name] = value;
    }
    reader.compare('received.parameters', calls.parameters);
    reader.compare('received.selection', calls.request?.selection());
    reader.compare('received.absentHeaders', received);
  },
};
