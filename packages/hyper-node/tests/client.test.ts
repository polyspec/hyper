// The cases of conformance/client.json (HY-62), which PHP passes in ClientTest: one server answers the client-rendered
// and the server-rendered pages of the fixture manifest.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileSessions, Request, type ClientRendering } from '../src/index.js';
import { Fixture, FIXTURES } from './support.js';

interface Case {
  label: string;
  request: { method: string; target: string; headers: Record<string, string>; form?: Record<string, string>; csrf?: boolean };
  status: number;
  headers: Record<string, string>;
  shell?: boolean;
  body?: string;
  json?: { route: string; params: Record<string, string>; regions: string[] };
  session?: boolean;
  actions: number;
}

const conformance = JSON.parse(readFileSync(new URL('../../../conformance/client.json', import.meta.url), 'utf8')) as { basePath: string; chosenHost: string; cases: Case[] };
const SHELL = `${FIXTURES}shell/index.html`;
const TOKEN = 'conformance-token';
const client = (selects: ClientRendering['selects'] = (request) => request.header('Host') === conformance.chosenHost): ClientRendering => ({ shell: SHELL, basePath: conformance.basePath, selects });

describe('client rendering (HY-62)', () => {
  for (const item of conformance.cases) {
    it(item.label, async () => {
      const fixture = new Fixture();
      let form = item.request.form;
      if (item.request.csrf === true) {
        fixture.session.set('_hyper_csrf', TOKEN);
        form = { _csrf: TOKEN, ...form };
      }
      const response = await fixture.handle(
        { method: item.request.method, target: item.request.target, headers: item.request.headers, body: form === undefined ? undefined : new URLSearchParams(form).toString() },
        { clientRendering: client() },
      );
      expect(response.status).toBe(item.status);
      for (const [name, value] of Object.entries(item.headers)) expect(response.headers[name], name).toBe(value);
      if (item.shell === true) {
        expect(response.body).toBe(readFileSync(SHELL, 'utf8'));
        expect(response.headers).toEqual(item.headers);
      }
      if (item.body !== undefined) expect(response.body).toBe(item.body);
      if (item.json !== undefined) {
        const json = JSON.parse(response.body) as { route: string; params: Record<string, string>; regions: Record<string, unknown> };
        expect(json.route).toBe(item.json.route);
        expect(json.params).toEqual(item.json.params);
        expect(Object.keys(json.regions)).toEqual(item.json.regions);
      }
      if (item.session === false) expect(fixture.session.get('_hyper_csrf')).toBeUndefined();
      expect(fixture.counter.actions).toBe(item.actions);
    });
  }

  it('reports the shell response with the frame policy and an empty reply (HY-45, HY-60)', async () => {
    const reports: [string, number, string | undefined, number][] = [];
    const fixture = new Fixture();
    const app = await fixture.app({
      clientRendering: client(),
      frameAncestors: "'self' https://frame.test",
      onResponse: (request, response, _elapsed, reply) => reports.push([request!.path(), response.status, response.headers['Content-Security-Policy'] as string | undefined, reply.notes().size]),
    });
    await app.handle(Request.from({ method: 'GET', target: '/list', headers: { Host: 'client.test' } }), fixture.session);
    await app.handle(Request.from({ method: 'GET', target: '/_props/list', headers: { Host: 'client.test' } }), fixture.session);
    expect(reports).toEqual([
      ['/list', 200, "frame-ancestors 'self' https://frame.test", 0],
      ['/_props/list', 406, "frame-ancestors 'self' https://frame.test", 0],
    ]);
  });

  it('awaits a selection that returns a promise (HY-62)', async () => {
    const shell = await new Fixture().handle({ target: '/list', headers: { Host: 'client.test' } }, { clientRendering: client(async (request) => request.header('Host') === 'client.test') });
    expect(shell.status).toBe(200);
    expect(shell.body).toBe(readFileSync(SHELL, 'utf8'));
    const document = await new Fixture().handle({ target: '/list', headers: { Host: 'server.test' } }, { clientRendering: client(async () => false) });
    expect(document.status).toBe(200);
    expect(document.body).toContain('id="hy-data"');
  });

  it('answers 500 for a promise that rejects or resolves to another value (HY-43)', async () => {
    for (const selects of [async () => 'csr' as unknown as boolean, async (): Promise<boolean> => { throw new Error('selection'); }]) {
      const fixture = new Fixture();
      const response = await fixture.handle({ target: '/' }, { clientRendering: client(selects) });
      expect(response.status).toBe(500);
      expect(response.body).toBe('Internal Server Error');
      expect(fixture.log).toHaveLength(1);
    }
  });

  it('answers 500 for a selection that throws or returns another value (HY-43)', async () => {
    for (const selects of [() => 'csr' as unknown as boolean, (): boolean => { throw new Error('selection'); }]) {
      const fixture = new Fixture();
      const response = await fixture.handle({ target: '/' }, { clientRendering: client(selects) });
      expect(response.status).toBe(500);
      expect(response.body).toBe('Internal Server Error');
      expect(fixture.log).toHaveLength(1);
    }
  });

  it('fails to open with an invalid declaration', async () => {
    const selects = (): boolean => true;
    const invalid: [string, ClientRendering][] = [
      ['relative shell', { shell: 'tests/fixtures/shell/index.html', basePath: '/_props', selects }],
      ['missing shell', { shell: `${FIXTURES}shell/missing.html`, basePath: '/_props', selects }],
      ['shell of another base path', { shell: `${FIXTURES}shell/other-base.html`, basePath: '/_props', selects }],
      ['empty base path', { shell: SHELL, basePath: '', selects }],
      ['base path ending with /', { shell: SHELL, basePath: '/_props/', selects }],
      ['route under the base path', { shell: SHELL, basePath: '/items', selects }],
    ];
    for (const [label, declaration] of invalid) {
      await expect(new Fixture().app({ clientRendering: declaration }), label).rejects.toThrow();
    }
  });

  it('serves the shell over node:http without a session (HY-45, HY-62)', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'hyper-client-'));
    const server = (await new Fixture().app({ clientRendering: client(() => true) })).server(new FileSessions({ directory, name: 'PHPSESSID' }));
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/items/7`);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-cache');
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(await response.text()).toBe(readFileSync(SHELL, 'utf8'));
      expect(readdirSync(directory)).toEqual([]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
