// The client rendering beyond the cases of contracts/client.json (HY-62): an application without the declaration, the
// form of an error message of the Node server (HY-106.10) and the shell over node:http.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileSessions, Result } from '../src/index.js';
import { client, Fixture, port, SHELL } from './support.js';
import { requestOf } from '../src/http-host.js';

describe('client rendering (HY-62)', () => {
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
    await app.handle(requestOf({ method: 'GET', target: '/items/7' }), fixture.session);
    expect(seen).toEqual([null]);
  });

  it('starts the message of an open failure of the static shell with hyper: (HY-106.10)', async () => {
    const open = new Fixture().app({ clientRendering: { shell: 'tests/fixtures/shell/index.html', basePath: '/_props', selects: () => ({ chosen: true, value: null }) } });
    await expect(open).rejects.toThrow(/^hyper: static shell /);
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
