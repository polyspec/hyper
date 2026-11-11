// One HTTP request with the session values that the application reads.
import { Cookies } from './cookies.js';
import { Fields } from './fields.js';
import { Files } from './files.js';
import { Multipart } from './multipart.js';
import type { RequestBody } from './request-body.js';
import type { Flash } from './session.js';
import type { UploadedFile } from './uploaded-file.js';
import type { Value } from './values.js';

// The parts of an HTTP request as node:http gives them: the request target and the header values are text
// whose characters are bytes, and the body is bytes.
export interface RequestInit {
  method: string;
  target: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: Uint8Array;
  // The size of the body that the server received, when it stopped reading a body larger than the limit (HY-59);
  // the default is the length of the body.
  bodySize?: number;
  https?: boolean;
}

interface State {
  method: string;
  path: string;
  headers: Map<string, string>;
  bodySize: number;
  rawQuery: string;
  // The query values, the form values and the file parts of the body (HY-56, HY-57, HY-113), each null when it fails
  // with HY-42.
  query: Fields | null;
  form: Fields | null;
  files: Files | null;
  cookies: Map<string, string>;
  https: boolean;
  params: Record<string, string>;
  flash: Map<string, Value>;
  csrfToken: string;
  // The value of the choice of the client rendering selection (HY-62).
  selection: unknown;
  // The media type that the selection of HY-116 chose, or null before the selection.
  mediaType: string | null;
  // The body as the host read it, whose directory holds the files of a body read in chunks (HY-131), or null.
  read: RequestBody | null;
  // The size of a body that is one value, and the number of its parts when it is multipart (HY-131.12).
  held: number;
  partCount: number;
}

// The media type of the JSON of hyper (HY-15).
export const HYPER_JSON = 'application/vnd.hyper+json';

export class Request {
  // ignoreBOM keeps a leading U+FEFF as a character, as PHP and Python decode it; the default of TextDecoder drops it.
  private static readonly decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  private readonly state: State;

  private constructor(state: State) {
    this.state = state;
  }

  // Creates a request from its HTTP parts. The form values are read from an application/x-www-form-urlencoded
  // body and from the text fields of a multipart/form-data body, without nesting (HY-57).
  // `read` is the body as a host read it: a body read in chunks gives its parts (HY-131).
  static from(init: RequestInit, read: RequestBody | null = null): Request {
    const headers = new Map<string, string>();
    for (const [name, value] of Object.entries(init.headers ?? {})) {
      if (value === undefined) continue;
      const key = name.toLowerCase();
      // Several Cookie lines are one header joined with `; ` (HY-129); other repeated headers join with `, `.
      headers.set(key, Array.isArray(value) ? value.join(key === 'cookie' ? '; ' : ', ') : value);
    }
    const rawQuery = Request.targetQuery(init.target);
    const body = init.body ?? new Uint8Array();
    const boundary = Multipart.boundary(headers.get('content-type') ?? '');
    let form: Fields | null;
    let files: Files | null;
    let partCount = 0;
    if (read?.streamed() === true) {
      const parts = read.parts();
      form = parts?.[0] ?? null;
      files = parts?.[1] ?? null;
    } else if (boundary !== null) {
      // A multipart body that is one value is read once, which also gives the number of its parts.
      const reader = new Multipart(boundary, null, null, null, null);
      const parts = reader.feed(body) ? reader.result() : null;
      form = parts?.[0] ?? null;
      files = parts?.[1] ?? null;
      partCount = reader.count();
    } else {
      form = Fields.fromBody(headers.get('content-type') ?? '', body);
      files = Files.empty();
    }
    const declared = headers.get('content-length') ?? '';
    return new Request({
      method: init.method.toUpperCase(),
      path: Request.targetPath(init.target),
      headers,
      bodySize: Math.max(init.bodySize ?? body.byteLength, read?.size() ?? 0, /^[0-9]+$/.test(declared) ? Number(declared) : 0),
      rawQuery,
      query: Fields.parse(Buffer.from(rawQuery, 'latin1')),
      form,
      files,
      cookies: Cookies.parse(headers.get('cookie') ?? null),
      https: init.https ?? false,
      params: {},
      flash: new Map(),
      csrfToken: '',
      selection: null,
      mediaType: null,
      read,
      held: body.byteLength,
      partCount,
    });
  }

  /**
   * Returns true when the body passed the value limit, the part limit or the file limit (HY-131.11): as its host read
   * it, or for a body that is one value by its size, and by its parts and files when `streams` tells that the
   * application reads a multipart body in chunks.
   *
   * @internal
   */
  exceeded(valueLimit: number, partLimit: number, fileLimit: number, streams: boolean): boolean {
    const read = this.state.read;
    if (read !== null && (read.exceeded() || read.streamed())) return read.exceeded();
    return this.state.held > valueLimit || (streams && (this.state.partCount > partLimit || (this.state.files?.largest() ?? 0) > fileLimit));
  }

