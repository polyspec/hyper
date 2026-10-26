// The server benchmark reports the generated PHP program and extension state without PHP warnings (HY-48, HR-84).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { requireBuilt } from './requires.mts';

test('the server benchmark reports its program without PHP warnings and removes its database', (t) => {
  requireBuilt('assets', 'examples/board/build/manifest.json');
  requireBuilt('server', 'examples/board/build/server/program.json');
  requireBuilt('hyper-install', 'examples/board/vendor/autoload.php');
  const app = mkdtempSync(join(tmpdir(), 'hyper-benchmark-'));
  t.after(() => rmSync(app, { recursive: true, force: true }));
  cpSync('examples/board/app', join(app, 'app'), { recursive: true });
  cpSync('examples/board/build', join(app, 'build'), { recursive: true });
  mkdirSync(join(app, 'var'));
  mkdirSync(join(app, 'vendor'));
  writeFileSync(join(app, 'vendor/autoload.php'), `<?php require ${JSON.stringify(resolve('examples/board/vendor/autoload.php'))};\n`);
  const result = spawnSync('php', ['-d', 'error_reporting=32767', '-d', 'display_errors=stderr', 'benchmarks/server.php', '--app', app, '--iterations', '1'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '', result.stderr);
  assert.match(result.stdout, /generated PHP template program, template extension (?:loaded|not loaded), 1 iterations per request/);
  assert.match(result.stdout, /GET \/board, document HTML \| 200/);
  assert.equal(existsSync(join(app, 'var/bench-server.db')), false);
});
