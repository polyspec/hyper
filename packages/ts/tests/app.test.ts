// The application beyond the cases of contracts/app.json: the outputs of the build that `open` reads (HY-48) and the one
// argument of a Node handler (HY-54).
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/index.js';
import { Fixture, FIXTURES, handlers, json, JSON_REGION, PROGRAM } from './support.js';
import { requestOf } from '../src/host/http-host.js';

let fixture: Fixture;
beforeEach(() => {
  fixture = new Fixture();
});

describe('App', () => {
  it('opens only when every output of the build exists and names the first missing one (HY-48)', async () => {
    const missing = `${PROGRAM}-without`;
    await expect(App.open({ manifest: `${FIXTURES}app.json`, program: missing, handlers: handlers(), timezone: 'Z' })).rejects.toThrow(`${missing}/reads.json of the server program ${missing} is missing`);
    const absent = `${FIXTURES}without-app.json`;
    await expect(App.open({ manifest: absent, program: PROGRAM, handlers: handlers(), timezone: 'Z' })).rejects.toThrow(absent);
    await expect(App.open({ manifest: `${FIXTURES}app.json`, program: 'program', handlers: handlers(), timezone: 'Z' })).rejects.toThrow('program is not an absolute path');
  });
});

describe('Node handlers', () => {
  it('passes one context with the request, the reply and the services (HY-54)', async () => {
    const seen: unknown[] = [];
    const base = handlers();
    const app = await fixture.app({ handlers: { ...base, shared: (context) => {
      seen.push(Object.keys(context).sort(), context.services.get('counter') === fixture.counter);
      return { site: 'x' };
    } } });
    const response = json(await app.handle(requestOf({ method: 'GET', target: '/', headers: JSON_REGION }), fixture.session));
    expect(seen).toEqual([['reply', 'request', 'services'], true]);
    // HY-73: no template of the route reads site or csrf.
    expect(response.shared).toEqual({ title: 'Home' });
  });

  it('requires an absolute path of the manifest (HY-48.17)', async () => {
    await expect(App.open({ manifest: 'app.json', program: PROGRAM, timezone: 'Z', handlers: {} })).rejects.toThrow('app.json is not an absolute path');
  });
});
