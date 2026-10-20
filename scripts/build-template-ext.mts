#!/usr/bin/env node
// Builds the native template extension from the php-ext archive of the template release (H14.1-7, H23.11-2):
//
//   node scripts/build-template-ext.mts <library>   build the unpacked php-ext sources with phpize, configure and make into <library>
//
// config/release-assets.json pins the archive, and `make hyper-install` downloads it and unpacks it into var/products/template-ext
// with make release-assets-fetch of kit (K140). The build reads only that directory and the PHP of PATH: it builds again
// only when the sources or the PHP build changed, and publishes the library with a rename (HR-82).
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsonObjects, parseJsonObject } from './json.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'usage: node scripts/build-template-ext.mts <library>';

/** The unpack directory of the entry template-php-ext of config/release-assets.json, which make release-assets-fetch writes. */
function unpacked(): string {
  const file = 'config/release-assets.json';
  const assets = jsonObjects(parseJsonObject(readFileSync(path.join(ROOT, file), 'utf8'), file).assets, `${file} assets`);
  const unpack = assets.find(({ name }) => name === 'template-php-ext')?.unpack;
  if (typeof unpack !== 'string') throw new Error('config/release-assets.json declares no entry template-php-ext with unpack');
  return path.join(ROOT, unpack);
}
// The sources that the build reads: the C files, the headers, config.m4 and the stub.
const sourceNames = (source: string): string[] => readdirSync(source).filter((name) => /\.(c|h)$/.test(name) || name === 'config.m4' || name.endsWith('.stub.php')).sort();

function run(command: string, args: string[], options: { cwd: string }): void {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error || result.status !== 0) throw new Error(`${[command, ...args].join(' ')} failed with ${result.error?.message ?? `exit ${result.status}`}`);
}

const capture = (command: string, args: string[]): string => execFileSync(command, args, { encoding: 'utf8' }).trim();

/** Builds the unpacked asset into `library` when its sources or the PHP build changed, publishing it with a rename. */
export function buildExtension(library: string): void {
  const source = path.join(unpacked(), 'src');
  if (!existsSync(path.join(source, 'config.m4'))) throw new Error(`${path.relative(ROOT, source)} holds no unpacked php-ext sources; run make hyper-install, which fetches and unpacks the archive template-php-ext of config/release-assets.json`);
  const php = capture('php', ['-r', 'echo PHP_VERSION;']);
  const config = capture('php-config', ['--version']);
  if (php !== config) throw new Error(`php-config of PATH is PHP ${config}, but php of PATH is PHP ${php}; the tests load the extension into php, so both must be one PHP`);
  const hash = createHash('sha256');
  hash.update(JSON.stringify({ php, config: capture('php-config', ['--configure-options']) }));
  for (const name of sourceNames(source)) {
    hash.update(`\0${name}\0`);
    hash.update(readFileSync(path.join(source, name)));
  }
  const digest = hash.digest('hex');
  const stamp = `${library}.inputs.json`;
  if (existsSync(library) && existsSync(stamp) && parseJsonObject(readFileSync(stamp, 'utf8'), stamp).hash === digest) {
    console.log(`build-template-ext: ${library} is current for PHP ${php}`);
    return;
  }
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-template-ext-'));
  try {
    for (const name of sourceNames(source)) copyFileSync(path.join(source, name), path.join(directory, name));
    run('phpize', [], { cwd: directory });
    run('./configure', ['--with-php-config=php-config'], { cwd: directory });
    run('make', [], { cwd: directory });
    const name = /PHP_NEW_EXTENSION\(\[?(\w+)/.exec(readFileSync(path.join(source, 'config.m4'), 'utf8'))?.[1];
    if (!name) throw new Error(`${path.join(source, 'config.m4')} declares no PHP_NEW_EXTENSION`);
    mkdirSync(path.dirname(library), { recursive: true });
    const next = `${library}.next-${process.pid}`;
    copyFileSync(path.join(directory, 'modules', `${name}.so`), next);
    renameSync(next, library);
    writeFileSync(stamp, `${JSON.stringify({ hash: digest, php }, null, 2)}\n`);
    console.log(`build-template-ext: ${library} now holds the build of ${path.relative(ROOT, source)} for PHP ${php}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [library, ...rest] = process.argv.slice(2);
  if (library === undefined || rest.length > 0) {
    console.error(USAGE);
    process.exit(2);
  }
  try {
    buildExtension(path.resolve(library));
  } catch (error) {
    console.error(`build-template-ext: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
