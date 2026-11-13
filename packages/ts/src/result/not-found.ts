// A loader or an action throws this error when the requested resource does not exist (HY-27).
import { ArgumentCountError } from '../app/argument-count-error.js';

export class NotFound extends Error {
  constructor() {
    ArgumentCountError.between(arguments.length, 0, 0);
    super('not found');
    this.name = 'NotFound';
  }
}
