// The cookies of a request: one parse of its Cookie lines (HY-129), the same in every server. The core reads them with
// parse_cookie of http-cookie (HY-129.13); each line is text whose characters U+0000 to U+00FF are its bytes, as
// node:http gives it.
import { binding } from '../app/core-rules.js';

/** @internal */
export class Cookies {
  // Returns the cookies of the field values of the Cookie lines of a request in their order, by name, with
  // rules.parse_cookie of the core; a request without the field has no line and no cookie.
  static parse(lines: readonly string[]): Map<string, string> {
    return new Map(binding().parseCookie(lines));
  }
}
