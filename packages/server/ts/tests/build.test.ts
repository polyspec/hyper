// The build id that App.open reads (HY-125, HY-48) and the member build of every JSON response (HY-128).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/index.js';
import { Fixture, FIXTURES, handlers, JSON_REGION, TEMPLATES } from './support.js';

const ONES = '1'.repeat(64);
let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'hyper-build-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

// Opens the fixture application with the given build file and returns the rejection of open (HY-125).
async function openWith(build: string): Promise<unknown> {
  return App.open({ manifest: `${FIXTURES}app.json`, build, templates: TEMPLATES, handlers: handlers(), timezone: 'Z' }).then(
    () => null,
    (error: unknown) => error,
  );
}

describe('App.open reads the build id (HY-125)', () => {
  it('fails with the path of a missing build file', async () => {
    const missing = join(directory, 'build.json');
    await expect(openWith(missing)).resolves.toEqual(expect.objectContaining({ message: expect.stringContaining(missing) }));
  });

  it.each([
    ['an empty object', '{}'],
    ['an uppercase build id', `{"build":"${'A'.repeat(64)}"}`],
    ['a short build id', '{"build":"ABC"}'],
    ['an extra key', `{"build":"${ONES}","extra":1}`],
    ['text that is not JSON', 'build'],
  ])('fails with the path of a build file that holds %s', async (_name, text) => {
    const path = join(directory, 'build.json');
    writeFileSync(path, text);
    await expect(openWith(path)).resolves.toEqual(expect.objectContaining({ message: expect.stringContaining(path) }));
  });

  it('fails with the path of a build file whose option is relative', async () => {
    await expect(openWith('build.json')).resolves.toEqual(expect.objectContaining({ message: expect.stringContaining('build.json') }));
  });

  it('opens with the fixture build file', async () => {
    await expect(openWith(`${FIXTURES}build.json`)).resolves.toBeNull();
  });
});

describe('the build member of a JSON response (HY-128)', () => {
  it('holds the build id right after params in a document JSON response', async () => {
    const response = await new Fixture().get('/', { Accept: 'application/vnd.hyper+json' });
    expect(response.status).toBe(200);
    expect(response.body.startsWith(`{"env":{"timezone":"+09:00"},"route":"home","params":{},"build":"${ONES}","shared":`)).toBe(true);
  });

  it('holds the build id right after params in a region JSON response', async () => {
    const response = await new Fixture().get('/', JSON_REGION);
    expect(response.status).toBe(200);
    expect(response.body.startsWith(`{"env":{"timezone":"+09:00"},"route":"home","params":{},"build":"${ONES}","shared":`)).toBe(true);
  });
});
