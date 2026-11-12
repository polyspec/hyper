// A loader or an action throws this error to answer the request with the redirect of a result (HY-50).
import type { Result } from './result.js';
import { ArgumentCountError } from '../app/argument-count-error.js';

export class Redirect extends Error {
  readonly result: Result;

  // Fails for a result that is not a redirect.
  constructor(result: Result) {
    ArgumentCountError.between(arguments.length, 1, 1);
    if (!result.isRedirect()) throw new RangeError('a redirect stop needs a redirect result (HY-50)');
    super(`redirect to ${String(result.location)}`);
    this.name = 'Redirect';
    this.result = result;
  }
}
