// The case runner of the Node server (HYR-7, HY-130): it runs every case of every case file of contracts/ whose sections
// name the node runner, and writes one result line per case to the results file that RECIPE_RESULTS names.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { it } from 'vitest';
import { CaseReader } from './case-reader.js';
import { steps as acceptSteps } from './steps/accept.js';
import { steps as clientSteps } from './steps/client.js';
import { steps as contextSteps } from './steps/context.js';
import { steps as cookiesSteps } from './steps/cookies.js';
import { steps as buildSteps } from './steps/build.js';
import { steps as containerSteps } from './steps/container.js';
import { steps as csrfSteps } from './steps/csrf.js';
import { steps as fieldsSteps } from './steps/fields.js';
import { steps as functionsSteps } from './steps/functions.js';
import { steps as jsonSteps } from './steps/json.js';
import { steps as keepSteps } from './steps/keep.js';
import { steps as readsSteps } from './steps/reads.js';
import { steps as representationsSteps } from './steps/representations.js';
import { steps as restSteps } from './steps/rest.js';
import { steps as resultSteps } from './steps/result.js';
import { steps as routesSteps } from './steps/routes.js';

type Step = (reader: CaseReader) => unknown;

// The steps of this server, by case file and section (`file:section`). A section without a step fails its cases.
const STEPS: Record<string, Step> = {
  ...prefixed('accept.json', acceptSteps),
  ...prefixed('client.json', clientSteps),
  ...prefixed('context.json', contextSteps),
  ...prefixed('cookies.json', cookiesSteps),
  ...prefixed('build.json', buildSteps),
  ...prefixed('container.json', containerSteps),
  ...prefixed('csrf.json', csrfSteps),
  ...prefixed('fields.json', fieldsSteps),
  ...prefixed('functions.json', functionsSteps),
  ...prefixed('json.json', jsonSteps),
  ...prefixed('keep.json', keepSteps),
  ...prefixed('reads.json', readsSteps),
  ...prefixed('representations.json', representationsSteps),
  ...prefixed('rest.json', restSteps),
  ...prefixed('result.json', resultSteps),
  ...prefixed('routes.json', routesSteps),
};

function prefixed(file: string, steps: Record<string, Step>): Record<string, Step> {
  return Object.fromEntries(Object.entries(steps).map(([section, step]) => [`${file}:${section}`, step]));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

it('cases', async () => {
  const results = process.env.RECIPE_RESULTS;
  if (results === undefined) throw new Error('RECIPE_RESULTS is not set: the case runner writes its results to the file that it names');
  const lines: string[] = [];
  for (const reader of CaseReader.cases('node')) {
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
