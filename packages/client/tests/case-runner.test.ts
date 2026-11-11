// The case runner of the browser package (HYR-7, HY-130): it runs the cases of the case files of contracts/ whose sections
// name the browser runner, with the steps of the browser package (case-steps.ts), and writes one result line per case to
// the results file that RECIPE_RESULTS names.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { it } from 'vitest';
import { CaseReader } from '../../server/ts/tests/case-reader.js';
import { STEPS } from './case-steps.js';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

it('cases', async () => {
  const results = process.env.RECIPE_RESULTS;
  if (results === undefined) throw new Error('RECIPE_RESULTS is not set: the case runner writes its results to the file that it names');
  const lines: string[] = [];
  for (const reader of CaseReader.cases('browser')) {
    const step = STEPS[reader.section()];
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
  const temporary = `${results}.tmp`;
  mkdirSync(dirname(results), { recursive: true });
  writeFileSync(temporary, `${lines.join('\n')}\n`);
  renameSync(temporary, results);
  const failed = lines.filter((line) => line.includes(' FAIL ')).length;
  if (failed > 0) throw new Error(`${failed} of ${lines.length} cases fail; see ${results}`);
}, 1_200_000);
