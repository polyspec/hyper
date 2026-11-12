// The case runner of the Node server (HYR-7, HY-130): it runs every case of every case file of contracts/ whose sections
// name the node runner, and writes one result line per case to the results file that RECIPE_RESULTS names.
import { it } from 'vitest';
import { runCases, type Step } from './case-run.js';
import { steps as acceptSteps } from './steps/accept.js';
import { steps as appSteps } from './steps/app.js';
import { steps as argumentsSteps } from './steps/arguments.js';
import { steps as clientSteps } from './steps/client.js';
import { steps as contextSteps } from './steps/context.js';
import { steps as cookiesSteps } from './steps/cookies.js';
import { steps as buildSteps } from './steps/build.js';
import { steps as containerSteps } from './steps/container.js';
import { steps as csrfSteps } from './steps/csrf.js';
import { steps as fieldsSteps } from './steps/fields.js';
import { steps as fileSessionsSteps } from './steps/file-sessions.js';
import { steps as fileStoreSessionsSteps } from './steps/file-store-sessions.js';
import { steps as functionsSteps } from './steps/functions.js';
import { steps as hooksSteps } from './steps/hooks.js';
import { steps as jsonSteps } from './steps/json.js';
import { steps as keepSteps } from './steps/keep.js';
import { steps as manifestSteps } from './steps/manifest.js';
import { steps as mediaTypeSteps } from './steps/media-type.js';
import { steps as readsSteps } from './steps/reads.js';
import { steps as redisSessionsSteps } from './steps/redis-sessions.js';
import { steps as representationsSteps } from './steps/representations.js';
import { steps as requestSteps } from './steps/request.js';
import { steps as restSteps } from './steps/rest.js';
import { steps as replySteps } from './steps/reply.js';
import { steps as resultSteps } from './steps/result.js';
import { steps as responseSteps } from './steps/response.js';
import { steps as routesSteps } from './steps/routes.js';
import { steps as sessionSteps } from './steps/session.js';

// The steps of this server, by case file and section (`file:section`). A section without a step fails its cases.
const STEPS: Record<string, Step> = {
  ...prefixed('accept.json', acceptSteps, ['parse', 'select']),
  ...prefixed('accept-before-s3b.json', acceptSteps, ['parse', 'select'], true),
  ...prefixed('app.json', appSteps),
  ...prefixed('arguments.json', argumentsSteps),
  ...prefixed('client.json', clientSteps),
  ...prefixed('context.json', contextSteps),
  ...prefixed('cookies.json', cookiesSteps),
  ...prefixed('build.json', buildSteps),
  ...prefixed('container.json', containerSteps),
  ...prefixed('csrf.json', csrfSteps),
  ...prefixed('fields.json', fieldsSteps),
  ...prefixed('file-sessions.json', fileSessionsSteps),
  // The fixed copy of the store cases that the sessions library holds (tests/legacy), until S-4 removes it.
  ...prefixed('file-store-sessions.json', fileStoreSessionsSteps),
  ...prefixed('functions.json', functionsSteps),
  ...prefixed('hooks.json', hooksSteps),
  ...prefixed('json.json', jsonSteps),
  ...prefixed('keep.json', keepSteps),
  ...prefixed('manifest.json', manifestSteps),
  ...prefixed('media-type.json', mediaTypeSteps),
  ...prefixed('reads.json', readsSteps),
  ...prefixed('redis-sessions.json', redisSessionsSteps),
  ...prefixed('representations.json', representationsSteps),
  ...prefixed('request.json', requestSteps),
  ...prefixed('rest.json', restSteps),
  ...prefixed('reply.json', replySteps),
  ...prefixed('response.json', responseSteps),
  ...prefixed('result.json', resultSteps),
  ...prefixed('routes.json', routesSteps),
  ...prefixed('session.json', sessionSteps),
};

// The steps of a case file by `file:section`. A file `<name>-before-s3b.json` is the fixed copy in tests/legacy of the
// sections of `<name>.json` that the host code runs in their form from before the S-3b case changes, until the commit
// that moves their rules to the core (C-7) makes them live again: `frozen` lists those sections, which the steps of the
// live file leave out and the steps of the fixed copy, with `only`, keep alone.
function prefixed(file: string, steps: Record<string, Step>, frozen: string[] = [], only = false): Record<string, Step> {
  return Object.fromEntries(
    Object.entries(steps)
      .filter(([section]) => frozen.includes(section) === only)
      .map(([section, step]) => [`${file}:${section}`, step]),
  );
}

it('cases', () => runCases('node', STEPS), 1_200_000);
