// The steps of contracts/rest.json (HY-49): a rest parameter takes the rest of the path.
import { Router, stripBasePath } from '@polyspec/hyper-client';
import { routerSteps } from './router-cases.js';

const { cases, invalidPaths } = routerSteps({ Router, stripBasePath });

export const steps = { cases, invalidPaths };
