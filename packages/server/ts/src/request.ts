// One HTTP request with the session values that the application reads.
import { Fields } from './fields.js';
import { Files } from './files.js';
import { Multipart } from './multipart.js';
import type { RequestBody } from './request-body.js';
import type { Flash } from './flash.js';
import type { UploadedFile } from './uploaded-file.js';
import type { Value } from './values.js';
import { Disconnected } from './disconnected.js';

// The parts of a request as its host gives them, the named parameters of the constructor (HY-106): the path and the raw
// query of the request target and the header values are text whose characters are bytes, and the body is bytes. The
// server gives the parts after `https` when it copies a request.
export interface RequestInit {
  method: string;
  path: string;
  // The header values by their names in any case.
  headers?: Record<string, string>;
  // The raw query: the request target after its first `?` up to its first `#`.
  query?: string;
  body?: Uint8Array;
  flash?: ReadonlyMap<string, Value>;
  csrfToken?: string;
  params?: Record<string, string>;
  // The cookie values by name, of the one parse of the Cookie header (HY-129).
  cookies?: ReadonlyMap<string, string>;
  https?: boolean;
  // The value of the choice of the client rendering selection (HY-62).
  selection?: unknown;
  // The size of the body that the host received, when it stopped reading a body larger than the limit (HY-59); the
  // default is the length of the body.
  bodySize?: number | null;
  // The media type that the selection of HY-116 chose, or null before the selection.
  media?: string | null;
  /**
   * The body as the host read it, whose directory holds the files of a body read in chunks (HY-131), or null.
   *
   * @internal
   */
  read?: RequestBody | null;
  // The decoded JSON body of a representation request (HY-121).
  json?: Value;
  /**
   * The signal of the connection of the request, which is aborted when the client closed the connection (HY-67).
   *
   * @internal
   */
  signal?: AbortSignal;
}

// The media type of the JSON of hyper (HY-15).
/** @internal */
export const HYPER_JSON = 'application/vnd.hyper+json';

// The form values and the files of each body that is one value, each null when it fails with HY-42, and the number of
// its parts when it is multipart (HY-131.12), by its content type: the copies of a request share its body, which is
// read once.
const READ = new WeakMap<Uint8Array, Map<string, [Fields | null, Files | null, number]>>();

export class Request {
  // ignoreBOM keeps a leading U+FEFF as a character, as PHP and Python decode it; the default of TextDecoder drops it.
  private static readonly decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  readonly method: string;
  readonly https: boolean;
  private readonly init: RequestInit;
  private readonly routePath: string;
  private readonly headerValues: Map<string, string>;
  private readonly body: Uint8Array;
  private readonly queryText: string;
  // The query values, the form values and the file parts of the body (HY-56, HY-57, HY-113), each null when it fails
  // with HY-42.
  private readonly queryFields: Fields | null;
  private readonly formFields: Fields | null;
  private readonly fileParts: Files | null;
  private readonly partCount: number;
  private readonly media: string | null;
  private readonly read: RequestBody | null;

