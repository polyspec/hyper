// A loader or an action throws this error to answer the request with 400 (HY-58).
import { ArgumentCountError } from '../app/argument-count-error.js';

export class BadRequest extends Error {
  constructor() {
    ArgumentCountError.between(arguments.length, 0, 0);
    super('bad request');
    this.name = 'BadRequest';
  }
}
