// Tests that Composer installs each polyspec package of this checkout that its path repository provides as a symbolic
// link to the source directory of that package (HY-79). The root and the board are the Composer projects that declare
// such a path repository. A real directory copy of such a package fails and is named. Third-party packages of a vendor
// are not checked. Run it after `make hyper-install`.
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

// A JSON object of a Composer manifest, read as unknown and checked by each field that the test uses.
function readManifest(file: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${file} holds no JSON object`);
  return { ...value };
}

function isPathRepository(value: unknown): value is { type: 'path'; url: string } {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'path' && 'url' in value && typeof value.url === 'string';
}

// Returns each package of the path repositories of `project`, with its name and the directory that holds its source.
function pathPackages(project: string): PathPackage[] {
  const repositories = readManifest(join(repository, project, 'composer.json')).repositories;
  if (!Array.isArray(repositories)) return [];
  return repositories
    .filter(isPathRepository)
    .map((repo) => {
      const source = resolve(repository, project, repo.url);
      const name = readManifest(join(source, 'composer.json')).name;
      if (typeof name !== 'string') throw new Error(`${source}/composer.json has no name`);
      return { name, source };
    });
}

test('each polyspec package of a vendor is a symbolic link to its source directory', () => {
  const packages = projects.flatMap((project) => pathPackages(project).map((pkg) => ({ project, ...pkg })));
  assert.ok(packages.length > 0, 'no path repository of a polyspec package is declared');
  requireBuilt('hyper-install', ...packages.map((pkg) => join(pkg.project, 'vendor', pkg.name)));

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
