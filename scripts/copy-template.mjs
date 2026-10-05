// Writes the declared copy of the template repository that this repository reads (HY-78): the build scripts
// (`--template-dir`), npm, Composer, PHPStan and the native extension build read the copy and never the checkout of
// the template repository, whose builds another process may write again at any time.
//
// The copy has the layout of the template repository and holds:
//   packages/template-ts       the files that `npm pack` packs from the built TypeScript package, without its scripts
//   packages/template-php      the PHP package
//   packages/template-php-ext  the native extension and the Rust crate packages/template-rust that it builds from
//   packages/template-rust
//   tools/compiler             the compiler of the generated programs and contracts/functions.json that it reads
// Every path except packages/template-ts takes the files that Git lists as tracked and that the working tree holds,
// with their modification times, so that cargo builds the extension again only when its sources change. The copy is
// written next to its target and then replaces it. A missing build of the TypeScript package fails the copy and
// names the command of the template repository that builds it; this script builds nothing in the template repository.
//
// Usage: node scripts/copy-template.mjs --repository ../template --output var/products/template
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { copyTracked, git } from './tracked-files.mjs';

const TRACKED = ['packages/template-php', 'packages/template-php-ext', 'packages/template-rust', 'tools/compiler', 'contracts/functions.json'];
const TYPESCRIPT = 'packages/template-ts';

const { values } = parseArgs({ options: { repository: { type: 'string' }, output: { type: 'string' } } });
if (!values.repository || !values.output) throw new Error('--repository and --output are required');
const repository = resolve(values.repository);
const output = resolve(values.output);
const next = `${output}.next`;

const commit = git(repository, 'rev-parse', 'HEAD').trim();
console.log(`template copy: ${repository} at ${commit} -> ${output}`);
rmSync(next, { recursive: true, force: true });

// The TypeScript package: the files that npm packs, which name its build.
const typescript = join(repository, TYPESCRIPT);
const manifest = JSON.parse(readFileSync(join(typescript, 'package.json'), 'utf8'));
const exported = Object.values(manifest.exports ?? {}).flatMap((entry) => Object.values(entry)).map((path) => join(typescript, path));
const missing = exported.filter((path) => !existsSync(path));
if (missing.length > 0) {
  throw new Error(`${typescript} has no build: ${missing.join(', ')} missing; build it in the template repository with \`make build-ts\``);
}
const packed = mkdtempSync(join(tmpdir(), 'hyper-template-pack-'));
try {
  const [{ filename, files }] = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', packed], { cwd: typescript, encoding: 'utf8' }));
  const target = join(next, TYPESCRIPT);
  mkdirSync(target, { recursive: true });
  execFileSync('tar', ['-x', '-f', join(packed, filename), '-C', target, '--strip-components', '1']);
  console.log(`template copy: packed ${TYPESCRIPT} (${files.length} files)`);
} finally {
  rmSync(packed, { recursive: true, force: true });
}

// The tracked paths, as the working tree holds them.
for (const path of TRACKED) {
  const { files, deleted } = copyTracked({ repository, path, target: next });
  console.log(`template copy: copied ${path} (${files.length} files${deleted.length > 0 ? `; not copied, deleted in the working tree: ${deleted.join(' ')}` : ''})`);
}

mkdirSync(dirname(output), { recursive: true });
rmSync(output, { recursive: true, force: true });
renameSync(next, output);
console.log(`template copy: wrote ${output}`);
