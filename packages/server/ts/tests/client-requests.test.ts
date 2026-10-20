// The cases of contracts/client.json (HY-62): one server answers the client-rendered and the server-rendered pages of the
// fixture manifest. PHP and Python pass the same cases. Each case is a top-level test named by its id (S6).
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { maskedToken } from '../src/csrf.js';
import { client, conformance, Fixture, list, parsed, record, SHELL, strings, text, TOKEN } from './support.js';

// Each case of contracts/client.json is a top-level test named by its id (S6).
it.each(list(conformance.cases).map(record).map((item) => [text(item.id), item] as const))('%s', async (_id, item) => {
  const fixture = new Fixture();
  const request = record(item.request);
  let form = request.form === undefined ? undefined : strings(request.form);
  if (request.csrf === true) {
    fixture.session.set('_hyper_csrf', TOKEN);
    form = { _csrf: maskedToken(TOKEN), ...form };
  }
  const response = await fixture.handle(
    { method: text(request.method), target: text(request.target), headers: strings(request.headers), body: form === undefined ? undefined : new URLSearchParams(form).toString() },
    { clientRendering: client() },
  );
  expect(response.status).toBe(item.status);
  for (const [name, value] of Object.entries(record(item.headers))) expect(response.headers[name], name).toBe(value);
  if (item.shell === true) {
    expect(response.body).toBe(readFileSync(SHELL, 'utf8'));
    expect(response.headers).toEqual(item.headers);
  }
  if (item.body !== undefined) expect(response.body).toBe(item.body);
  if (item.json !== undefined) {
    const json = record(parsed(response.body));
    const expected = record(item.json);
    expect(json.route).toBe(expected.route);
    expect(json.params).toEqual(expected.params);
    expect(Object.keys(record(json.regions))).toEqual(expected.regions);
  }
  if (item.session === false) expect(fixture.session.get('_hyper_csrf')).toBeUndefined();
  expect(fixture.counter.actions).toBe(item.actions);
});
