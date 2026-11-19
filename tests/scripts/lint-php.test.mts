// lint-php reads the PHP symbol extractor that install-symbols writes; without it the target names that install (HR-85, H35.122).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CALLER = ['MAKEFLAGS', 'MFLAGS', 'MAKELEVEL', 'MAKEOVERRIDES'];

test('lint-php fails with the install that writes the symbol extractor it reads, when that extractor is missing (HR-85, H35.122)', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-lint-php-'));
  try {
    const autoload = path.join(directory, 'vendor/autoload.php');
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !CALLER.includes(name)));
    const result = spawnSync('make', ['--no-print-directory', 'lint-php', `PHP_SYMBOLS_AUTOLOAD=${autoload}`], { cwd: ROOT, encoding: 'utf8', env });
    const output = `${result.stdout}${result.stderr}`;
    assert.notEqual(result.status, 0, 'lint-php passes without its symbol extractor');
    assert.ok(output.includes(`${autoload} is missing`), `expected the missing-file line for ${autoload}; output:\n${output}`);
    assert.ok(output.includes('make install-symbols'), `expected the failure to name make install-symbols; output:\n${output}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
