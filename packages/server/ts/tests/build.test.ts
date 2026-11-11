// The build file option of App.open (HY-48.11) and the member build of every JSON response (HY-128); contracts/build.json
// holds the cases of the build id that the file gives (HY-125).
import { describe, expect, it } from 'vitest';
import { App } from '../src/index.js';
import { Fixture, FIXTURES, handlers, JSON_REGION, TEMPLATES } from './support.js';

const ONES = '1'.repeat(64);

// Opens the fixture application with the given build file and returns the rejection of open (HY-125).
async function openWith(build: string): Promise<unknown> {
  return App.open({ manifest: `${FIXTURES}app.json`, build, templates: TEMPLATES, handlers: handlers(), timezone: 'Z' }).then(
    () => null,
    (error: unknown) => error,
  );
}

describe('App.open takes the build file by an absolute path (HY-48.11)', () => {
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
