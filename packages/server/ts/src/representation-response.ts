// The response of a representation request (HY-122): the checks of what a handler returned, its headers, its body as
// the JSON text of HY-54 and its strong tag.
import { createHash } from 'node:crypto';
import { JsonCodec } from './json-codec.js';
import { Representation } from './representation.js';
import { Response } from './response.js';
import { Result } from './result.js';
import { toValue } from './values.js';

const STATUSES = [200, 201, 204, 400, 401, 403, 404, 406, 409, 412, 415, 422, 428];
const ALLOWED = ['location', 'www-authenticate', 'cache-control'];
// An absolute URI starts with a scheme and a colon (RFC 3986, section 4.3).
const ABSOLUTE = /^[A-Za-z][A-Za-z0-9+.-]*:/;

// Builds the response of a representation from what its handler returned.
/** @internal */
export class RepresentationResponse {
  // Returns the response of what a handler returned, with the Content-Type of its type, Vary and its Cache-Control;
  // throws for a value, a status, a header or a body that HY-122 does not allow, which answers the 500 of HY-43.
  static of(returned: unknown, contentType: string, vary: string, authorized: boolean, basePath: string): Response {
    if (!(returned instanceof Representation)) throw new Error('hyper: a representation handler returned no Representation (HY-122)');
    const status: unknown = returned.status;
    if (typeof status !== 'number' || !STATUSES.includes(status)) throw new Error(`hyper: a representation handler returned the status ${String(status)} (HY-122)`);
    const given = new Map<string, unknown>(Object.entries(returned.headers).map(([name, value]) => [name.toLowerCase(), value]));
    for (const name of given.keys()) {
      if (!ALLOWED.includes(name)) throw new Error(`hyper: a representation handler set the header ${name} (HY-122)`);
    }
    if (status === 401 && !given.has('www-authenticate')) throw new Error('hyper: a 401 of a representation has no WWW-Authenticate (HY-122)');
    if (status === 201 && !given.has('location')) throw new Error('hyper: a 201 of a representation has no Location (HY-122)');
    if (status === 204 && returned.body !== null) throw new Error('hyper: a 204 of a representation has a body (HY-122)');
    if (status === 200 && returned.body === null) throw new Error('hyper: a 200 of a representation has no body (HY-122)');
    const headers: Record<string, string> = {};
    let body = '';
    if (returned.body !== null) {
      body = JsonCodec.encode(toValue(returned.body));
      headers['Content-Type'] = contentType;
    }
    headers['Cache-Control'] = RepresentationResponse.cacheControl(status, given.get('cache-control'), authorized);
    headers.Vary = vary;
    if (given.has('location')) headers.Location = RepresentationResponse.location(given.get('location'), basePath);
    const challenge = given.get('www-authenticate');
    if (challenge !== undefined) {
      if (typeof challenge !== 'string') throw new Error('hyper: a WWW-Authenticate of a representation is not a string (HY-122)');
      headers['WWW-Authenticate'] = challenge;
    }
    return new Response(status, headers, body);
  }

  // Returns the strong tag of a body of a type: the first 32 hexadecimal digits of the SHA-256 digest of the
  // Content-Type, a line feed and the body, in quotes (HY-122.10).
  static etag(contentType: string, body: string): string {
    return `"${createHash('sha256').update(`${contentType}\n${body}`).digest('hex').slice(0, 32)}"`;
  }

  // Returns the Cache-Control of a response: `no-store` for a status of 400 or more, which a handler must not set, the
  // value of the handler, which a request with Authorization keeps out of shared caches, or the default (HY-122.6,
  // HY-122.7).
  private static cacheControl(status: number, given: unknown, authorized: boolean): string {
    if (status >= 400) {
      if (given !== undefined) throw new Error(`hyper: a representation handler set Cache-Control on a ${status} (HY-122)`);
      return 'no-store';
    }
    if (given === undefined) return authorized ? 'private, no-cache' : 'no-cache';
    if (typeof given !== 'string') throw new Error('hyper: a Cache-Control of a representation is not a string (HY-122)');
    const directives = given.split(',').map((item) => (item.split('=', 1)[0] ?? '').replace(/^[ \t]+|[ \t]+$/g, '').toLowerCase());
    const shared = directives.includes('public') || directives.includes('s-maxage');
    if (authorized && (shared || !(directives.includes('private') || directives.includes('no-store')))) {
      throw new Error('hyper: a Cache-Control of a representation lets a shared cache store the response of a request with Authorization (HY-122)');
    }
    return given;
  }

  // Returns the Location of a response: an absolute URI as it is, and an application path with the base path of the
  // request; another value fails (HY-122.5).
  private static location(location: unknown, basePath: string): string {
    if (typeof location !== 'string') throw new Error('hyper: a Location of a representation is not a string (HY-122)');
    if (ABSOLUTE.test(location)) return location;
    // Result.redirect checks that the location is an application path (HY-46).
    Result.redirect(location);
    return basePath + location;
  }
}
