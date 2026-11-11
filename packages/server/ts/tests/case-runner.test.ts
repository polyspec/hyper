// The case runner of the Node server (HYR-7, HY-130): it runs every case of every case file of contracts/ that a step
// of this server answers, and writes one result line per case to the results file that RECIPE_RESULTS names.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { it } from 'vitest';
import { CaseReader } from './case-reader.js';

type Step = (reader: CaseReader) => unknown;

// The steps of this server, by case file and section. A section without a step fails its cases with STEP_UNKNOWN.
const STEPS: Record<string, Record<string, Step>> = {};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

it('cases', async () => {
  const results = process.env.RECIPE_RESULTS;
  if (results === undefined) throw new Error('RECIPE_RESULTS names the results file');
  const lines: string[] = [];
  for (const file of CaseReader.files()) {
    for (const reader of CaseReader.cases(file)) {
      const step = STEPS[file]?.[reader.section()];
      if (step === undefined) reader.fail(`STEP_UNKNOWN ${file} ${reader.section()}`);
      else if (!reader.failed()) {
        try {
          await step(reader);
        } catch (error) {
          reader.fail(messageOf(error));
        }
      }
      lines.push(reader.line());
    }
  }
  const temporary = `${results}.tmp`;
  mkdirSync(dirname(results), { recursive: true });
  writeFileSync(temporary, `${lines.join('\n')}\n`);
  renameSync(temporary, results);
  const failed = lines.filter((line) => line.includes(' FAIL ')).length;
  if (failed > 0) throw new Error(`${failed} of ${lines.length} cases fail; see ${results}`);
}, 1_200_000);
