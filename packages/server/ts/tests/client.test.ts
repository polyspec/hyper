// The client rendering beyond the cases of contracts/client.json (HY-62): the shell over node:http.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileSessions } from '../src/index.js';
import { client, Fixture, port, SHELL } from './support.js';

describe('client rendering (HY-62)', () => {
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