  // Creates a request from the parts that a host gives. The form values are read from an
  // application/x-www-form-urlencoded body and from the text fields of a multipart/form-data body, without nesting
  // (HY-57); a body that a host read in chunks gives its parts (HY-131).
  constructor(init: RequestInit) {
    // HY-42.6: the text that a host gives holds bytes, one for each character.
    for (const text of [init.path, init.query ?? '', ...Object.entries(init.headers ?? {}).flat()]) {
      if (/[\u0100-\uffff]/.test(text)) throw new Error('hyper: a path, a query or a header of a request holds a character above U+00FF (HY-42)');
    }
    this.init = init;
    this.method = init.method;
    this.https = init.https ?? false;
    this.routePath = init.path;
    this.headerValues = new Map(Object.entries(init.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]));
    this.queryText = init.query ?? '';
    this.body = init.body ?? EMPTY;
    this.media = init.media ?? null;
    this.read = init.read ?? null;
    this.queryFields = Fields.parse(Buffer.from(this.queryText, 'latin1'));
    const type = this.headerValues.get('content-type') ?? '';
    if (this.read?.streamed() === true) {
      const parts = this.read.parts();
      this.formFields = parts?.[0] ?? null;
      this.fileParts = parts?.[1] ?? null;
      this.partCount = 0;
    } else {
      // A body that is one value is read once for the copies of a request, which share it.
      let parts = READ.get(this.body)?.get(type);
      if (parts === undefined) {
        const boundary = Multipart.boundary(type);
        if (boundary === null) {
          parts = [Fields.fromBody(type, this.body), Files.empty(), 0];
        } else {
          // A multipart body that is one value is read once, which also gives the number of its parts.
          const reader = new Multipart(boundary, null, null, null, null);
          const read = reader.feed(this.body) ? reader.result() : null;
          parts = [read?.[0] ?? null, read?.[1] ?? null, reader.count()];
        }
        READ.set(this.body, (READ.get(this.body) ?? new Map<string, [Fields | null, Files | null, number]>()).set(type, parts));
      }
      [this.formFields, this.fileParts, this.partCount] = parts;
    }
  }

  // Returns a copy of this request with the given parts replaced.
  private copy(changes: Partial<RequestInit>): Request {
    return new Request({ ...this.init, ...changes });
  }

  /**
   * Returns true when the body passed the value limit, the part limit or the file limit (HY-131.11): as its host read
   * it, or for a body that is one value by its size, and by its parts and files when `streams` tells that the
   * application reads a multipart body in chunks.
   *
   * @internal
   */
  exceeded(valueLimit: number, partLimit: number, fileLimit: number, streams: boolean): boolean {
    const read = this.read;
    if (read !== null && (read.exceeded() || read.streamed())) return read.exceeded();
    return this.body.byteLength > valueLimit || (streams && (this.partCount > partLimit || (this.fileParts?.largest() ?? 0) > fileLimit));
  }

  /**
   * Removes the directory of the files of the body with the files that were not moved (HY-131.14).
   *
   * @internal
   */
  async release(): Promise<void> {
    await this.read?.remove();
  }

  // Returns the path of a request target: the target before `?` or `#`, after the authority of an absolute-form
  // target, without decoding (HY-42).
  static targetPath(target: string): string {
    let path = target.split(/[?#]/, 1)[0] ?? '';
    const authority = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/]*/.exec(path);
    if (authority !== null) path = path.slice(authority[0].length);
    return path === '' ? '/' : path;
  }

  // Returns the raw query of a request target: the target after its first `?` up to its first `#` (HY-56).
  static targetQuery(target: string): string {
    const before = target.split('#', 1)[0] ?? '';
    const question = before.indexOf('?');
    return question < 0 ? '' : before.slice(question + 1);
  }

  // Returns a copy that holds the flash values and the CSRF token of the session.
  /** @internal */
  withSession(flash: Flash, csrfToken: string): Request {
    return this.copy({ flash: flash.values, csrfToken });
  }

  // Returns a copy with the routed path (base path removed) and the route parameters.
  /** @internal */
  withRoute(path: string, params: Record<string, string>): Request {
    return this.copy({ path, params });
  }

  // Returns a copy whose header of the name, compared without case as `header` reads it, has the value (HY-97).
  withHeader(name: string, value: string): Request {
    return this.copy({ headers: { ...Object.fromEntries(this.headerValues), [name.toLowerCase()]: value } });
  }

  // Returns a copy that holds the value of the choice of the client rendering selection (HY-62).
  /** @internal */
  withSelection(value: unknown): Request {
    return this.copy({ selection: value });
  }

  // Returns the request that a representation handler receives: without the Cookie header and the cookies, and with the
  // decoded JSON value of its body (HY-121).
  /** @internal */
  asRepresentation(value: Value): Request {
    const headers = Object.fromEntries(this.headerValues);
    delete headers.cookie;
    return this.copy({ headers, cookies: new Map(), json: value });
  }

  // Returns a copy with the method GET, as which the server answers a HEAD request (HY-27.4).
  /** @internal */
  asGet(): Request {
    return this.copy({ method: 'GET' });
  }

  // Returns the bytes of the body as the host gave them.
  /** @internal */
  bodyBytes(): Uint8Array {
    return this.body;
  }

  // Returns the value of the JSON body of a representation request, or null for a request without a body (HY-121.9).
  json(): Value {
    return this.init.json ?? null;
  }

  // Returns a copy that holds the media type that the server selected for the request (HY-116).
  /** @internal */
  withMedia(type: string): Request {
    return this.copy({ media: type });
  }

  // Returns a copy that holds the signal of the connection of the request (HY-67).
  /** @internal */
  withSignal(signal: AbortSignal): Request {
    return this.copy({ signal });
  }

  // Throws Disconnected when the client of the request closed the connection, so that no further loader, action or
  // rendering runs (HY-67).
  /** @internal */
  stopClosed(): void {
    if (this.init.signal?.aborted === true) throw new Disconnected('hyper: the client closed the connection');
  }

  // Returns the value of the choice that the client rendering selection returned for this request, or null for an
  // application without client rendering (HY-62).
  selection(): unknown {
    return this.init.selection ?? null;
  }

  // Returns the route parameters.
  params(): Record<string, string> {
    return { ...this.init.params };
  }

  // Returns a route parameter, or null.
  param(name: string): string | null {
    const params = this.init.params ?? {};
    return Object.hasOwn(params, name) ? params[name] ?? null : null;
  }

  // Returns a cookie value, or null.
  cookie(name: string): string | null {
    return this.init.cookies?.get(name) ?? null;
  }

  // Returns true when the path consists of printable ASCII characters and every query and form name and value
  // and HX-Current-URL are UTF-8 (HY-42). Cookies are not checked; hyper ignores invalid ones.
  validInput(): boolean {
    const current = this.headerValues.get('hx-current-url');
    return /^[\x21-\x7e]*$/.test(this.routePath) && (current === undefined || Request.validUtf8(current)) && this.queryFields !== null && this.formFields !== null && this.fileParts !== null;
  }

  // Returns the file parts of the body as pairs of a name and its files in request order, in the order of the first
  // file of each name (HY-113).
  files(): [string, UploadedFile[]][] {
    return (this.fileParts ?? Files.empty()).pairs();
  }

  // Returns the last file of a name, or null (HY-113).
  file(name: string): UploadedFile | null {
    return this.fileParts?.last(name) ?? null;
  }

  // Returns true when a file of the body is larger than `limit` bytes (HY-114).
  fileOver(limit: number): boolean {
    return (this.fileParts ?? Files.empty()).largest() > limit;
  }

  // Returns the size of the body in bytes: its length, or the Content-Length header when that is larger (HY-59).
  bodySize(): number {
    const declared = this.headerValues.get('content-length') ?? '';
    return Math.max(this.init.bodySize ?? this.body.byteLength, this.read?.size() ?? 0, /^[0-9]+$/.test(declared) ? Number(declared) : 0);
  }

  // Returns the media type of the Content-Type header in lower case, without its parameters (HY-59).
  mediaType(): string {
    const type = this.header('Content-Type') ?? '';
    return (type.split(';', 1)[0] ?? '').trim().toLowerCase();
  }

  // Returns the value of a header as text whose characters are its bytes, or null.
  header(name: string): string | null {
    return this.headerValues.get(name.toLowerCase()) ?? null;
  }

  // Returns true when the selected media type of the request is the JSON of hyper (HY-15, HY-116). The selection is
  // read from the request and Accept is not read again; a request without a selection fails.
  wantsJson(): boolean {
    if (this.media === null) throw new Error('hyper: the request holds no selected media type (HY-116)');
    return this.media === HYPER_JSON;
  }

  // Returns true for a region request: JSON from htmx, which sends HX-Request with every request (HY-15).
  isRegionRequest(): boolean {
    return this.wantsJson() && this.header('HX-Request') === 'true';
  }

  // Returns the path of the page that sent the request, or null (HY-11).
  currentPath(): string | null {
    const header = this.header('HX-Current-URL');
    if (header === null || !Request.validUtf8(header)) return null;
    const url = Buffer.from(header, 'latin1').toString('utf8');
    const rest = url.replace(/^([A-Za-z][A-Za-z0-9+.-]*:)?\/\/[^/?#]*/, '');
    const path = rest.split(/[?#]/, 1)[0] ?? '';
    return path === '' ? null : path;
  }

  // Returns the request path; after routing, the path without the base path.
  path(): string {
    return this.routePath;
  }

  // Returns the raw query of the request target, or the empty string (HY-56). Its characters are bytes, as
  // node:http gives the request target.
  rawQuery(): string {
    return this.queryText;
  }

  // Returns every query value without nesting, as pairs of a name and its values in request order, in the order of the
  // first value of each name (HY-56).
  query(): [string, string[]][] {
    return (this.queryFields ?? Fields.empty()).pairs();
  }

  // Returns the last query value of a name as an integer, or the default when it is absent or not an integer.
  queryInt(name: string, fallback: number): number {
    const value = this.queryFields?.last(name) ?? null;
    return value !== null && /^-?[0-9]{1,15}$/.test(value) ? Number(value) : fallback;
  }

  // Returns every form value of the body without nesting, as pairs of a name and its values in request order, in the
  // order of the first value of each name (HY-57).
  form(): [string, string[]][] {
    return (this.formFields ?? Fields.empty()).pairs();
  }

  // Returns the last form value of a name; an absent name gives the empty string.
  formString(name: string): string {
    return this.formFields?.last(name) ?? '';
  }

  // Returns a flash value stored by the previous action, or null.
  flash(name: string): Value {
    return this.init.flash?.get(name) ?? null;
  }

  // Returns the CSRF token of the session.
  csrfToken(): string {
    return this.init.csrfToken ?? '';
  }

  // Returns true when the bytes of a header value, a text whose characters are bytes, are valid UTF-8 (HY-42).
  private static validUtf8(text: string): boolean {
    try {
      Request.decoder.decode(Buffer.from(text, 'latin1'));
      return true;
    } catch (error) {
      // The fatal decoder fails bytes that are no UTF-8 with a TypeError; any other failure propagates.
      if (error instanceof TypeError) return false;
      throw error;
    }
  }
}

// The body of a request without a body.
const EMPTY = new Uint8Array();
