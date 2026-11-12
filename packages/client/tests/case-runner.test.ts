// The case runner of the browser package (HYR-7, HY-130): it runs the cases of the case files of contracts/ whose sections
// name the browser runner, with the steps of the browser package (case-steps.ts), and writes one result line per case to
// the results file that RECIPE_RESULTS names, through the run that the runners of the Node server and of the build share.
import { it } from 'vitest';
import { runCases } from '../../server/ts/tests/case-run.js';
import { STEPS } from './case-steps.js';

it('cases', () => runCases('browser', STEPS), 1_200_000);
