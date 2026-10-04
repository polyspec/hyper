// Checks the documents of the repository: every English document has a Korean pair and the
// reverse, every relative link resolves, both documents of a pair contain the same code blocks, and
// every task of the execution checklist has one of the four task states of AGENTS, the same in both
// languages.
//
// Usage: node scripts/check-documents.mjs

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const IGNORED = new Set(['node_modules', 'vendor', 'test-results', 'playwright-report', '.git', 'build']);
const files = listMarkdown('.');
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

function listMarkdown(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (IGNORED.has(entry.name)) return [];
    const path = relative('.', join(dir, entry.name));
    if (entry.isDirectory()) return listMarkdown(path);
    return entry.name.endsWith('.md') ? [path] : [];
  });
}

function codeBlocks(text) {
  return [...text.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].map((match) => match[1]);
}
