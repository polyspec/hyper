// The selection of cases of a case runner (H35.9-11, HR-84): the names of RECIPE_CASES select the cases of a file, of
// a section of a file or of an id, a name that selects no case of the runner fails the run before a case runs, and
// the results file of a selected run starts with the line of its selection.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { type CaseName, runCases, selectCases } from './case-run.js';

const CASES: CaseName[] = [
  { file: 'reads.json', section: 'cases', id: 'first' },
  { file: 'reads.json', section: 'errors', id: 'second' },
  { file: 'app.json', section: 'opens', id: 'third' },
  { file: 'app.json', section: 'cases', id: 'first' },
];

function selected(selection: string): string[] {
  return selectCases('node', selection, CASES, (name) => name).map((name) => `${name.file}#${name.section} ${name.id}`);
}

it('selects the cases of a file', () => {
  expect(selected('reads.json')).toEqual(['reads.json#cases first', 'reads.json#errors second']);
});

it('selects the cases of a section of a file', () => {
  expect(selected('app.json#opens')).toEqual(['app.json#opens third']);
});

it('selects the cases of an id in every file', () => {
  expect(selected('first')).toEqual(['reads.json#cases first', 'app.json#cases first']);
});

it('selects the cases of several names once, in the order of the runner', () => {
  expect(selected(' app.json#opens\tsecond  reads.json#errors ')).toEqual(['reads.json#errors second', 'app.json#opens third']);
});

it('fails for a name that selects no case, and names it and the selection', () => {
  expect(() => selected('reads.json routes.json app.json#closes fourth')).toThrow(
    'the selection "reads.json routes.json app.json#closes fourth" of the node runner selects no case for routes.json, app.json#closes, fourth',
  );
});

it('fails for a selection without a name', () => {
  expect(() => selected(' \t')).toThrow('the selection " \t" of the node runner names no case');
});

let directory = '';

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'hyper-case-selection-'));
  vi.stubEnv('RECIPE_RESULTS', join(directory, 'node.selected.txt'));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

it('runs only the selected cases and states the selection in the first line of the results file', async () => {
  // H35.47: keep.json declares the node runner for its sections, so the selection picks cases of the node runner.
  vi.stubEnv('RECIPE_CASES', 'keep.json');
  // The runner has no step here, so every selected case fails with STEP_UNKNOWN and the run fails with their count.
  const error: unknown = await runCases('node', {}).then(() => undefined, (thrown: unknown) => thrown);
  expect(error).toBeInstanceOf(Error);
  const message = (error as Error).message.split('\n');
  expect(message[0]).toMatch(/^(\d+) of \1 cases fail; see /u);
  const lines = readFileSync(join(directory, 'node.selected.txt'), 'utf8').trimEnd().split('\n');
  expect(lines[0]).toBe('SELECTION keep.json');
  expect(lines.length).toBeGreaterThan(1);
  // H35.46: the message names each failed case on an indented line of its own, which a CI report takes (HR-84).
  expect(message.slice(1)).toEqual(lines.slice(1).map((line) => `  ${line}`));
  expect(lines.slice(1).filter((line) => !line.startsWith('CASE keep.json '))).toEqual([]);
});

it('fails before a case runs for a name that selects no case, and writes no results file', async () => {
  vi.stubEnv('RECIPE_CASES', 'keep.json no-such-file.json');
  await expect(runCases('node', {})).rejects.toThrow('the selection "keep.json no-such-file.json" of the node runner selects no case for no-such-file.json');
  expect(readdirSync(directory)).toEqual([]);
});