  /**
   * Removes the directory of the files of the body with the files that were not moved (HY-131.14).
   *
   * @internal
   */
  release(): void {
    this.state.read?.remove();
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
  /** @internal */
  withSession(flash: Flash, csrfToken: string): Request {
    return new Request({ ...this.state, flash: flash.values, csrfToken });
  }

  // Returns a copy with the routed path (base path removed) and the route parameters.
  /** @internal */
  withRoute(path: string, params: Record<string, string>): Request {
    return new Request({ ...this.state, path, params });
  }

  // Returns a copy whose header of the name, compared without case as `header` reads it, has the value (HY-97).
  withHeader(name: string, value: string): Request {
    return new Request({ ...this.state, headers: new Map(this.state.headers).set(name.toLowerCase(), value) });
  }

  // Returns a copy that holds the value of the choice of the client rendering selection (HY-62).
  /** @internal */
  withSelection(value: unknown): Request {
    return new Request({ ...this.state, selection: value });
  }

  // Returns a copy that holds the media type that the selection of HY-116 chose for this request, once per request.
  /** @internal */
  withSelectedType(type: string): Request {
    if (this.state.mediaType !== null) throw new Error('hyper: the media type of a request is selected once (HY-116)');
    return new Request({ ...this.state, mediaType: type });
  }

  // Returns the media type that the selection chose for this request (HY-116). It fails before the selection.
  selectedType(): string {
    if (this.state.mediaType === null) throw new Error('hyper: the media type of the request is read before its selection (HY-116)');
    return this.state.mediaType;
  }

  // Returns the value of the choice that the client rendering selection returned for this request, or null for an
  // application without client rendering (HY-62).
  selection(): unknown {
    return this.state.selection;
  }

  // Returns the route parameters.
  params(): Record<string, string> {
    return { ...this.state.params };
  }

  // Returns a route parameter, or null.
  param(name: string): string | null {
    return Object.hasOwn(this.state.params, name) ? this.state.params[name] ?? null : null;
  }

  // Returns a cookie value, or null.
  cookie(name: string): string | null {
    return this.state.cookies.get(name) ?? null;
  }

  // Returns true when the path consists of printable ASCII characters and every query and form name and value
  // and HX-Current-URL are UTF-8 (HY-42). Cookies are not checked; hyper ignores invalid ones.
  validInput(): boolean {
    const current = this.state.headers.get('hx-current-url');
    return /^[\x21-\x7e]*$/.test(this.state.path) && (current === undefined || Request.utf8(current) !== null) && this.state.query !== null && this.state.form !== null && this.state.files !== null;
  }

  // Returns the file parts of the body as pairs of a name and its files in request order, in the order of the first
  // file of each name (HY-113).
  files(): [string, UploadedFile[]][] {
    return (this.state.files ?? Files.empty()).pairs();
  }

  // Returns the last file of a name, or null (HY-113).
  file(name: string): UploadedFile | null {
    return this.state.files?.last(name) ?? null;
  }

  // Returns true when a file of the body is larger than `limit` bytes (HY-114).
  fileOver(limit: number): boolean {
    return (this.state.files ?? Files.empty()).largest() > limit;
  }

  // Returns the size of the body in bytes: its length, or the Content-Length header when that is larger (HY-59).
  bodySize(): number {
    return this.state.bodySize;
  }

  // Returns the media type of the Content-Type header in lower case, without its parameters (HY-59).
  mediaType(): string {
    const type = this.header('Content-Type') ?? '';
    return type.slice(0, firstOf(type, ';')).trim().toLowerCase();
  }

  // Returns the value of a header as text whose characters are its bytes, or null.
  header(name: string): string | null {
    return this.state.headers.get(name.toLowerCase()) ?? null;
  }

  // Returns true when the selected media type of the request is the JSON of hyper (HY-15, HY-116).
  wantsJson(): boolean {
    return this.selectedType() === HYPER_JSON;
  }

  // Returns true for a region request: JSON from htmx, which sends HX-Request with every request (HY-15).
  isRegionRequest(): boolean {
    return this.wantsJson() && this.header('HX-Request') === 'true';
  }

  // Returns the path of the page that sent the request, or null (HY-11).
  currentPath(): string | null {
    const header = this.header('HX-Current-URL');
    const url = header === null ? null : Request.utf8(header);
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

  // Returns every query value without nesting, as pairs of a name and its values in request order, in the order of the
  // first value of each name (HY-56).
  query(): [string, string[]][] {
    return (this.state.query ?? Fields.empty()).pairs();
  }

  // Returns the last query value of a name as an integer, or the default when it is absent or not an integer.
  queryInt(name: string, fallback: number): number {
    const value = this.state.query?.last(name) ?? null;
    return value !== null && /^-?[0-9]{1,15}$/.test(value) ? Number(value) : fallback;
  }

  // Returns every form value of the body without nesting, as pairs of a name and its values in request order, in the
  // order of the first value of each name (HY-57).
  form(): [string, string[]][] {
    return (this.state.form ?? Fields.empty()).pairs();
  }

  // Returns the last form value of a name; an absent name gives the empty string.
  formString(name: string): string {
    return this.state.form?.last(name) ?? '';
  }

  // Returns a flash value stored by the previous action, or null.
  flash(name: string): Value {
    return this.state.flash.get(name) ?? null;
  }

  // Returns the CSRF token of the session.
  csrfToken(): string {
    return this.state.csrfToken;
  }

  // Returns the UTF-8 text of a header value whose characters are bytes, or null when the bytes are not UTF-8 (HY-42).
  private static utf8(text: string): string | null {
    try {
      return Request.decoder.decode(Buffer.from(text, 'latin1'));
    } catch (error) {
      // The fatal decoder fails bytes that are no UTF-8 with a TypeError; any other failure propagates.
      if (error instanceof TypeError) return null;
      throw error;
    }
  }
}

function firstOf(text: string, char: string): number {
  const index = text.indexOf(char);
  return index < 0 ? text.length : index;
}
