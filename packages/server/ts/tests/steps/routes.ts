// The steps of contracts/routes.json (HY-4 to HY-8): the match of a request path with the router of the browser package.
import { Router, stripBasePath } from '@polyspec/hyper-client';
import { routerSteps } from './router-cases.js';

export const steps = routerSteps({ Router, stripBasePath });
