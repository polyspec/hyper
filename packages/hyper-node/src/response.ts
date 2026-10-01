import type { Reply } from './reply.js';

// Response headers; Set-Cookie holds a list and every other header holds one value.
export type Headers = Record<string, string | string[]>;

// One HTTP response.
export class Response {
  readonly status: number;
  readonly headers: Headers;
  readonly body: string;

  constructor(status: number, headers: Headers, body: string) {
    this.status = status;
    this.headers = headers;
    this.body = body;
  }

  // Returns a copy with one more header.
  withHeader(name: string, value: string): Response {
    return new Response(this.status, { ...this.headers, [name]: value }, this.body);
  }

  // Returns a copy with the cookies of a reply, when it has any (HY-52).
  withCookies(reply: Reply, secure: boolean): Response {
    const cookies = reply.cookieHeaders(secure);
    return cookies.length === 0 ? this : new Response(this.status, { ...this.headers, 'Set-Cookie': cookies }, this.body);
  }

  // Returns a plain text response.
  static text(status: number, body: string): Response {
    return new Response(status, { 'Content-Type': 'text/plain; charset=utf-8' }, body);
  }
}
