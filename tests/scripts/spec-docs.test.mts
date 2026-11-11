// The protocol document generator (scripts/spec-docs.mts) over a fixture contract: write renders the expected bytes, check
// fails on any byte difference, and each broken contract fails both modes with the finding that names it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const fixture = path.join(here, 'fixtures', 'spec-docs');
const script = path.join(repo, 'scripts', 'spec-docs.mts');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A fresh root with the fixture contract, and the expected documents in docs/spec when `docs` is set. */
function makeRoot(options: { docs?: boolean; contract?: (j: Json) => void } = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'spec-docs-'));
  roots.push(root);
  mkdirSync(path.join(root, 'contracts'));
  cpSync(path.join(fixture, 'contracts', 'protocol.json'), path.join(root, 'contracts', 'protocol.json'));
  if (options.contract) {
    const file = path.join(root, 'contracts', 'protocol.json');
    const json = JSON.parse(readFileSync(file, 'utf8')) as Json;
    options.contract(json);
    writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  }
  if (options.docs) {
    mkdirSync(path.join(root, 'docs', 'spec'), { recursive: true });
    for (const name of ['protocol.md', 'protocol.ko.md']) {
      cpSync(path.join(fixture, 'expected', name), path.join(root, 'docs', 'spec', name));
    }
  }
  return root;
}

function run(mode: 'write' | 'check', root: string): { status: number | null; stderr: string } {
  const result = spawnSync(process.execPath, [script, mode, '--root', root], { encoding: 'utf8' });
  return { status: result.status, stderr: result.stderr };
}

function assertFails(result: { status: number | null; stderr: string }, messages: string[]): void {
  assert.equal(result.status, 1, result.stderr);
  for (const message of messages) assert.ok(result.stderr.includes(message), `missing "${message}" in:\n${result.stderr}`);
}

function docBytes(root: string, name: string): string {
  return readFileSync(path.join(root, 'docs', 'spec', name), 'utf8');
}

const expectedEn = readFileSync(path.join(fixture, 'expected', 'protocol.md'), 'utf8');
const expectedKo = readFileSync(path.join(fixture, 'expected', 'protocol.ko.md'), 'utf8');

test('write renders the fixture to the expected bytes', () => {
  const root = makeRoot();
  const result = run('write', root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(docBytes(root, 'protocol.md'), expectedEn);
  assert.equal(docBytes(root, 'protocol.ko.md'), expectedKo);
});

test('write is deterministic: a second run writes the same bytes', () => {
  const root = makeRoot();
  run('write', root);
  const first = docBytes(root, 'protocol.ko.md');
  assert.equal(run('write', root).status, 0);
  assert.equal(docBytes(root, 'protocol.ko.md'), first);
});

test('check passes when the documents equal their generation', () => {
  const root = makeRoot({ docs: true });
  const result = run('check', root);
  assert.equal(result.status, 0, result.stderr);
});

test('check fails on one changed byte and names the line', () => {
  const root = makeRoot({ docs: true });
  const file = path.join(root, 'docs', 'spec', 'protocol.md');
  const text = readFileSync(file, 'utf8');
  assert.equal(text.split('## Table').length, 2);
  writeFileSync(file, text.replace('## Table', '## Tables'));
  assertFails(run('check', root), ['docs/spec/protocol.md differs from its generation at line']);
});

test('check fails when a document is missing', () => {
  const root = makeRoot();
  assertFails(run('check', root), ['docs/spec/protocol.md']);
});

test('an unknown block kind fails the schema at its path', () => {
  const root = makeRoot({
    contract: (j) => {
      j.sections[2].blocks[0].kind = 'quote';
    },
  });
  assertFails(run('write', root), ['/sections/2/blocks/0/kind']);
});

test('a stale koSource names the statement and the sha256 of its en', () => {
  const en = 'A rule states one sentence.';
  const sha = createHash('sha256').update(en, 'utf8').digest('hex');
  const root = makeRoot({
    contract: (j) => {
      j.sections[1].blocks[0].blocks[0].statements[0].en = en;
    },
  });
  assertFails(run('check', root), ['HY-1.1', 'koSource is stale', sha]);
});

test('a duplicate rule id fails', () => {
  const root = makeRoot({
    contract: (j) => {
      j.sections[1].blocks[1].id = 'HY-1';
    },
  });
  assertFails(run('write', root), ['duplicate rule id HY-1']);
});

test('a duplicate statement id fails and leaves a numbering gap', () => {
  const root = makeRoot({
    contract: (j) => {
      j.sections[1].blocks[0].blocks[0].statements[1].id = 'HY-1.1';
    },
  });
  assertFails(run('write', root), ['duplicate statement id HY-1.1', 'numbering gap in HY-1: 3']);
});

test('an unused number that is not retired is a numbering gap', () => {
  const root = makeRoot({
    contract: (j) => {
      j.sections[1].blocks[0].retired = [];
    },
  });
  assertFails(run('write', root), ['numbering gap in HY-1: 2']);
});

test('a statement number that is also retired fails', () => {
  const root = makeRoot({
    contract: (j) => {
      j.sections[1].blocks[0].retired = [1, 2];
    },
  });
  assertFails(run('write', root), ['statement id HY-1.1 is used and retired']);
});

test('a rule listed in retiredRules fails', () => {
  const root = makeRoot({
    contract: (j) => {
      j.retiredRules = ['HY-2'];
    },
  });
  assertFails(run('write', root), ['HY-2 is a rule and in retiredRules']);
});

test('an English statement of two sentences fails', () => {
  const root = makeRoot({
    contract: (j) => {
      j.sections[1].blocks[1].blocks[0].statements[0].en = 'The second rule has one statement. It has two.';
    },
  });
  assertFails(run('write', root), ['HY-2.1 is 2 sentences']);
});

test('write leaves the documents untouched when the contract is broken', () => {
  const root = makeRoot({
    contract: (j) => {
      j.sections[1].blocks[1].id = 'HY-1';
    },
  });
  assertFails(run('write', root), ['duplicate rule id HY-1']);
  assert.equal(existsSync(path.join(root, 'docs', 'spec', 'protocol.md')), false);
});
