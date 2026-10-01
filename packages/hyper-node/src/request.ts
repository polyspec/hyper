// One HTTP request with the session values that the application reads.
import { bytesOf, formFields, parseCookies, parseUrlEncoded, utf8, type Fields } from './form.js';
import type { Flash } from './session.js';
import type { Value } from './values.js';

// The parts of an HTTP request as node:http gives them: the request target and the header values are text
// whose characters are bytes, and the body is bytes.
export interface RequestInit {
  method: string;
  target: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: Uint8Array;
  https?: boolean;
}

interface State {
  method: string;
  path: string;
  headers: Map<string, string>;
  rawQuery: string;
  query: Fields;
  form: Fields;
  cookies: Map<string, string>;
  https: boolean;
  params: Record<string, string>;
  flash: Map<string, Value>;
  csrfToken: string;
}

export class Request {
  private constructor(private readonly state: State) {}

  // Creates a request from its HTTP parts. The form values are read from an application/x-www-form-urlencoded
  // body and from the text fields of a multipart/form-data body, without nesting (HY-57).
  static from(init: RequestInit): Request {
    const headers = new Map<string, string>();
    for (const [name, value] of Object.entries(init.headers ?? {})) {
      if (value !== undefined) headers.set(name.toLowerCase(), Array.isArray(value) ? value.join(', ') : value);
    }
    const rawQuery = Request.targetQuery(init.target);
    const form = formFields(headers.get('content-type') ?? '', init.body ?? new Uint8Array());
    return new Request({
      method: init.method.toUpperCase(),
      path: Request.targetPath(init.target),
      headers,
      rawQuery,
      query: parseUrlEncoded(rawQuery),
      form,
      cookies: parseCookies(headers.get('cookie') ?? ''),
      https: init.https ?? false,
      params: {},
      flash: new Map(),
      csrfToken: '',
    });
  }

  // Returns the path of a request target: the target before `?` or `#`, after the authority of an absolute-form
  // target, without decoding (HY-42).
  static targetPath(target: string): string {
    let path = target.slice(0, Math.min(firstOf(target, '?'), firstOf(target, '#')));
    const authority = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/]*/.exec(path);
    if (authority !== null) path = path.slice(authority[0].length);
    return path === '' ? '/' : path;
  }

  // Returns the raw query of a request target: the target after its first `?` up to its first `#` (HY-56).
  static targetQuery(target: string): string {
    const before = target.slice(0, firstOf(target, '#'));
    const question = before.indexOf('?');
    return question < 0 ? '' : before.slice(question + 1);
  }

  get method(): string {
    return this.state.method;
  }

  get https(): boolean {
    return this.state.https;
  }

  // Returns a copy that holds the flash values and the CSRF token of the session.
  withSession(flash: Flash, csrfToken: string): Request {
    return new Request({ ...this.state, flash: flash.values, csrfToken });
  }

  // Returns a copy with the routed path (base path removed) and the route parameters.
  withRoute(path: string, params: Record<string, string>): Request {
    return new Request({ ...this.state, path, params });
  }

  // Returns the route parameters.
  params(): Record<string, string> {
    return { ...this.state.params };
  }

  // Returns a route parameter, or null.
  param(name: string): string | null {
    return Object.hasOwn(this.state.params, name) ? this.state.params[name]! : null;
  }

  // Returns a cookie value, or null.
  cookie(name: string): string | null {
    return this.state.cookies.get(name) ?? null;
  }

  // Returns true when the path consists of printable ASCII characters and every query and form name and value
  // and HX-Current-URL are UTF-8 (HY-42). Cookies are not checked; hyper ignores invalid ones.
  validInput(): boolean {
    const current = this.state.headers.get('hx-current-url');
    return /^[\x21-\x7e]*$/.test(this.state.path) && (current === undefined || utf8(bytesOf(current)) !== null) && this.state.query.valid && this.state.form.valid;
  }

  // Returns the value of a header as text whose characters are its bytes, or null.
  header(name: string): string | null {
    return this.state.headers.get(name.toLowerCase()) ?? null;
  }

  // Returns true when the request accepts JSON (HY-15).
  wantsJson(): boolean {
    return (this.header('Accept') ?? '').includes('application/json');
  }

  // Returns true for a region request: JSON from htmx, which sends HX-Request with every request (HY-15).
  isRegionRequest(): boolean {
    return this.wantsJson() && this.header('HX-Request') === 'true';
  }

  // Returns the path of the page that sent the request, or null (HY-11).
  currentPath(): string | null {
    const header = this.header('HX-Current-URL');
    const url = header === null ? null : utf8(bytesOf(header));
    if (url === null) return null;
    const rest = url.replace(/^([A-Za-z][A-Za-z0-9+.-]*:)?\/\/[^/?#]*/, '');
    const path = rest.slice(0, Math.min(firstOf(rest, '?'), firstOf(rest, '#')));
    return path === '' ? null : path;
  }

  // Returns the request path; after routing, the path without the base path.
  path(): string {
    return this.state.path;
  }

  // Returns the raw query of the request target, or the empty string (HY-56). Its characters are bytes, as
  // node:http gives the request target.
  rawQuery(): string {
    return this.state.rawQuery;
  }

  // Returns every query value in order, without nesting (HY-56).
  query(): ReadonlyMap<string, readonly string[]> {
    return copy(this.state.query);
  }

  // Returns the last query value of a name as an integer, or the default when it is absent or not an integer.
  queryInt(name: string, fallback: number): number {
    const value = this.state.query.values.get(name)?.at(-1);
    return value !== undefined && /^-?[0-9]{1,15}$/.test(value) ? Number(value) : fallback;
  }

  // Returns every form value of the body in order, without nesting (HY-57).
  form(): ReadonlyMap<string, readonly string[]> {
    return copy(this.state.form);
  }

  // Returns the last form value of a name; an absent name gives the empty string.
  formString(name: string): string {
    return this.state.form.values.get(name)?.at(-1) ?? '';
  }

  // Returns a flash value stored by the previous action, or null.
  flash(name: string): Value {
    return this.state.flash.get(name) ?? null;
  }

  // Returns the CSRF token of the session.
  csrfToken(): string {
    return this.state.csrfToken;
  }
}

function copy(fields: Fields): Map<string, string[]> {
  return new Map([...fields.values].map(([name, values]) => [name, [...values]]));
}

function firstOf(text: string, char: string): number {
  const index = text.indexOf(char);
  return index < 0 ? text.length : index;
}
