// The protocol document generator (scripts/spec-docs.mts) over a fixture contract: write renders the expected bytes, check
// fails on any byte difference, and each broken contract fails both modes with the finding that names it.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { assertFails, runScript, type ScriptResult } from './script-run.mts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const fixture = path.join(here, 'fixtures', 'spec-docs');
const script = path.join(repo, 'scripts', 'spec-docs.mts');

/** Sets the value at a path of the contract. */
type Edit = (at: (string | number)[], value: unknown) => void;

/** Sets the value at a path of a parsed JSON document; a step that is missing fails the test. */
function setAt(root: unknown, at: (string | number)[], value: unknown): void {
  const last = at.at(-1);
  if (last === undefined) throw new Error('the path of a value names no step');
  let node: unknown = root;
  for (const step of at.slice(0, -1)) {
    const next: unknown = typeof step === 'number' ? (Array.isArray(node) ? node[step] : undefined) : typeof node === 'object' && node !== null && !Array.isArray(node) ? Reflect.get(node, step) : undefined;
    if (next === undefined) throw new Error(`the contract has no ${at.join('/')}`);
    node = next;
  }
  const holds = typeof last === 'number' ? Array.isArray(node) : typeof node === 'object' && node !== null && !Array.isArray(node);
  if (!holds || typeof node !== 'object' || node === null) throw new Error(`the contract has no ${at.join('/')}`);
  Reflect.set(node, last, value);
}

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A fresh root with the fixture contract, and the expected documents in docs/spec when `docs` is set. */
function makeRoot(options: { docs?: boolean; contract?: (edit: Edit) => void; files?: Record<string, string> } = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'spec-docs-'));
  roots.push(root);
  mkdirSync(path.join(root, 'contracts'));
  cpSync(path.join(fixture, 'contracts', 'protocol.json'), path.join(root, 'contracts', 'protocol.json'));
  if (options.contract) {
    const file = path.join(root, 'contracts', 'protocol.json');
    const json: unknown = JSON.parse(readFileSync(file, 'utf8'));
    options.contract((at, value) => { setAt(json, at, value); });
    writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  }
  for (const [name, text] of Object.entries(options.files ?? {})) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), text);
  }
  if (options.docs) {
    mkdirSync(path.join(root, 'docs', 'spec'), { recursive: true });
    for (const name of ['protocol.md', 'protocol.ko.md']) {
      cpSync(path.join(fixture, 'expected', name), path.join(root, 'docs', 'spec', name));
    }
  }
  return root;
}

function run(mode: 'write' | 'check', root: string): ScriptResult {
  return runScript(script, [mode, '--root', root]);
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
    contract: (edit) => { edit(['sections', 2, 'blocks', 0, 'kind'], 'quote'); },
  });
  assertFails(run('write', root), ['/sections/2/blocks/0/kind']);
});

test('a stale koSource names the statement and the sha256 of its en', () => {
  const en = 'A rule states one sentence.';
  const sha = createHash('sha256').update(en, 'utf8').digest('hex');
  const root = makeRoot({
    contract: (edit) => { edit(['sections', 1, 'blocks', 0, 'blocks', 0, 'statements', 0, 'en'], en); },
  });
  assertFails(run('check', root), ['HY-1.1', 'koSource is stale', sha]);
});

/** A root whose contract names the rule id HY-1 twice. */
function duplicateRuleRoot(): string {
  return makeRoot({
    contract: (edit) => { edit(['sections', 1, 'blocks', 1, 'id'], 'HY-1'); },
  });
}

test('a duplicate rule id fails', () => {
  const root = duplicateRuleRoot();
  assertFails(run('write', root), ['duplicate rule id HY-1']);
});

test('a duplicate statement id fails and leaves a numbering gap', () => {
  const root = makeRoot({
    contract: (edit) => { edit(['sections', 1, 'blocks', 0, 'blocks', 0, 'statements', 1, 'id'], 'HY-1.1'); },
  });
  assertFails(run('write', root), ['duplicate statement id HY-1.1', 'numbering gap in HY-1: 3']);
});

