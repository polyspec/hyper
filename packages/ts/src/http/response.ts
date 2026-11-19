import type { Reply } from './reply.js';
import { ArgumentCountError } from '../app/argument-count-error.js';

// One HTTP response.
export class Response {
  readonly status: number;
  readonly headers: Record<string, string | string[]>;
  readonly body: string;

  constructor(status: number, headers: Record<string, string | string[]>, body: string) {
    ArgumentCountError.between(arguments.length, 3, 3);
    this.status = status;
    this.headers = headers;
    this.body = body;
  }

  // Returns a copy with one more header.
  withHeader(name: string, value: string): Response {
    ArgumentCountError.between(arguments.length, 2, 2);
    return new Response(this.status, { ...this.headers, [name]: value }, this.body);
  }

  // Returns a copy with the cookies of a reply, when it has any (HY-52).
  /** @internal */
  withCookies(reply: Reply, secure: boolean): Response {
    const cookies = reply.cookieHeaders(secure);
    return cookies.length === 0 ? this : new Response(this.status, { ...this.headers, 'Set-Cookie': cookies }, this.body);
  }

  // Returns a copy whose first cookie is the session cookie, when the session sets one (HY-45.8, HY-97.3). The host
  // writes it, so the session passes only the field value.
  /** @internal */
  withSessionCookie(field: string | null): Response {
    if (field === null) return this;
    const cookies = this.headers['Set-Cookie'];
    return new Response(this.status, { ...this.headers, 'Set-Cookie': [field, ...(Array.isArray(cookies) ? cookies : [])] }, this.body);
  }

  // Returns a plain text response.
  static text(status: number, body: string): Response {
    ArgumentCountError.between(arguments.length, 2, 2);
    return new Response(status, { 'Content-Type': 'text/plain; charset=utf-8' }, body);
  }
}
