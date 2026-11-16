// The outcome of an action: a redirect (HY-25, HY-46), an outside redirect (HY-133) or a page with a status (HY-26,
// HY-58), with the flash values and the changed topics that it stores for the next request.
import { toValue, type Data, type Value } from '../data/values.js';
import { ArgumentCountError } from '../app/argument-count-error.js';

// An outside location (HY-133.2) with its scheme, its host and its port, of ASCII characters only: the class of the rest
// holds every visible ASCII character except the backslash.
const OUTSIDE = /^([Hh][Tt][Tt][Pp][Ss]?):\/\/([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)(?::([1-9][0-9]{0,4}))?(?:[/?#][\x21-\x5B\x5D-\x7E]*)?$/;

export class Result {
  readonly location: string | null;
  readonly status: number;
  readonly data: Data;
  /** @internal */
  readonly flashValues: ReadonlyMap<string, Value>;
  /** @internal */
  readonly changedTopics: readonly string[];

  private constructor(location: string | null, status: number, data: Data, flashValues: ReadonlyMap<string, Value>, changedTopics: readonly string[]) {
    this.location = location;
    this.status = status;
    this.data = data;
    this.flashValues = flashValues;
    this.changedTopics = changedTopics;
  }

  // Returns a redirect to a path of this application (HY-46).
  static redirect(location: string): Result {
    ArgumentCountError.between(arguments.length, 1, 1);
    if (!location.isWellFormed() || !/^\/(?![/\\])[^\p{Cc} \\]*$/u.test(location) || Result.hasDotSegment(location)) {
      throw new RangeError('a redirect location is not an application path (HY-46)');
    }
    return new Result(location, 303, {}, new Map(), []);
  }

  // Returns an outside redirect to an outside location (HY-133).
  static outside(location: string): Result {
    ArgumentCountError.between(arguments.length, 1, 1);
    if (Result.origin(location) === null) throw new RangeError('an outside location is not an http or https URL with a host (HY-133)');
    return new Result(location, 303, {}, new Map(), []);
  }

  // Returns the origin of an outside location, its scheme and its host in lower case and its port or the default port of
  // its scheme, or null for a text that is no outside location (HY-133).
  static origin(text: string): string | null {
    ArgumentCountError.between(arguments.length, 1, 1);
    const parts = OUTSIDE.exec(text);
    if (parts === null) return null;
    const scheme = (parts[1] ?? '').toLowerCase();
    const port = parts[3] === undefined ? (scheme === 'https' ? 443 : 80) : Number(parts[3]);
    if (port > 65535) return null;
    return `${scheme}://${(parts[2] ?? '').toLowerCase()}:${port}`;
  }

  // Returns the route page with a status of 200, 409 or 422 and the data that the page renders (HY-58).
  static page(status: number, data: Data): Result {
    ArgumentCountError.between(arguments.length, 2, 2);
    if (![200, 409, 422].includes(status)) throw new RangeError(`a page status ${status} is not 200, 409 or 422 (HY-58)`);
    return new Result(null, status, data, new Map(), []);
  }

  // Returns invalid input with the data that the page renders: the page with status 422 (HY-26).
  static invalid(data: Data): Result {
    ArgumentCountError.between(arguments.length, 1, 1);
    return Result.page(422, data);
  }

  // Returns a copy that stores a flash value, a value of the data model, for the next request; a value outside the
  // data model fails (HY-44).
  flash(name: string, value: unknown): Result {
    ArgumentCountError.between(arguments.length, 2, 2);
    this.refuseOutside();
    // HY-25.6: a caller in JavaScript may pass a name that is not a string.
    if (typeof name !== 'string') throw new TypeError('a flash name is not a string (HY-25)');
    return new Result(this.location, this.status, this.data, new Map(this.flashValues).set(name, toValue(value)), this.changedTopics);
  }

  // Returns a copy that records changed topics for the next request; a topic that it records already keeps its place.
  changed(...topics: string[]): Result {
    this.refuseOutside();
    // HY-25.6: a caller in JavaScript may pass a topic that is not a string.
    if (!topics.every((topic) => typeof topic === 'string')) throw new TypeError('a changed topic is not a string (HY-25)');
    return new Result(this.location, this.status, this.data, this.flashValues, [...new Set([...this.changedTopics, ...topics])]);
  }

  // Returns true for a redirect.
  /** @internal */
  isRedirect(): boolean {
    return this.location !== null;
  }

  // Returns true for an outside redirect, whose location is no application path (HY-133).
  /** @internal */
  isOutside(): boolean {
    return this.location !== null && !this.location.startsWith('/');
  }

  // Fails for an outside redirect, which stores no flash value and no changed topic (HY-133).
  private refuseOutside(): void {
    if (this.isOutside()) throw new RangeError('an outside redirect holds no flash value or changed topic (HY-133)');
  }

  // Returns true when the path of a location has a `.` or `..` segment, also with a percent-encoded dot.
  private static hasDotSegment(location: string): boolean {
    const path = location.slice(0, location.search(/[?#]|$/));
    return path.split('/').some((segment) => ['.', '..'].includes(segment.replace(/%2e/gi, '.')));
  }
}