test('an unused number that is not retired is a numbering gap', () => {
  const root = makeRoot({
    contract: (edit) => { edit(['sections', 1, 'blocks', 0, 'retired'], []); },
  });
  assertFails(run('write', root), ['numbering gap in HY-1: 2']);
});

test('a statement number that is also retired fails', () => {
  const root = makeRoot({
    contract: (edit) => { edit(['sections', 1, 'blocks', 0, 'retired'], [1, 2]); },
  });
  assertFails(run('write', root), ['statement id HY-1.1 is used and retired']);
});

test('a rule listed in retiredRules fails', () => {
  const root = makeRoot({
    contract: (edit) => { edit(['retiredRules'], ['HY-2']); },
  });
  assertFails(run('write', root), ['HY-2 is a rule and in retiredRules']);
});

test('an English statement of two sentences fails', () => {
  const root = makeRoot({
    contract: (edit) => { edit(['sections', 1, 'blocks', 1, 'blocks', 0, 'statements', 0, 'en'], 'The second rule has one statement. It has two.'); },
  });
  assertFails(run('write', root), ['HY-2.1 is 2 sentences']);
});

// The mark of a statement that no code follows (H35.40): the statement HY-2.1 of the fixture holds the row of the
// checklist that implements it, and a row of the feature status names the statement as not implemented.
const HY_2_1 = ['sections', 1, 'blocks', 1, 'blocks', 0, 'statements', 0];
const CHECKLIST = 'docs/plans/execution/checklist.md';
const FEATURES = 'docs/features.md';
const checklist = (state: string): string => `# Checklist\n\n| ID | Task | Deliverables | Verification | State |\n|---|---|---|---|---|\n| H9.1 | A task | — | \`make x\` | ${state} |\n`;
const features = (status: string): string => `# Feature status\n\n| ID | Feature | Status | Evidence |\n|---|---|---|---|\n| second-rule | The second rule (HY-2.1) | ${status} | — |\n`;
const marked = (row: string) => (edit: Edit): void => { edit([...HY_2_1, 'unimplemented'], row); };

test('a marked statement renders with the phrase of each language and its row (H35.40)', () => {
  const root = makeRoot({ contract: marked('H9.1'), files: { [CHECKLIST]: checklist('[ ]'), [FEATURES]: features('not implemented: no code follows it (H9.1)') } });
  const result = run('write', root);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(docBytes(root, 'protocol.md').includes('<a id="HY-2.1"></a> The second rule has one statement. *(Not implemented: row H9.1.)*'), docBytes(root, 'protocol.md'));
  assert.ok(docBytes(root, 'protocol.ko.md').includes(' *(구현되지 않음: 행 H9.1.)*'), docBytes(root, 'protocol.ko.md'));
  assert.equal(run('check', root).status, 0);
});

