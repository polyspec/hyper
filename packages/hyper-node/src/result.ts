// Results of actions and the stops of loaders and actions (HY-25 to HY-27, HY-46, HY-50, HY-51, HY-58).
import { toValue, type Data, type Value } from './values.js';

// The outcome of an action: a redirect (HY-25) or a page with a status (HY-26, HY-58).
export class Result {
  readonly location: string | null;
  readonly status: number;
  readonly data: Data;
  readonly flashValues: ReadonlyMap<string, Value>;
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
    if (!location.isWellFormed() || !/^\/(?![/\\])[^\x00-\x20\x7f-\x9f\\]*$/.test(location) || hasDotSegment(location)) {
      throw new Error(`hyper: redirect location ${JSON.stringify(location)} is not an application path`);
    }
    return new Result(location, 303, {}, new Map(), []);
  }

  // Returns the route page with a status of 200, 409 or 422 and the data that the page renders (HY-58).
  static page(status: number, data: Data): Result {
    if (![200, 409, 422].includes(status)) throw new Error(`hyper: page status ${status} is not 200, 409 or 422`);
    return new Result(null, status, data, new Map(), []);
  }

  // Returns invalid input with the data that the page renders: the page with status 422 (HY-26).
  static invalid(data: Data): Result {
    return Result.page(422, data);
  }

  // Returns a copy that stores a flash value, a value of the data model, for the next request.
  flash(name: string, value: unknown): Result {
    return new Result(this.location, this.status, this.data, new Map(this.flashValues).set(name, toValue(value)), this.changedTopics);
  }

  // Returns a copy that records changed topics for the next request.
  changed(...topics: string[]): Result {
    return new Result(this.location, this.status, this.data, this.flashValues, [...new Set([...this.changedTopics, ...topics])]);
  }

  // Returns true for a redirect.
  isRedirect(): boolean {
    return this.location !== null;
  }
}

// Returns true when the path of a location has a `.` or `..` segment, also with a percent-encoded dot.
function hasDotSegment(location: string): boolean {
  const path = location.slice(0, location.search(/[?#]|$/));
  return path.split('/').some((segment) => ['.', '..'].includes(segment.replace(/%2e/gi, '.')));
}

// A loader or an action throws this error when the requested resource does not exist (HY-27).
export class NotFound extends Error {
  constructor() {
    super('not found');
    this.name = 'NotFound';
  }
}

// A loader or an action throws this error to answer the request with 403 (HY-51).
export class Forbidden extends Error {
  constructor() {
    super('forbidden');
    this.name = 'Forbidden';
  }
}

// A loader or an action throws this error to answer the request with 400 (HY-58).
export class BadRequest extends Error {
  constructor() {
    super('bad request');
    this.name = 'BadRequest';
  }
}

// A loader or an action throws this error to answer the request with the redirect of a result (HY-50).
export class Redirect extends Error {
  readonly result: Result;

  constructor(result: Result) {
    if (!result.isRedirect()) throw new Error('hyper: a redirect needs a redirect result');
    super(`redirect to ${result.location}`);
    this.name = 'Redirect';
    this.result = result;
  }
}
