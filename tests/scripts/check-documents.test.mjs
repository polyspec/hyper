// Tests the checklist rule of scripts/check-documents.mjs: a task state marker appears in the execution checklist
// only as the state of a task row, at the start of its last cell. Every other marker fails with its file, line and
// column. The checks run in a temporary directory that holds only the two checklists.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'scripts/check-documents.mjs');

const STRAY = `# Execution checklist

- The last column of every task row is its state: \`[ ]\` waiting, \`[~]\` in progress.

| ID | Task | Verification | Status |
|---|---|---|---|
| H1.1 | Mark the task \`[o]\` when it is done | \`make docs-check\` | [o] |
| H1.2 | Keep this task in progress | \`make docs-check\` | [~] |
| H1.3 | Bypass this task | \`make docs-check\` | [!] cause: H1.2 is [~]; retry: H1.2 done |
| Note | A row that is not a task | none | [o] |
| H1.4 | Close the task with \`[X]\` | \`make docs-check\` | [o] |
- [x] H1.5 Close the task in the task list form
`;

const PROSE = `# Execution checklist

[한국어](execution-checklist.ko.md).

This document lists the planned tasks.

## How to use

- Task ID format: \`H<wave>.<number>\`.

## Wave 1 — Write the tasks

Depends on: none.

| ID | Task | Verification | Status |
|---|---|---|---|
| H1.1 | Write the task | \`make docs-check\` | [o] |
| Note | A row that is not a task | none | none |

| A table | without a separator |
`;

const CLEAN = `# Execution checklist

| ID | Task | Verification | Status |
|---|---|---|---|
| H1.1 | Mark the task done when its command passed | \`make docs-check\` | [o] |
| H1.2 | Keep this task in progress | \`make docs-check\` | [~] |
| H1.2-1 | Wait for H1.2 | \`make docs-check\` | [ ] |
| H1.3 | Bypass this task | \`make docs-check\` | [!] cause: H1.2 is in progress; retry: H1.2 done |
`;

// Runs the document check in a directory that holds `text` as both checklists.
function check(t, text) {
  const directory = mkdtempSync(path.join(tmpdir(), 'hyper-check-documents-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(path.join(directory, 'docs/plans'), { recursive: true });
  for (const name of ['execution-checklist.md', 'execution-checklist.ko.md']) writeFileSync(path.join(directory, 'docs/plans', name), text);
  return spawnSync(process.execPath, [SCRIPT], { cwd: directory, encoding: 'utf8' });
}

test('a state marker outside a task state fails with its file, line and column', (t) => {
  const run = check(t, STRAY);
  const expected = ['docs/plans/execution-checklist.md', 'docs/plans/execution-checklist.ko.md'].flatMap((file) =>
    [['3:52', '[ ]'], ['3:67', '[~]'], ['7:25', '[o]'], ['9:68', '[~]'], ['10:44', '[o]'], ['11:31', '[X]'], ['12:3', '[x]']].map(
      ([location, marker]) => `${file}:${location}: state marker ${marker} outside a task state; a checklist marker appears only as the state of a task row`,
    ),
  );
  assert.deepEqual(run.stderr.split('\n').filter((line) => line.includes('state marker')), expected);
  assert.equal(run.status, 1);
});

test('a line that is not a task row, a table header or a heading fails with its file, line and column', (t) => {
  const run = check(t, PROSE);
  const expected = ['docs/plans/execution-checklist.md', 'docs/plans/execution-checklist.ko.md'].flatMap((file) =>
    ['3:1', '5:1', '9:1', '13:1', '18:1', '20:1'].map(
      (location) => `${file}:${location}: text outside a task row; a checklist holds only task rows, their table headers and headings`,
    ),
  );
  assert.deepEqual(run.stderr.split('\n').filter(Boolean), expected);
  assert.equal(run.status, 1);
});

test('markers only as task states pass', (t) => {
  const run = check(t, CLEAN);
  assert.equal(run.stderr, '');
  assert.equal(run.status, 0, run.stdout);
});
