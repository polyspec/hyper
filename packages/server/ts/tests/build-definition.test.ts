// The html definition `build` of every document (HY-125): a layout that places {# build} renders the element with the
// build id of the application.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App, MemorySessionStore, Request } from '../src/index.js';

const BUILD = '691d41cab78295352a2fea59326d4ac7f4e0a0ff68eb39acb3f09eb0d1eb51ac';
const SCRIPT = fileURLToPath(new URL('../../../../scripts/build-templates.mts', import.meta.url));
let workspace: string;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'hyper-build-definition-'));
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('the html definition build (HY-125)', () => {
  it('renders the meta element of the build id where the layout places {# build}', async () => {
    const source = join(workspace, 'source');
    mkdirSync(source);
    writeFileSync(join(source, 'layout.tpl'), '<head>{# build}</head>\n<main id="content">{# content}</main>\n{# data}\n');
    writeFileSync(join(source, 'title.tpl'), '{= title}');
    writeFileSync(join(source, 'home.tpl'), '<p>Home</p>');
    const manifest = join(workspace, 'manifest.json');
    writeFileSync(manifest, JSON.stringify({ layout: 'layout.tpl', title: 'title.tpl', regions: [{ name: 'content', page: true }], routes: [{ name: 'home', path: '/', title: 'Home', template: 'home.tpl' }] }));
    const build = join(workspace, 'build.json');
    writeFileSync(build, JSON.stringify({ build: BUILD }));
    const output = join(workspace, 'out');
    const built = spawnSync(process.execPath, [SCRIPT, '--templates', source, '--output', output], { encoding: 'utf8' });
    expect(built.status).toBe(0);

    const failures: string[] = [];
    const app = await App.open({ manifest, build, templates: { index: join(output, 'templates.index.json'), root: output }, handlers: {}, timezone: '+09:00', log: () => {}, onResponse: (_request, _response, _elapsed, _reply, failure) => { if (failure !== null) failures.push(failure); } });
    const response = await app.handle(Request.from({ method: 'GET', target: '/', headers: {} }), new MemorySessionStore());
    expect(failures).toEqual([]);
    expect(response.status).toBe(200);
    expect(response.body).toContain(`<head><meta name="hyper-build" content="${BUILD}"></head>`);
  });
});
