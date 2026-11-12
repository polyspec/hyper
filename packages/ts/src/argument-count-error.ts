// The error of a call of a public member with another number of arguments than its parameters (HY-106.8). JavaScript
// counts no arguments, so each public member checks its own count with this class.
/** @internal */
export class ArgumentCountError extends TypeError {
  // Fails a call whose number of arguments is below the required parameters of its member or above its parameters.
  static between(given: number, least: number, most: number): void {
    if (given < least || given > most) throw new ArgumentCountError(`hyper: argument count ${given} is not within ${least} to ${most} (HY-106)`);
  }

  // Fails an options record that is no object, lacks a required member or holds a member that is no parameter; a
  // member whose value is undefined is left out.
  static members(record: unknown, required: readonly string[], optional: readonly string[]): void {
    if (typeof record !== 'object' || record === null) throw new ArgumentCountError('hyper: the options are not a record (HY-106)');
    for (const name of required) {
      if (Reflect.get(record, name) === undefined) throw new ArgumentCountError(`hyper: the option ${name} is missing (HY-106)`);
    }
    for (const name of Object.keys(record)) {
      if (Reflect.get(record, name) !== undefined && !required.includes(name) && !optional.includes(name)) {
        throw new ArgumentCountError(`hyper: the option ${name} is no parameter (HY-106)`);
      }
    }
  }
}
