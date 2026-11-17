// The selection of cases of the browser runner (H35.9-11, HR-84): the runner runs the cases that RECIPE_CASES names
// through the run that it shares with the Node runner, and fails for a name that selects none of its cases.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runCases } from '../../ts/tests/case-run.js';
import { STEPS } from './case-steps.js';

let directory = '';

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'hyper-browser-selection-'));
  vi.stubEnv('RECIPE_RESULTS', join(directory, 'browser.selected.txt'));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

it('runs only the cases of the selected section and states the selection in the first line', async () => {
  vi.stubEnv('RECIPE_CASES', 'keep.json#cases');
  await runCases('browser', STEPS);
  const lines = readFileSync(join(directory, 'browser.selected.txt'), 'utf8').trimEnd().split('\n');
  expect(lines[0]).toBe('SELECTION keep.json#cases');
  expect(lines.length).toBeGreaterThan(1);
  expect(lines.slice(1).filter((line) => !/^CASE keep\.json \S+ PASS$/u.test(line))).toEqual([]);
});

it('fails for a case file that holds no case of the browser runner', async () => {
  // accept.json is a case file of the servers: no section of it names the browser runner.
  vi.stubEnv('RECIPE_CASES', 'accept.json');
  await expect(runCases('browser', STEPS)).rejects.toThrow('the selection "accept.json" of the browser runner selects no case for accept.json');
  expect(readdirSync(directory)).toEqual([]);
});
