// A loader or an action throws this error to answer the request with 403 (HY-51).
import { ArgumentCountError } from './argument-count-error.js';

export class Forbidden extends Error {
  constructor() {
    ArgumentCountError.between(arguments.length, 0, 0);
    super('forbidden');
    this.name = 'Forbidden';
  }
}
