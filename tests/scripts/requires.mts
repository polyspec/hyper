// The inputs that a test reads and does not create (HR-85): a build or an install of another target. A test names
// them with requireBuilt before it reads them, so a missing input fails with its path and the target that makes it,
// not with an error of the tool that reads it.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Fails unless every path of `paths`, relative to the checkout, exists; names the make target that writes them. */
export function requireBuilt(target: string, ...paths: string[]): void {
  const missing = paths.filter((file) => !existsSync(path.resolve(ROOT, file)));
  assert.deepEqual(missing, [], `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing; \`make ${target}\` writes ${missing.length === 1 ? 'it' : 'them'}; run it before \`make hyper-test-scripts\``);
}

/**
 * The PHP extensions that a PHP server of a test loads, in their order: the json, the template and the hyper extension
 * (HY-48.15, HY-132.2). `make hyper-test-scripts` passes them in HYPER_PHP_EXTENSIONS, from PHP_SERVER_EXTENSIONS of the
 * Makefile, which also decides whether the template extension is the linked one; each must exist.
 */
export function phpServerExtensions(): string[] {
  const value = process.env.HYPER_PHP_EXTENSIONS ?? '';
  const extensions = value.split(' ').filter((file) => file !== '');
  assert.notDeepEqual(extensions, [], 'HYPER_PHP_EXTENSIONS names no PHP extension; `make hyper-test-scripts` sets it from PHP_SERVER_EXTENSIONS');
  requireBuilt('ext hyper-ext', ...extensions);
  return extensions;
}
