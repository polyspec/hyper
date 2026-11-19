// One HTTP request with the session values that the application reads.
import { Csrf } from '../session/csrf.js';
import { Fields } from '../form/fields.js';
import { Files } from '../form/files.js';
import type { Flash } from '../session/flash.js';
import { UploadedFile } from '../form/uploaded-file.js';
import type { Value } from '../data/values.js';
import { Disconnected } from '../app/disconnected.js';
import { ArgumentCountError } from '../app/argument-count-error.js';
import { rules, type BodyLimits, type CoreForm } from '../app/core-rules.js';
import type { BodyReader } from '../form/body-reader.js';

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
  read?: BodyReader | null;
  // The decoded JSON body of a representation request (HY-121).
  json?: Value;
  /**
   * The signal of the connection of the request, which is aborted when the client closed the connection (HY-67).
   *
   * @internal
   */
  signal?: AbortSignal;
}

// The names of the parts of a request, the members of its options record (HY-106.9).
const REQUEST_REQUIRED = ['method', 'path'];
const REQUEST_OPTIONAL = ['headers', 'query', 'body', 'flash', 'csrfToken', 'params', 'cookies', 'https', 'selection', 'bodySize', 'media', 'read', 'json', 'signal'];

// The media type of the JSON of hyper (HY-15).
/** @internal */
export const HYPER_JSON = 'application/vnd.hyper+json';

// The form values and the files of each body that is one value, each null when it fails with HY-42, by its content
// type, and whether the core found a multipart type without a boundary: the copies of a request share its body, which
// is read once.
type HeldForm = [Fields | null, Files | null, boolean];
const READ = new WeakMap<Uint8Array, Map<string, HeldForm>>();

// The kinds of http-form of a body that passed one of its four limits (F-25, HY-131.32).
const LIMIT_KINDS = new Set(['body_limit', 'value_limit', 'part_limit', 'file_limit']);

