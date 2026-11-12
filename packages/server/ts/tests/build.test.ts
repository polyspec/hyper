// The build file option of App.open (HY-48.11); contracts/build.json holds the cases of the build id that the file gives
// (HY-125), and contracts/app.json those of the member build of a JSON response (HY-128).
import { describe, expect, it } from 'vitest';
import { App } from '../src/index.js';
import { FIXTURES, handlers, TEMPLATES } from './support.js';

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
});
