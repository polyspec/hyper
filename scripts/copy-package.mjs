// Writes the copy of a package directory of this repository that an application of this repository installs, so that
// a package manager installs a copy and not a symbolic link (HY-79): the files that Git tracks below the directory, as
// the working tree holds them, without the dependencies, caches and build outputs of the package. The copy is written
// into a staging directory of this process and published file by file (scripts/publish.mjs, HY-82), so a reader never
// finds a file missing.
//
// Usage: node scripts/copy-package.mjs --path packages/hyper-php --output var/products/hyper-php
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { publish, staging } from './publish.mjs';
import { copyTracked } from './tracked-files.mjs';

const { values } = parseArgs({ options: { path: { type: 'string' }, output: { type: 'string' } } });
if (!values.path || !values.output) throw new Error('--path and --output are required');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(values.output);
const next = staging(output);
rmSync(next, { recursive: true, force: true });
const { files, deleted } = copyTracked({ repository, path: values.path, target: next, base: values.path });
publish(next, output, { last: ['composer.json'] });
console.log(`package copy: copied ${values.path} to ${output} (${files.length} files${deleted.length > 0 ? `; not copied, deleted in the working tree: ${deleted.join(' ')}` : ''})`);