// Limits that no body passes, for the form of a body whose limits the application judges apart (HY-59.15).
const UNBOUNDED: BodyLimits = { limit: Number.MAX_SAFE_INTEGER, valueLimit: Number.MAX_SAFE_INTEGER, partLimit: Number.MAX_SAFE_INTEGER, fileLimit: Number.MAX_SAFE_INTEGER };

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
  // True for a multipart type without a boundary, or with an empty one, as the core reads it (HY-113.24).
  private readonly noBoundary: boolean;
  private readonly media: string | null;
  private readonly read: BodyReader | null;

  // The kind of a failure of the core, or null for another error.
  private static kindOf(error: unknown): string | null {
    return error instanceof Error && 'kind' in error && typeof error.kind === 'string' ? error.kind : null;
  }

  // The form values and the files of a form of the core.
  private static formOf(form: CoreForm): [Fields, Files] {
    return [Fields.of(form.fields), Files.of(form.files.map(([name, files]) => [name, files.map((file) => UploadedFile.ofCore(file))]))];
  }

  // The form values and the files of a body held as one value, read by form_functions.read_held_body (HY-57, HY-113):
  // both null when a part fails with `invalid` or `header_limit` (HY-42, HY-113.23, HY-113.25), and none for a content
  // type that is no media type or a multipart type without a boundary, which the route judges (HY-59.12, HY-113.24); the
  // third member is true for the multipart type without a boundary.
  private static heldForm(type: string, body: Uint8Array): HeldForm {
    try {
      return [...Request.formOf(rules().formReadHeld(type === '' ? null : type, body, UNBOUNDED)), false];
    } catch (error) {
      const kind = Request.kindOf(error);
      if (kind === 'malformed_content_type' || kind === 'no_boundary') return [Fields.empty(), Files.empty(), kind === 'no_boundary'];
      if (kind === 'invalid' || kind === 'header_limit') return [null, null, false];
      throw error;
    }
  }

  // Creates a request from the parts that a host gives. The form values are read from an
  // application/x-www-form-urlencoded body and from the text fields of a multipart/form-data body, without nesting
  // (HY-57); a body that a host read in chunks gives its parts (HY-131).
  constructor(init: RequestInit) {
    ArgumentCountError.between(arguments.length, 1, 1);
    ArgumentCountError.members(init, REQUEST_REQUIRED, REQUEST_OPTIONAL);
    // HY-42.6, HY-42.7: the text that a host gives holds bytes, one for each character, and a character above U+00FF
    // fails with the kind invalid_text of the binding, in the message of the binding for its subject.
    const texts: [string, string][] = [['path', init.path], ['query', init.query ?? ''], ...Object.entries(init.headers ?? {}).flatMap(([name, value]): [string, string][] => [['header', name], ['header', value]])];
    for (const [subject, text] of texts) {
      if (/[\u0100-\uffff]/.test(text)) throw rules().valueError(`${subject} holds a character above U+00FF`, 'invalid_text');
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
    if (this.read?.core.streamed() === true) {
      // HY-131.5: a body read in chunks gives its parts, none when it failed (HY-113.25, HY-131.32).
      [this.formFields, this.fileParts] = this.read.failure === null ? Request.formOf(this.read.core.parts()) : [null, null];
      this.noBoundary = false;
    } else {
      // A body that is one value is read once for the copies of a request, which share it.
      let parts = READ.get(this.body)?.get(type);
      if (parts === undefined) {
        parts = Request.heldForm(type, this.body);
        READ.set(this.body, (READ.get(this.body) ?? new Map<string, HeldForm>()).set(type, parts));
      }
      [this.formFields, this.fileParts, this.noBoundary] = parts;
    }
  }

  /**
   * Returns true when the Content-Type is a `multipart/form-data` type without a boundary, or with an empty one, as the
   * core reads it (HY-113.24): the body was held as bytes and fails no reading, and the route judges the type.
   *
   * @internal
   */
  boundaryMissing(): boolean {
    return this.noBoundary;
  }

  // Returns a copy of this request with the given parts replaced.
  private copy(changes: Partial<RequestInit>): Request {
    return new Request({ ...this.init, ...changes });
  }

  /**
   * Returns true when the body passed the value limit, the part limit or the file limit (HY-131.32): as its host read
   * it, or for a body that is one value by its size, and by its parts and files when `streams` tells that the
   * application reads a multipart body in chunks.
   *
   * @internal
   */
  exceeded(valueLimit: number, partLimit: number, fileLimit: number, streams: boolean): boolean {
    const read = this.read;
    if (read !== null && (read.failure !== null || read.core.streamed())) return read.failure !== null && LIMIT_KINDS.has(read.failure);
    // A body that is one value passes a limit as form_functions.read_held_body reads it, in the order of the byte that
    // passes each (F-25); its parts and files count only when the application reads a multipart body in chunks.
    const type = this.headerValues.get('content-type') ?? '';
    const limits: BodyLimits = { limit: Number.MAX_SAFE_INTEGER, valueLimit, partLimit: streams ? partLimit : Number.MAX_SAFE_INTEGER, fileLimit: streams ? fileLimit : Number.MAX_SAFE_INTEGER };
    try {
      rules().formReadHeld(type === '' ? null : type, this.body, limits);
      return false;
    } catch (error) {
      const kind = Request.kindOf(error);
      if (kind !== null && LIMIT_KINDS.has(kind)) return true;
      if (kind === null || kind === 'internal') throw error;
      return false;
    }
  }

  /**
   * Removes the directory of the files of the body with the files that were not moved (HY-131.14).
   *
   * @internal
   */
  async release(): Promise<void> {
    await this.read?.core.remove();
  }

  // Returns the path of a request target: the target before `?` or `#`, after the authority of an absolute-form
  // target, without decoding (HY-42).
  static targetPath(target: string): string {
    ArgumentCountError.between(arguments.length, 1, 1);
    let path = target.split(/[?#]/, 1)[0] ?? '';
    const authority = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/]*/.exec(path);
    if (authority !== null) path = path.slice(authority[0].length);
    return path === '' ? '/' : path;
  }

  // Returns the raw query of a request target: the target after its first `?` up to its first `#` (HY-56).
  static targetQuery(target: string): string {
    ArgumentCountError.between(arguments.length, 1, 1);
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
    ArgumentCountError.between(arguments.length, 2, 2);
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
    ArgumentCountError.between(arguments.length, 0, 0);
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
    ArgumentCountError.between(arguments.length, 0, 0);
    return this.init.selection ?? null;
  }

  // Returns the route parameters.
  params(): Record<string, string> {
    ArgumentCountError.between(arguments.length, 0, 0);
    return { ...this.init.params };
  }

  // Returns a route parameter, or null.
  param(name: string): string | null {
    ArgumentCountError.between(arguments.length, 1, 1);
    const params = this.init.params ?? {};
    return Object.hasOwn(params, name) ? params[name] ?? null : null;
  }

  // Returns a cookie value, or null.
  cookie(name: string): string | null {
    ArgumentCountError.between(arguments.length, 1, 1);
    return this.init.cookies?.get(name) ?? null;
  }

  // Returns true when the path consists of printable ASCII characters and every query and form name and value
  // and HX-Current-URL are UTF-8 (HY-42). Cookies are not checked; hyper ignores invalid ones.
  validInput(): boolean {
    ArgumentCountError.between(arguments.length, 0, 0);
    const current = this.headerValues.get('hx-current-url');
    return /^[\x21-\x7e]*$/.test(this.routePath) && (current === undefined || Request.validUtf8(current)) && this.queryFields !== null && this.formFields !== null && this.fileParts !== null;
  }

  // Returns the file parts of the body as pairs of a name and its files in request order, in the order of the first
  // file of each name (HY-113).
  files(): [string, UploadedFile[]][] {
    ArgumentCountError.between(arguments.length, 0, 0);
    return (this.fileParts ?? Files.empty()).pairs();
  }

  // Returns the last file of a name, or null (HY-113).
  file(name: string): UploadedFile | null {
    ArgumentCountError.between(arguments.length, 1, 1);
    return this.fileParts?.last(name) ?? null;
  }

  // Returns true when a file of the body is larger than `limit` bytes (HY-114), as rules.file_over of the core decides
  // it. A limit that is no unsigned integer fails with `invalid_number` before the files are compared (HY-114.12).
  fileOver(limit: number): boolean {
    ArgumentCountError.between(arguments.length, 1, 1);
    return rules().requestFileOver(this.fileParts?.sizes() ?? [], limit);
  }

  // Returns the size of the body in bytes: its length, or the Content-Length header when that is larger (HY-59).
  bodySize(): number {
    ArgumentCountError.between(arguments.length, 0, 0);
    const declared = this.headerValues.get('content-length') ?? '';
    return Math.max(this.init.bodySize ?? this.body.byteLength, this.read?.core.size() ?? 0, /^[0-9]+$/.test(declared) ? Number(declared) : 0);
  }

  // Returns the media type of the Content-Type header in lower case, without its parameters, as the core reads it, or
  // the empty text without the header (HY-59.13). Throws the value error of the core with kind `malformed_content_type`
  // (status 400) for a Content-Type that is no media type.
  mediaType(): string {
    ArgumentCountError.between(arguments.length, 0, 0);
    const type = this.header('Content-Type');
    return type === null ? '' : rules().requestMediaType(type);
  }

  // Returns the value of a header as text whose characters are its bytes, or null.
  header(name: string): string | null {
    ArgumentCountError.between(arguments.length, 1, 1);
    return this.headerValues.get(name.toLowerCase()) ?? null;
  }

  // Returns true when the selected media type of the request is the JSON of hyper (HY-15, HY-116). The selection is
  // read from the request and Accept is not read again; a request without a selection fails.
  wantsJson(): boolean {
    ArgumentCountError.between(arguments.length, 0, 0);
    if (this.media === null) throw new Error('hyper: the request holds no selected media type (HY-116)');
    return this.media === HYPER_JSON;
  }

  // Returns true for a region request: JSON from htmx, which sends HX-Request with every request (HY-15).
  isRegionRequest(): boolean {
    ArgumentCountError.between(arguments.length, 0, 0);
    return this.wantsJson() && this.header('HX-Request') === 'true';
  }

  // Returns the path of the page that sent the request, or null: rules.current_path of the core (HY-11.5).
  currentPath(): string | null {
    ArgumentCountError.between(arguments.length, 0, 0);
    return rules().requestCurrentPath(this.header('HX-Current-URL'));
  }

  // Returns the request path; after routing, the path without the base path.
  path(): string {
    ArgumentCountError.between(arguments.length, 0, 0);
    return this.routePath;
  }

  // Returns the raw query of the request target, or the empty string (HY-56). Its characters are bytes, as
  // node:http gives the request target.
  rawQuery(): string {
    ArgumentCountError.between(arguments.length, 0, 0);
    return this.queryText;
  }

  // Returns every query value without nesting, as pairs of a name and its values in request order, in the order of the
  // first value of each name (HY-56).
  query(): [string, string[]][] {
    ArgumentCountError.between(arguments.length, 0, 0);
    return (this.queryFields ?? Fields.empty()).pairs();
  }

  // Returns the last query value of a name as an integer, or the default when it is absent or not an integer.
  queryInt(name: string, fallback: number): number {
    ArgumentCountError.between(arguments.length, 2, 2);
    const value = this.queryFields?.last(name) ?? null;
    return value !== null && /^-?[0-9]{1,15}$/.test(value) ? Number(value) : fallback;
  }

  // Returns every form value of the body without nesting, as pairs of a name and its values in request order, in the
  // order of the first value of each name (HY-57).
  form(): [string, string[]][] {
    ArgumentCountError.between(arguments.length, 0, 0);
    return (this.formFields ?? Fields.empty()).pairs();
  }

  // Returns the last form value of a name; an absent name gives the empty string.
  formString(name: string): string {
    ArgumentCountError.between(arguments.length, 1, 1);
    return this.formFields?.last(name) ?? '';
  }

  // Returns a flash value stored by the previous action, or null.
  flash(name: string): Value {
    ArgumentCountError.between(arguments.length, 1, 1);
    return this.init.flash?.get(name) ?? null;
  }

  // Returns the CSRF token of the session.
  csrfToken(): string {
    ArgumentCountError.between(arguments.length, 0, 0);
    return this.init.csrfToken ?? '';
  }

  // Returns the digest of the session token, which names the browser of the request, or null for a request without
  // a session (HY-24.10).
  browser(): string | null {
    ArgumentCountError.between(arguments.length, 0, 0);
    return Csrf.browserOf(this.csrfToken());
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
