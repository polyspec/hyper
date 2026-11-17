// The run of a case runner (HYR-7): every case of a runner through the step of its section, and one result line per
// case in the results file that RECIPE_RESULTS names. The runners of the Node server, of the browser package and of the
// build share it.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CaseReader } from './case-reader.ts';

export type Step = (reader: CaseReader) => unknown;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Writes the result lines to the results file by a rename and returns the failed lines.
export function writeResults(results: string, lines: string[]): string[] {
  const temporary = `${results}.tmp`;
  mkdirSync(dirname(results), { recursive: true });
  writeFileSync(temporary, `${lines.join('\n')}\n`);
  renameSync(temporary, results);
  return lines.filter((line) => line.includes(' FAIL '));
}

// The error of a run with failed cases: their count, the results file, and each failed line indented on a line of its
// own, which the first failure lines of a CI report take from the log (H35.46, HR-84).
export function failedCases(failed: string[], count: number, results: string): Error {
  return new Error(`${failed.length} of ${count} cases fail; see ${results}\n${failed.map((line) => `  ${line}`).join('\n')}`);
}

// The file, the section and the id of a case, by which a selection names it.
export interface CaseName {
  file: string;
  section: string;
  id: string;
}

// The names of a selection, which white space separates.
function selectionNames(selection: string): string[] {
  return selection.split(/\s+/u).filter((name) => name !== '');
}

// Whether a name of a selection names the case: `<file>#<section>` the cases of a section, a name that ends with
// `.json` the cases of a file, and any other name the cases of that id in every file.
function names(name: string, of: CaseName): boolean {
  const at = name.indexOf('#');
  if (at >= 0) return of.file === name.slice(0, at) && of.section === name.slice(at + 1);
  return name.endsWith('.json') ? of.file === name : of.id === name;
}

// Returns the cases of a runner that a selection names, in the order of the runner (H35.9-11). A selection without a
// name and a name that names no case of the runner throw, with the selection and each such name (HR-84).
export function selectCases<T>(runner: string, selection: string, cases: T[], nameOf: (item: T) => CaseName): T[] {
  const wanted = selectionNames(selection);
  if (wanted.length === 0) throw new Error(`the selection "${selection}" of the ${runner} runner names no case`);
  const unmatched = wanted.filter((name) => !cases.some((item) => names(name, nameOf(item))));
  if (unmatched.length > 0) throw new Error(`the selection "${selection}" of the ${runner} runner selects no case for ${unmatched.join(', ')}`);
  return cases.filter((item) => wanted.some((name) => names(name, nameOf(item))));
}

// Runs every case of the runner with the step of its section (`file:section`) and writes the results file that
// RECIPE_RESULTS names; a section without a step fails its cases with STEP_UNKNOWN; throws when a case fails. With
// RECIPE_CASES it runs only the cases that the selection names, and the first line of the results file is
// `SELECTION <names>`; the caller names another results file than the one of a full run.
export async function runCases(runner: string, steps: Record<string, Step>): Promise<void> {
  const results = process.env.RECIPE_RESULTS;
  if (results === undefined) throw new Error('RECIPE_RESULTS is not set: the case runner writes its results to the file that it names');
  const selection = process.env.RECIPE_CASES;
  const readers = selection === undefined ? CaseReader.cases(runner) : selectCases(runner, selection, CaseReader.cases(runner), (reader) => reader.name());
  const lines: string[] = [];
  for (const reader of readers) {
    const step = Object.hasOwn(steps, reader.section()) ? steps[reader.section()] : undefined;
    if (step === undefined) reader.fail(`STEP_UNKNOWN ${reader.section()}`);
    else {
      try {
        await step(reader);
      } catch (error) {
        reader.fail(messageOf(error));
      }
    }
    lines.push(reader.line());
  }
  const failed = writeResults(results, selection === undefined ? lines : [`SELECTION ${selectionNames(selection).join(' ')}`, ...lines]);
  if (failed.length > 0) throw failedCases(failed, lines.length, results);
}