// The per-server form of a mark (H35.40-2): a list of rows, each with the servers that do not meet the statement.
const checklistOf = (rows: string[]): string => `# Checklist\n\n| ID | Task | Deliverables | Verification | State |\n|---|---|---|---|---|\n${rows.map((row) => `| ${row} | A task | — | \`make x\` | [ ] |\n`).join('')}`;

test('a mark per server renders each row with the servers that do not meet the statement (H35.40-2)', () => {
  const root = makeRoot({
    contract: (edit) => { edit([...HY_2_1, 'unimplemented'], [{ row: 'H9.1', servers: ['php'] }, { row: 'H9.2', servers: ['node', 'python'] }]); },
    files: { [CHECKLIST]: checklistOf(['H9.1', 'H9.2']), [FEATURES]: features('not implemented: no code follows it (H9.1, H9.2)') },
  });
  const result = run('write', root);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(docBytes(root, 'protocol.md').includes('The second rule has one statement. *(Not implemented in PHP: row H9.1; in Node and Python: row H9.2.)*'), docBytes(root, 'protocol.md'));
  assert.ok(docBytes(root, 'protocol.ko.md').includes(' *(구현되지 않음: PHP는 행 H9.1, Node와 Python은 행 H9.2.)*'), docBytes(root, 'protocol.ko.md'));
  assert.equal(run('check', root).status, 0);
});

test('a mark per server whose row the checklist does not hold fails (H35.40-2)', () => {
  const root = makeRoot({
    contract: (edit) => { edit([...HY_2_1, 'unimplemented'], [{ row: 'H9.3', servers: ['php'] }]); },
    files: { [CHECKLIST]: checklistOf(['H9.1']), [FEATURES]: features('not implemented: no code follows it (H9.3)') },
  });
  assertFails(run('write', root), ['HY-2.1: the row H9.3 of its mark is no row of docs/plans/execution/checklist.md']);
});

test('a mark per server that names a server twice fails (H35.40-2)', () => {
  const root = makeRoot({
    contract: (edit) => { edit([...HY_2_1, 'unimplemented'], [{ row: 'H9.1', servers: ['php'] }, { row: 'H9.2', servers: ['php'] }]); },
    files: { [CHECKLIST]: checklistOf(['H9.1', 'H9.2']), [FEATURES]: features('not implemented: no code follows it (H9.1)') },
  });
  assertFails(run('write', root), ['HY-2.1: its mark names the server php twice']);
});

test('a mark that names a row which the checklist does not hold fails (H35.40)', () => {
  const root = makeRoot({ contract: marked('H9.2'), files: { [CHECKLIST]: checklist('[ ]'), [FEATURES]: features('not implemented: no code follows it (H9.2)') } });
  assertFails(run('write', root), ['HY-2.1: the row H9.2 of its mark is no row of docs/plans/execution/checklist.md']);
});

test('a mark whose row is done or verified fails, so that the mark goes with the row (H35.40)', () => {
  for (const state of ['[o]', '[v]']) {
    const root = makeRoot({ contract: marked('H9.1'), files: { [CHECKLIST]: checklist(state), [FEATURES]: features('not implemented: no code follows it (H9.1)') } });
    assertFails(run('write', root), [`HY-2.1: the row H9.1 of its mark has the state ${state}; remove the mark`]);
  }
});

test('a row of the feature status that names a statement as not implemented fails without the mark of the statement (H35.40)', () => {
  const root = makeRoot({ files: { [CHECKLIST]: checklist('[ ]'), [FEATURES]: features('not implemented: no code follows it (H9.1)') } });
  assertFails(run('check', root), ['docs/features.md: the row second-rule names HY-2.1 as not implemented, and the statement holds no mark']);
});

test('a marked statement that no row of the feature status names as not implemented fails (H35.40)', () => {
  const root = makeRoot({ contract: marked('H9.1'), files: { [CHECKLIST]: checklist('[ ]'), [FEATURES]: features('implemented') } });
  assertFails(run('write', root), ['HY-2.1 holds a mark, and no row of docs/features.md with the status not implemented names it']);
});

test('a mark on a statement without an id fails (H35.40)', () => {
  const root = makeRoot({
    contract: (edit) => { edit(['intro', 0, 'statements', 0, 'unimplemented'], 'H9.1'); },
    files: { [CHECKLIST]: checklist('[ ]'), [FEATURES]: features('implemented') },
  });
  assertFails(run('write', root), ['holds a mark and no id']);
});

test('a mark on a retired number fails as a number that is used and retired (H35.40)', () => {
  const root = makeRoot({
    contract: (edit) => {
      edit([...HY_2_1, 'unimplemented'], 'H9.1');
      edit(['sections', 1, 'blocks', 1, 'retired'], [1]);
    },
    files: { [CHECKLIST]: checklist('[ ]'), [FEATURES]: features('not implemented: no code follows it (H9.1)') },
  });
  assertFails(run('write', root), ['statement id HY-2.1 is used and retired']);
});

test('write leaves the documents untouched when the contract is broken', () => {
  const root = duplicateRuleRoot();
  assertFails(run('write', root), ['duplicate rule id HY-1']);
  assert.equal(existsSync(path.join(root, 'docs', 'spec', 'protocol.md')), false);
});
