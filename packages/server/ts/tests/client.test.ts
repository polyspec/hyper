// The client rendering beyond the cases of contracts/client.json (HY-62): the selection and the declaration.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { maskedToken } from '../src/csrf.js';
import { FileSessions, Request, Result, type Choice, type ClientRendering } from '../src/index.js';
import { client, Fixture, FIXTURES, port, present, SHELL, TOKEN } from './support.js';

// Requires that a request whose selection is `selects` is answered with the plain 500 and logs one error (HY-43).
async function expectPlain500(selects: ClientRendering['selects']): Promise<void> {
  const fixture = new Fixture();
  const response = await fixture.handle({ target: '/' }, { clientRendering: client(selects) });
  expect(response.status).toBe(500);
  expect(response.body).toBe('Internal Server Error');
  expect(fixture.log).toHaveLength(1);
}

describe('client rendering (HY-62)', () => {
  it('reports the shell response with the frame policy and an empty reply (HY-45, HY-60)', async () => {
    const reports: [string, number, string | string[] | undefined, number][] = [];
    const fixture = new Fixture();
    const app = await fixture.app({
      clientRendering: client(),
      frameAncestors: "'self' https://frame.test",
      onResponse: (request, response, _elapsed, reply) => reports.push([present(request).path(), response.status, response.headers['Content-Security-Policy'], reply.notes().size]),
    });
    await app.handle(Request.from({ method: 'GET', target: '/list', headers: { Host: 'client.test' } }), fixture.session);
    await app.handle(Request.from({ method: 'GET', target: '/_props/list', headers: { Host: 'client.test' } }), fixture.session);
    expect(reports).toEqual([
      ['/list', 200, "frame-ancestors 'self' https://frame.test", 0],
      ['/_props/list', 406, "frame-ancestors 'self' https://frame.test", 0],
    ]);
  });

  it('awaits a selection that returns a promise (HY-62)', async () => {
    const shell = await new Fixture().handle({ target: '/list', headers: { Host: 'client.test' } }, { clientRendering: client(async (request) => ({ chosen: request.header('Host') === 'client.test', value: null })) });
    expect(shell.status).toBe(200);
    expect(shell.body).toBe(readFileSync(SHELL, 'utf8'));
    const document = await new Fixture().handle({ target: '/list?embed=1', headers: { Host: 'server.test' } }, { clientRendering: client(async () => ({ chosen: false, value: null })) });
    expect(document.status).toBe(200);
    expect(document.body).toContain('id="hy-data"');
  });

  it('answers 500 for a promise that rejects or resolves to another value (HY-43)', async () => {
    // The selections resolve to values outside their declared type, which the server checks at run time.
    const selections: ClientRendering['selects'][] = [
      // @ts-expect-error: a string is no Choice.
      async () => 'csr',
      // @ts-expect-error: a boolean is no Choice.
      async () => true,
      // @ts-expect-error: a choice without a value is no Choice.
      async () => ({ chosen: true }),
      async (): Promise<Choice> => {
        throw new Error('selection');
      },
    ];
    for (const selects of selections) await expectPlain500(selects);
  });

  it('answers 500 for a selection that throws or returns another value (HY-43)', async () => {
    // The selections return values outside their declared type, which the server checks at run time.
    const selections: ClientRendering['selects'][] = [
      // @ts-expect-error: a string is no Choice.
      () => 'csr',
      // @ts-expect-error: a boolean is no Choice.
      () => true,
      // @ts-expect-error: a choice whose chosen is a string is no Choice.
      () => ({ chosen: 'yes', value: null }),
      () => ({ chosen: true, value: undefined }),
      (): Choice => {
        throw new Error('selection');
      },
    ];
    for (const selects of selections) await expectPlain500(selects);
  });

  it('gives the value of the choice to every handler of the request (HY-62)', async () => {
    let selections = 0;
    const seen: [string, unknown][] = [];
    const fixture = new Fixture();
    const app = await fixture.app({
      clientRendering: client((request) => {
        selections++;
        const host = request.header('Host') ?? '';
        return { chosen: host === 'client.test', value: { host } };
      }),
      handlers: {
        shared: ({ request }) => {
          seen.push(['shared', request.selection()]);
          return {};
        },
        regions: { side: ({ request }) => {
          seen.push(['side', request.selection()]);
          return { count: 0, note: null };
        } },
        routes: {
          item: { load: ({ request }) => {
            seen.push(['item', request.selection()]);
            return { id: request.param('id') };
          } },
          add: { post: ({ request }) => {
            seen.push(['add', request.selection()]);
            return Result.redirect('/');
          } },
        },
      },
    });
    await app.handle(Request.from({ method: 'GET', target: '/items/7', headers: { Host: 'server.test' } }), fixture.session);
    expect(selections).toBe(1);
    expect(seen).toEqual([['shared', { host: 'server.test' }], ['side', { host: 'server.test' }], ['item', { host: 'server.test' }]]);
    seen.length = 0;
    await app.handle(Request.from({ method: 'GET', target: '/_props/items/7', headers: { Host: 'client.test', Accept: 'application/json' } }), fixture.session);
    expect(selections).toBe(2);
    expect(seen).toEqual([['shared', { host: 'client.test' }], ['side', { host: 'client.test' }], ['item', { host: 'client.test' }]]);
    seen.length = 0;
    fixture.session.set('_hyper_csrf', TOKEN);
    const body = Buffer.from(new URLSearchParams({ _csrf: maskedToken(TOKEN), name: 'x' }).toString(), 'latin1');
    const response = await app.handle(Request.from({ method: 'POST', target: '/add', headers: { Host: 'server.test', 'Content-Type': 'application/x-www-form-urlencoded' }, body }), fixture.session);
    expect(response.status).toBe(303);
    expect(selections).toBe(3);
    expect(seen).toEqual([['add', { host: 'server.test' }]]);
  });

  it('gives the value null to a request of an application without the declaration (HY-62)', async () => {
    const seen: unknown[] = [];
    const fixture = new Fixture();
    const app = await fixture.app({
      handlers: { routes: {
        item: { load: ({ request }) => {
          seen.push(request.selection());
          return { id: request.param('id') };
        } },
        add: { post: () => Result.redirect('/') },
      } },
    });
    await app.handle(Request.from({ method: 'GET', target: '/items/7' }), fixture.session);
    expect(seen).toEqual([null]);
  });

  it('fails to open with an invalid declaration', async () => {
    const selects = (): Choice => ({ chosen: true, value: null });
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
    const server = (await new Fixture().app({ clientRendering: client(() => ({ chosen: true, value: null })) })).server(new FileSessions({ directory }));
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const response = await fetch(`http://127.0.0.1:${port(server)}/items/7`);
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
