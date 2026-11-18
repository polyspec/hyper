// Tests that each Korean twin holds the sections and the entries of its English file (AGENTS.md, Documents): the
// source-sha256 of a twin records that its translation was reviewed, and no check compares the twins, so a stamp
// written without the translation leaves a twin that lacks sections or entries. The pairs are the tracked English
// files that the `include` globs of config/documents.json select and whose `.ko.md` twin is tracked.
//
// The shape of a document is the count of its `## ` headings and the count of its list items, a line that starts with
// `- `, `* ` or a number and `. ` after any indentation; lines inside a code fence are not counted, since a fence holds
// code and not prose. The two files of a pair have the same shape. The pair docs/spec/protocol.md is excluded, because
// `make spec-docs` writes both files and `make spec-docs-check` compares them statement by statement.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { matchesGlob } from 'node:path';
import { test } from 'node:test';

const GENERATED = new Set(['docs/spec/protocol.md']);

interface Shape {
  headings: number;
  items: number;
}

// The count of the `## ` headings and of the list items of a Markdown text, outside its code fences.
function shapeOf(text: string): Shape {
  let fenced = false;
  let headings = 0;
  let items = 0;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (line.startsWith('## ')) headings += 1;
    else if (/^\s*(?:[-*]|\d+\.) /.test(line)) items += 1;
  }
  return { headings, items };
}

// The English files of the pairs: tracked, selected by config/documents.json, with a tracked twin, not generated.
function pairs(): string[] {
  const config: unknown = JSON.parse(readFileSync('config/documents.json', 'utf8'));
  if (typeof config !== 'object' || config === null || !('include' in config) || !Array.isArray(config.include)) {
    throw new Error('config/documents.json has no list include');
  }
  const globs = config.include.filter((glob: unknown): glob is string => typeof glob === 'string');
  const tracked = new Set(execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean));
  return [...tracked].filter(
    (file) => file.endsWith('.md') && !file.endsWith('.ko.md') && !GENERATED.has(file) && tracked.has(file.replace(/\.md$/, '.ko.md')) && globs.some((glob) => matchesGlob(file, glob)),
  );
}

test('the shape counts the headings and the items outside a code fence', () => {
  assert.deepEqual(shapeOf('# T\n\n## A\n\n- one\n  - two\n1. three\n```\n- code\n## code\n```\n## B\n'), { headings: 2, items: 3 });
});

test('each Korean twin has the shape of its English file', () => {
  const english = pairs();
  assert.ok(english.length > 0, 'config/documents.json selects no pair of a document and its Korean twin');
  const differences = english.flatMap((file) => {
    const twin = file.replace(/\.md$/, '.ko.md');
    const source = shapeOf(readFileSync(file, 'utf8'));
    const translated = shapeOf(readFileSync(twin, 'utf8'));
    const found: string[] = [];
    if (source.headings !== translated.headings) found.push(`${twin}: ${String(translated.headings)} ## headings, ${file}: ${String(source.headings)}`);
    if (source.items !== translated.items) found.push(`${twin}: ${String(translated.items)} list items, ${file}: ${String(source.items)}`);
    return found;
  });
  assert.deepEqual(differences, [], `${String(differences.length)} differences in ${String(english.length)} pairs`);
});
