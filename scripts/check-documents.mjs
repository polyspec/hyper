// Checks the documents of the repository: every English document has a Korean pair and the
// reverse, every relative link resolves, both documents of a pair contain the same code blocks, and
// every task of the execution checklist has one of the four task states of AGENTS, the same in both
// languages, a task state marker of the checklist appears only as the state of a task row, at the start of
// its last cell, and the checklist holds only headings and task tables.
//
// The documents are the Markdown files that Git tracks, so files that installs and builds leave in the checkout, such
// as the copies of var/ or the documentation of the npm of var/tools, never change the result.
//
// Usage: node scripts/check-documents.mjs

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const files = execFileSync('git', ['ls-files', '-z', '--', '*.md'], { encoding: 'utf8' }).split('\0').filter(Boolean).filter((file) => existsSync(file));
const problems = [];

for (const file of files) {
  const pair = file.endsWith('.ko.md') ? file.replace(/\.ko\.md$/, '.md') : file.replace(/\.md$/, '.ko.md');
  if (!existsSync(pair)) problems.push(`${file}: missing pair ${pair}`);
  const text = readFileSync(file, 'utf8');
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^[a-z]+:/.test(target) || target.startsWith('#')) continue;
    const path = join(dirname(file), target.split('#')[0]);
    if (!existsSync(path)) problems.push(`${file}: link ${target} does not resolve`);
  }
  if (!file.endsWith('.ko.md') && existsSync(pair)) {
    const english = codeBlocks(text);
    const korean = codeBlocks(readFileSync(pair, 'utf8'));
    if (JSON.stringify(english) !== JSON.stringify(korean)) problems.push(`${file}: code blocks differ from ${pair}`);
  }
}

const CHECKLIST = 'docs/plans/execution-checklist.md';
const TASK = /^\| H[0-9]+\.[0-9-]+ \|/;
const SEPARATOR = /^\|(\s*:?-{3,}:?\s*\|)+\s*$/;
for (const file of [CHECKLIST, CHECKLIST.replace(/\.md$/, '.ko.md')]) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    // The checklist holds blank lines, headings and task tables: a header row, its separator row and task rows.
    const header = line.startsWith('|') && SEPARATOR.test(lines[index + 1] ?? '');
    if (!(line.trim() === '' || /^#{1,6} /.test(line) || TASK.test(line) || SEPARATOR.test(line) || header)) {
      problems.push(`${file}:${index + 1}:${line.search(/\S/) + 1}: text outside a task row; a checklist holds only task rows, their table headers and headings`);
    }
    // The column of the state: the first character of the last cell of a task row.
    const end = line.trimEnd().length - 1;
    const cell = TASK.test(line) && line[end] === '|' ? line.lastIndexOf('|', end - 1) + 1 : -1;
    const state = cell < 0 ? -1 : cell + line.slice(cell).search(/\S/);
    for (const marker of line.matchAll(/\[[ ~o!xX]\]/g)) {
      if (marker.index !== state) problems.push(`${file}:${index + 1}:${marker.index + 1}: state marker ${marker[0]} outside a task state; a checklist marker appears only as the state of a task row`);
    }
  });
}
const states = (file) => readFileSync(file, 'utf8').split('\n').filter((line) => /^\| H[0-9]+\.[0-9-]+ \|/.test(line)).map((line) => {
  const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
  const state = cells[cells.length - 1];
  // A bypassed task records its cause and its retry condition.
  if (!/^\[( |~|o)\]$|^\[!\] cause: .+; retry: .+$/.test(state)) problems.push(`${file}: invalid task state for ${cells[0]}: ${state}`);
  return [cells[0], state];
});
if (JSON.stringify(states(CHECKLIST)) !== JSON.stringify(states(CHECKLIST.replace(/\.md$/, '.ko.md')))) problems.push(`${CHECKLIST}: the task states differ from the Korean checklist`);

for (const problem of problems) console.error(problem);
console.log(`${files.length} documents, ${problems.length} problem(s)`);
if (problems.length > 0) process.exit(1);

function codeBlocks(text) {
  return [...text.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].map((match) => match[1]);
}
