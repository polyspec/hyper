// Tests that Composer installs each polyspec package of this checkout that its path repository provides as a symbolic
// link to the source directory of that package (HY-79). The root and the board are the Composer projects that declare
// such a path repository. A real directory copy of such a package fails and is named. Third-party packages of a vendor
// are not checked. Run it after `make install`.
import assert from 'node:assert/strict';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { requireBuilt } from './requires.mts';

const repository = resolve('.');
// The Composer projects of the checkout that declare a path repository of a polyspec package (HY-79).
const projects = ['.', 'examples/board'];

interface PathPackage {
  name: string;
  source: string;
}

// Returns each package of the path repositories of `project`, with its name and the directory that holds its source.
function pathPackages(project: string): PathPackage[] {
  const manifest = JSON.parse(readFileSync(join(repository, project, 'composer.json'), 'utf8')) as {
    repositories?: { type: string; url: string }[];
  };
  return (manifest.repositories ?? [])
    .filter((repo) => repo.type === 'path')
    .map((repo) => {
      const source = resolve(repository, project, repo.url);
      const sourceManifest = JSON.parse(readFileSync(join(source, 'composer.json'), 'utf8')) as { name: string };
      return { name: sourceManifest.name, source };
    });
}

test('each polyspec package of a vendor is a symbolic link to its source directory', () => {
  const packages = projects.flatMap((project) => pathPackages(project).map((pkg) => ({ project, ...pkg })));
  assert.ok(packages.length > 0, 'no path repository of a polyspec package is declared');
  requireBuilt('install', ...packages.map((pkg) => join(pkg.project, 'vendor', pkg.name)));

  const failures: string[] = [];
  for (const pkg of packages) {
    const link = join(repository, pkg.project, 'vendor', pkg.name);
    const shown = relative(repository, link);
    if (!lstatSync(link).isSymbolicLink()) {
      failures.push(`${shown} is a directory copy; it must be a symbolic link to ${relative(repository, pkg.source)}`);
    } else if (realpathSync(link) !== realpathSync(pkg.source)) {
      failures.push(`${shown} links to ${realpathSync(link)}; it must link to ${realpathSync(pkg.source)}`);
    }
  }
  assert.deepEqual(failures, []);
});
