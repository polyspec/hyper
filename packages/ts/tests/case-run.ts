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

// Writes the result lines to the results file by a rename and returns the number of failed lines.
export function writeResults(results: string, lines: string[]): number {
  const temporary = `${results}.tmp`;
  mkdirSync(dirname(results), { recursive: true });
  writeFileSync(temporary, `${lines.join('\n')}\n`);
  renameSync(temporary, results);
  return lines.filter((line) => line.includes(' FAIL ')).length;
}

// Runs every case of the runner with the step of its section (`file:section`) and writes the results file that
// RECIPE_RESULTS names; a section without a step fails its cases with STEP_UNKNOWN; throws when a case fails.
export async function runCases(runner: string, steps: Record<string, Step>): Promise<void> {
  const results = process.env.RECIPE_RESULTS;
  if (results === undefined) throw new Error('RECIPE_RESULTS is not set: the case runner writes its results to the file that it names');
  const lines: string[] = [];
  for (const reader of CaseReader.cases(runner)) {
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
  const failed = writeResults(results, lines);
  if (failed > 0) throw new Error(`${failed} of ${lines.length} cases fail; see ${results}`);
}
