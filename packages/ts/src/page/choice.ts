// The result of the selection of a client rendering (HY-62): whether the request is of a client-rendered page, and a
// value that every loader and action of the request reads with `request.selection()`.
import { ArgumentCountError } from '../app/argument-count-error.js';

export class Choice {
  readonly chosen: boolean;
  readonly value: unknown;

  constructor(chosen: boolean, value: unknown) {
    ArgumentCountError.between(arguments.length, 2, 2);
    this.chosen = chosen;
    this.value = value;
  }
}
