// The rules of the Rust core behind the names of the units of the Node server (HY-133.2). `coreRules` takes the module
// of the Node binding of the core, the generated entry of `native/generated`, and gives each rule under the name of the
// unit of the server that states it today, so that a unit of the server calls the core in place of its own rule. This
// file imports nothing of the package, so a test gives `coreRules` a stand-in of that module; `rules` gives the one
// shared instance of the units of the server, which it builds on first use from the addon of the package.
//
// A unit below is exact when the core decides everything that the unit of the server decides, and partial when the
// server still does a part itself; each partial unit names that part by its rule.
//
// A failure of the core reaches the caller as the binding raises it: an error of the class of its category with
// `kind` and `status` (HY-133.1, HY-133.2). No function here catches or replaces one.

import { createRequire } from 'node:module';

// A value of the data model that rules.json_read gives: maps for the objects of the text, in document order (HY-54.20).
type JsonValue = null | boolean | number | string | JsonValue[] | Map<string, JsonValue>;

// The instance of the class `Pages` of the binding, the opened application.
type CorePages = object;

// The store of a session of the session-store binding (HY-97).
type CoreStore = object;

type PageKind = 'html' | 'document_json' | 'region_json';

interface BuildOutput {
  readonly path: string;
  readonly bytes: Uint8Array;
}

// A media range of Accept as rules.accept_ranges gives it (HY-116.17): the parameters before the weight as [name,
// value] pairs, and the weight in thousandths.
interface AcceptRange {
  readonly type: string;
  readonly subtype: string;
  readonly parameters: readonly (readonly [string, string])[];
  readonly weight: number;
}

interface DataTemplate {
  readonly name: string;
  readonly source: string;
}

interface PagesOptions {
  readonly build: string;
  readonly timezone: string;
  readonly context: boolean;
  readonly basePath: string;
  readonly formTypes: Iterable<string>;
  readonly dataBasePath?: string | null;
}

/** @internal */
export interface PageInput {
  readonly route: string;
  readonly params: ReadonlyMap<string, string>;
  readonly kind: PageKind;
  readonly action: boolean;
  readonly csrf: string;
  readonly changed: Iterable<string>;
  readonly now: number;
  readonly keepCookie?: string | null;
  readonly heldHash?: string | null;
}

type Call =
  | { readonly call: 'action' | 'context' | 'shared' | 'route_loader' | 'reply' }
  | { readonly call: 'route_region_loader' | 'region_loader'; readonly region: string };

type ActionOutcome =
  | { readonly outcome: 'page'; readonly status: number; readonly data: ReadonlyMap<string, unknown> }
  | { readonly outcome: 'revision_changed' | 'no_page' };

/** @internal */
export type PageStepInput =
  | { readonly input: 'start' | 'absent' | 'no_handler' }
  | { readonly input: 'action'; readonly outcome: ActionOutcome; readonly csrf?: string | null }
  | { readonly input: 'context'; readonly context: ReadonlyMap<string, unknown> }
  | { readonly input: 'shared'; readonly shared: ReadonlyMap<string, unknown> }
  | { readonly input: 'loaded'; readonly data: ReadonlyMap<string, unknown> }
  | { readonly input: 'reply'; readonly embeds: boolean; readonly stored: ReadonlyMap<string, ReadonlyMap<string, unknown>>; readonly status?: number | null };

type Answer =
  | { readonly answer: 'document'; readonly status: number; readonly html: string }
  | { readonly answer: 'json'; readonly status: number; readonly text: string }
  | { readonly answer: 'no_page' };

type Step = { readonly step: 'call'; readonly call: Call } | { readonly step: 'answer'; readonly answer: Answer };

interface Front {
  readonly method: string;
  readonly path: string;
  readonly accept: Iterable<string>;
  readonly hxRequest: boolean;
  readonly contextHeader?: string | null;
  readonly contentType?: string | null;
}

/** @internal */
export interface Plain {
  readonly status: number;
  readonly body: Uint8Array;
  readonly varyAccept: boolean;
  readonly allow?: string | null;
}

type Route =
  | { readonly route: 'plain'; readonly answer: Plain }
  | { readonly route: 'shell' | 'keep' }
  | { readonly route: 'representation'; readonly name: string; readonly params: readonly (readonly [string, string])[]; readonly entry: number; readonly values: readonly string[] }
  | { readonly route: 'page'; readonly name: string; readonly params: readonly (readonly [string, string])[]; readonly kind: PageKind; readonly action: boolean };

interface PageResponse {
  readonly status: number;
  readonly json: boolean;
  readonly body: string;
  readonly context: boolean;
  readonly maskedToken: string;
  readonly token: string;
  readonly method: string;
  readonly cacheControl?: string | null;
  readonly ifNoneMatch?: string | null;
  readonly referrerPolicy?: string | null;
}

interface PageHeaders {
  readonly status: number;
  readonly headers: Iterable<readonly [string, string]>;
  readonly body: boolean;
}

interface Opening {
  readonly route: string;
  readonly params: Iterable<readonly [string, string]>;
  readonly kind: PageKind;
  readonly action: boolean;
  readonly path: string;
  readonly basePath: string;
  readonly mask: string;
  readonly now: number;
  readonly currentUrl?: string | null;
  readonly keepCookie?: string | null;
  readonly heldHash?: string | null;
  readonly formCsrf?: string | null;
}

type Opened =
  | { readonly opened: 'refused'; readonly answer: Plain }
  | { readonly opened: 'page'; readonly input: PageInput; readonly flash: ReadonlyMap<string, unknown>; readonly token: string };

interface KeepRequest {
  readonly region: string;
  readonly path: string;
  readonly value: string;
  readonly formCsrf?: string | null;
}

// The environment of a render, which a function of a template receives as its second argument (HYC-24.10): the time
// zone of the server and the `now` of the response in seconds since the Unix epoch.
interface Environment {
  readonly timezone: string;
  readonly now: number;
}

// A function of the templates as the binding calls it (HYC-24.10): the list of its arguments and the environment.
export type HostFunction = (args: readonly unknown[], environment: Environment) => unknown;
type CoreHostFunction = HostFunction;

interface CorePageRequest {
  next(input: PageStepInput): Step;
}

// The title and the regions of a document, each rendered alone (HY-13.1 to HY-13.3).
interface DocumentParts {
  readonly title: string;
  readonly regions: ReadonlyMap<string, string>;
}

// The data of each region of a document, by the name of the region.
type RegionsData = ReadonlyMap<string, ReadonlyMap<string, unknown>>;

/** @internal */
export interface CorePagesInstance {
  register(name: string, hostFunction: CoreHostFunction): void;
  renderDocument(route: string, shared: ReadonlyMap<string, unknown>, regions: RegionsData, now: number): string;
  renderParts(route: string, shared: ReadonlyMap<string, unknown>, regions: RegionsData, now: number): DocumentParts;
}

// The members of the Node binding of the core that the server calls, under the names that the binding gives the
// members of `packages/rust/interface.json`: a function of a unit of kind functions is a function of the module, and a
// class is a class of the module.
/** @internal */
export interface CoreBinding {
  csrfMask(token: string, mask: string): string;
  csrfVerify(token: string, value: string): boolean;
  browser(masked: string): string | null;
  storedToken(stored: string): string;
  isApplicationPath(location: string): boolean;
  redirectLocation(location: string): string;
  cacheControl(value: string): string;
  keepsOutOfSharedCaches(value: string): boolean;
  referrerPolicy(value: string): string;
  sessionName(https: boolean): string;
  keepName(https: boolean): string;
  sessionCookie(identifier: string, https: boolean): string;
  pageTag(body: string, maskedToken: string, token: string): string;
  representationTag(contentType: string, body: Uint8Array): string;
  mediaType(contentType: string): string;
  pageStatus(status: number): number;
  replyStatus(status: number): number;
  pageVary(hasContext: boolean): string;
  contextHash(build: string, text: string): string;
  currentPath(header: string | null): string | null;
  checkShellPath(path: string): void;
  shellText(path: string, bytes: Uint8Array): string;
  buildId(outputs: Iterable<BuildOutput>): string;
  buildPaths(outputs: Iterable<BuildOutput>): readonly string[];
  buildStream(outputs: Iterable<BuildOutput>): string;
  shellFile(basePath: string, build: string, entryUrl: string, entryCode: string): string;
  checkBuildId(text: string): void;
  buildFileText(id: string): string;
  readBuild(bytes: Uint8Array): string;
  templateProblems(manifest: Uint8Array, templates: ReadonlyMap<string, string>): readonly string[];
  routeReads(manifest: Uint8Array, templates: ReadonlyMap<string, string>): unknown;
  templateReads(templates: ReadonlyMap<string, string>, name: string): unknown;
  reservedDataTemplate(): DataTemplate;
  validContextHeader(value: string | null): boolean;
  checkFunctionEntry(name: string, callable: boolean): void;
  jsonRead(text: Uint8Array): JsonValue;
  jsonWrite(value: unknown): string;
  flashOf(stored: unknown): JsonValue;
  keptOf(stored: unknown): JsonValue;
  keptCookie(text: string): JsonValue;
  acceptRanges(acceptLines: Iterable<string>): readonly AcceptRange[];
  fileOver(sizes: Iterable<number>, limit: number): boolean;
  routeRequest(pages: CorePages, chosen: boolean, front: Front): Route;
  computePageHeaders(response: PageResponse): PageHeaders;
  frameHeaders(status: number, frameAncestors: string): readonly (readonly [string, string])[];
  keptValue(pages: CorePages, region: string, path: string, text: string): unknown;
  openPage(pages: CorePages, store: CoreStore, opening: Opening): Opened;
  answerKeepRequest(pages: CorePages, store: CoreStore, request: KeepRequest): Plain;
  Pages: new (manifest: Uint8Array, templates: ReadonlyMap<string, string>, reads: unknown, options: PagesOptions) => CorePagesInstance;
  PageRequest: new (pages: CorePages, input: PageInput) => CorePageRequest;
  sessionValue(record: unknown): unknown;
  sessionRecord(value: unknown): unknown;
  HyperValueError: new (message: string, kind: string, status?: number | null) => HyperError & RangeError;
  HyperTypeError: new (message: string, kind: string, status?: number | null) => HyperError & TypeError;
}


// The prefix of the name of the category classes of the binding of hyper, which stands in the place of the prefix of
// the category classes of a library: `SessionStoreStoreError` of the session-store package is `HyperStoreError`.
const OWN_PREFIX = 'Hyper';

/**
 * Returns the error of hyper for an error of a library that hyper uses (HY-133.3), or the error as it is. An error of
 * a library is an instance of a class that the package of the library exports. The class of hyper is the class of the
 * binding of hyper of the same role: the class of the same name, such as `RecordError`, or the category class, whose
 * name has `Hyper` where the category class of the library has `prefix`. The error of hyper has the message, the kind,
 * the status and the errno of the error of the library, so no kind and no category is listed here; a class of the
 * library without a class of hyper of its role is tried by its parent class, and an error that the class of hyper
 * refuses, because the contract of hyper does not list its kind, stays as it is.
 */
function libraryError(core: object, library: object, prefix: string, error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  for (let type: unknown = Object.getPrototypeOf(error); typeof type === 'object' && type !== null; type = Object.getPrototypeOf(type)) {
    const made: unknown = (type as { constructor?: unknown }).constructor;
    const name: unknown = typeof made === 'function' ? made.name : undefined;
    if (typeof name !== 'string' || name === '' || Reflect.get(library, name) !== made) continue;
    const role: unknown = Reflect.get(core, name.startsWith(prefix) ? `${OWN_PREFIX}${name.slice(prefix.length)}` : name);
    if (typeof role !== 'function') continue;
    const { kind, status, errno } = error as Error & { kind?: unknown; status?: unknown; errno?: unknown };
    try {
      // The constructor of an error class of a binding (E-2) takes the message, the kind, the status and the errno.
      const converted: unknown = Reflect.construct(role, [error.message, kind, status ?? null, errno ?? null]);
      return converted;
    } catch {
      return error;
    }
  }
  return error;
}

// An error of hyper: its kind and its status, which a caller tells failures apart by (HY-133.1, HY-133.2).
interface HyperError extends Error {
  readonly kind: string;
  readonly status: number | null;
}

// The names of the members of `CoreBinding`, which `coreRules` requires of the module that it receives.
const MEMBERS: readonly (keyof CoreBinding)[] = [
  'csrfMask', 'csrfVerify', 'browser', 'storedToken', 'isApplicationPath', 'redirectLocation', 'cacheControl', 'keepsOutOfSharedCaches',
  'referrerPolicy', 'sessionName', 'keepName', 'sessionCookie', 'pageTag', 'representationTag', 'mediaType', 'pageStatus', 'replyStatus', 'pageVary',
  'contextHash', 'currentPath', 'checkShellPath', 'shellText', 'buildId', 'buildPaths', 'buildStream', 'shellFile', 'checkBuildId', 'buildFileText', 'readBuild', 'templateProblems',
  'routeReads', 'templateReads', 'reservedDataTemplate', 'validContextHeader', 'checkFunctionEntry', 'routeRequest', 'computePageHeaders', 'frameHeaders',
  'jsonRead', 'jsonWrite', 'flashOf', 'keptOf', 'keptCookie', 'acceptRanges', 'fileOver', 'keptValue', 'openPage', 'answerKeepRequest', 'Pages', 'PageRequest', 'HyperValueError', 'HyperTypeError',
  'sessionValue', 'sessionRecord',
];

// A plain answer of the core as the parts of a response of the server: the status, the headers and the text of the body.
interface PlainResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

// The headers of a page response as the server holds them, a record in the order of the core.
interface PageHeaderParts {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: boolean;
}

/** @internal */
export interface CoreRules {
  // The error of hyper of the category value and of the category type with its kind (HY-133.2), of the classes of
  // the binding.
  valueError(message: string, kind: string): HyperError & RangeError;
  typeError(message: string, kind: string): HyperError & TypeError;
  // libraryError: the error of hyper for an error of a library, by the class of the binding of hyper of the same role
  // as the class of the error, with its message, kind and status (HY-133.3); any other value is returned as it is.
  // `library` is the module of the package of the library and `prefix` the prefix of the names of its category classes.
  libraryError(library: object, prefix: string, error: unknown): unknown;
  // sessionValue: rules.session_value gives the value of the data model of a PHP value of a session record
  // (HY-104.13), and fails with the kind of the data model for a value outside it.
  sessionValue(record: unknown): unknown;
  // sessionRecord: rules.session_record gives the PHP value of a session record of a value of the data model
  // (HY-104.14), and fails with `data_unsupported_type` for a native object.
  sessionRecord(value: unknown): unknown;
  // Exact units.
  // csrfMask: rules.csrf_mask (HY-24.2, HY-24.14).
  csrfMask(token: string, mask: string): string;
  // csrfVerify: rules.csrf_verify (HY-24.4).
  csrfVerify(token: string, value: string): boolean;
  // csrfBrowserOf: rules.browser (HY-24.10, HY-24.13).
  csrfBrowserOf(masked: string): string | null;
  // contextHash: rules.context_hash (HY-125.12).
  contextHash(build: string, text: string): string;
  // contextValidHeader: rules.valid_context_header (HY-127.2).
  contextValidHeader(value: string | null): boolean;
  // jsonCodecDecode: rules.json_read of the UTF-8 bytes of the text gives a value of the data model with maps in
  // document order, and fails with `malformed_json` or the kind of the data model (HY-54.20, HY-54.21).
  jsonCodecDecode(text: string): JsonValue;
  // jsonCodecEncode: rules.json_write gives the JSON text of a value of the data model, and fails with the kind of the
  // data model for a value that has no JSON form (HY-54.18, HY-54.19).
  jsonCodecEncode(value: unknown): string;
  // sessionFlashOf: rules.flash_of checks a stored flash and gives the map of its `values` and its `changed` topics,
  // and fails with `invalid_session_record` for a stored flash of another form (HY-25.2, HY-104.23).
  sessionFlashOf(stored: unknown): JsonValue;
  // sessionKeptOf: rules.kept_of checks stored kept values and gives the map of each region to the map of its values by
  // path, and fails with `invalid_session_record` for kept values of another form, those of every region (HY-104.22,
  // HY-104.23).
  sessionKeptOf(stored: unknown): JsonValue;
  // pageKeptCookie: rules.kept_cookie reads the cookie of the kept values to a map from each region to the map of its
  // readable values by path; a cookie that is no JSON object, a region that holds no object and a value outside the
  // data model give no value (HY-38.2, HY-38.11, HY-42).
  pageKeptCookie(text: string): JsonValue;
  // acceptParse: rules.accept_ranges gives the ranges of an Accept value in field order, the range `*/*` of the full
  // weight for a request without Accept, and fails with `invalid_accept` or `invalid_weight` of http-negotiation
  // (HY-116.17, HY-116.18).
  acceptParse(value: string | null): readonly AcceptRange[];
  // sessionCookieName: rules.session_name (HY-45.1).
  sessionCookieName(secure: boolean): string;
  // Partial. sessionCookieHeader: rules.session_cookie gives the field value (HY-45.8). The server still
  // decides when a response sets the cookie, only for a session that the request started (HY-45.4).
  sessionCookieHeader(id: string, secure: boolean): string;
  // representationEtag: rules.representation_tag (HY-122.10, HY-122.11), of the UTF-8 bytes of the body.
  representationEtag(contentType: string, body: string): string;
  // requestMediaType: rules.media_type of the value of Content-Type (HY-59.13), which throws the kind
  // `malformed_content_type` (status 400) for a value that is no media type.
  requestMediaType(contentType: string): string;
  // requestFileOver: rules.file_over of the bytes of each file of the body and the limit (HY-114.12). The binding
  // throws the kind `invalid_number` for a limit that is no unsigned integer, before the core compares the files.
  requestFileOver(sizes: readonly number[], limit: number): boolean;
  // requestCurrentPath: rules.current_path of the value of HX-Current-URL (HY-11.5).
  requestCurrentPath(header: string | null): string | null;
  // replyCacheControl: rules.cache_control gives the value that the reply keeps (HY-52.6).
  replyCacheControl(value: string): string;
  // replyReferrerPolicy: rules.referrer_policy gives the value that the reply keeps (HY-103.2, HY-103.9).
  replyReferrerPolicy(value: string): string;
  // replyStatus: rules.reply_status gives the page status that the reply keeps (HY-69).
  replyStatus(status: number): number;
  // Partial. rules.keeps_out_of_shared_caches (HY-52.6), which replyCacheControl decided inside its check; the
  // server reads it for no other rule.
  replyKeepsOutOfSharedCaches(value: string): boolean;
  // resultRedirect: rules.redirect_location gives the location of the result (HY-46).
  resultRedirect(location: string): string;
  // resultPage: rules.page_status gives the status of the result (HY-58).
  resultPage(status: number): number;
  // Partial. rules.is_application_path (HY-46), the test inside resultRedirect; the server has no caller of it
  // besides the redirect.
  resultIsApplicationPath(location: string): boolean;
  // appVaryHeader: rules.page_vary (HY-117.1).
  appVaryHeader(context: boolean): string;
  // Partial. appFrame: front_functions.frame_headers gives the headers that every response carries (HY-45.5,
  // HY-65.1). The server still adds them to its response, a header of the same name replaced.
  appFrameHeaders(status: number, frameAncestors: string): Record<string, string>;
  // Partial. appCheckedShell: rules.check_shell_path checks the path of the static shell before the server reads
  // the file, and rules.shell_text gives the text of its bytes (HY-62). The server still reads the file between both
  // calls, and checks the data base path of the declaration against the routes and the meta element of the shell
  // (HY-62.2).
  appCheckShellPath(path: string): void;
  appShellText(path: string, bytes: Uint8Array): string;
  // Partial. appDispatch: front_functions.route_request gives the route of a request (HY-62.16 to HY-62.23, HY-27,
  // HY-116, HY-127, HY-59.12). The server still reads the request (HY-42, HY-56, HY-57), answers the limits of the
  // body (HY-59.15, HY-131.32) before this call, calls the selection of client rendering (HY-62.9) and reads the media
  // type of the body (HY-59.13).
  appRoute(pages: CorePages, chosen: boolean, front: Front): Route;
  // Partial. The text responses of appDispatch: a plain answer of the core as the parts of a response (HY-58,
  // HY-27.6, HY-117.3). The server still frames it (HY-45.5) and reports it (HY-60).
  appPlain(answer: Plain): PlainResponse;
  // Partial. appStoreKept: opening_functions.answer_keep_request answers a request to the kept endpoint after its
  // route (HY-40.1, HY-59.8, HY-120.7). The server still opens and closes the session of the store (HY-97, HY-104) and
  // reads the form fields (HY-57).
  appStoreKept(pages: CorePages, store: CoreStore, request: KeepRequest): PlainResponse;
  // Partial. The value check of appStoreKept: front_functions.kept_value (HY-40.1), for a caller that stores the
  // value itself.
  appKeptValue(pages: CorePages, region: string, path: string, text: string): unknown;
  // The tag of a JSON response of pageRespond: rules.page_tag (HY-53.1).
  pageTag(body: string, maskedToken: string, token: string): string;
  // Partial. The headers of pageRespond: front_functions.compute_page_headers (HY-15.3, HY-52, HY-53, HY-65,
  // HY-103.5, HY-117.1). The server still writes the body and adds the cookies of the reply (HY-52.13).
  pageHeaders(response: PageResponse): PageHeaderParts;
  // Partial. The session of a page in appDispatch: opening_functions.open_page takes the flash data, reads the
  // token, checks the token of a POST and reads the kept values (HY-120.6, HY-24, HY-59.8, HY-40). The server still
  // draws the mask of the response (HY-24.3), reads the cookie `hy-keep` (HY-38.10) and the clock, and opens and
  // closes the session of the store (HY-97, HY-104).
  pageOpen(pages: CorePages, store: CoreStore, opening: Opening): Opened;
  // Partial. pageRespond: `page_request.new` and `page_request.next` give the steps of a page (HY-15, HY-26, HY-58,
  // HY-73, HY-75, HY-124). The server still calls each handler that a step names and gives its result to the next
  // step (HY-30, HY-54), and answers the stops of a handler (HY-50, HY-51, HY-107).
  pageRequest(pages: CorePages, input: PageInput): CorePageRequest;
  // pageDocument: `pages.render_document` gives the document of a route from the shared data and the data of each
  // region, with no kept value and no embedded data, at the time `now` (HY-12.1). It renders below a request: no
  // handler is called and no step is run.
  pageDocument(pages: CorePagesInstance, route: string, shared: ReadonlyMap<string, unknown>, regions: RegionsData, now: number): string;
  // pageParts: `pages.render_parts` gives the title and each region of the given data rendered alone, the texts
  // that the document of the same data holds in their places (HY-13.1 to HY-13.3).
  pageParts(pages: CorePagesInstance, route: string, shared: ReadonlyMap<string, unknown>, regions: RegionsData, now: number): DocumentParts;
  // Partial. sessionCsrfToken: rules.stored_token checks the value that the session holds in the place of the
  // token (HY-24.14). The server still reads the store and creates the token of a session that holds none (HY-24.1),
  // which opening_functions.open_page does once the server gives the core its store.
  sessionStoredToken(stored: string): string;
  // Partial. The name of the cookie of the kept values: rules.keep_name (HYC-13.6). The server still reads the cookie
  // from the request (HY-129).
  keptCookieName(secure: boolean): string;
  // Partial. buildRead: rules.read_build gives the build id of the bytes of a `build.json` (HY-125.23, HY-125.19).
  // The server still reads the file and names the absolute path of the file in a failure (HY-125.23).
  buildRead(bytes: Uint8Array): string;
  // Partial. rules.check_build_id (HY-125.19), for a caller that holds a build id as text.
  buildCheckId(text: string): void;
  // Partial. The build id of the command tool: rules.build_id (HY-125.15 to HY-125.17). The command tool still
  // collects the files that one build writes and gives each its path with the prefix of its place.
  buildId(outputs: Iterable<BuildOutput>): string;
  // buildPaths: rules.build_paths, the paths that the build id hashes in their order (HY-125.3).
  buildPaths(outputs: Iterable<BuildOutput>): readonly string[];
  // buildStream: rules.build_stream, the hexadecimal text of the bytes that the build id hashes (HY-125.3).
  buildStream(outputs: Iterable<BuildOutput>): string;
  // Partial. The text of the static shell: rules.shell_file (HYC-16.23). The command tool still writes the file.
  buildShellFile(basePath: string, build: string, entryUrl: string, entryCode: string): string;
  // Partial. The text of `build.json`: rules.build_file_text (HY-125.23). The command tool still writes the file.
  buildFileText(id: string): string;
  readonly Templates: {
    // Partial. The template check of the command tool: rules.template_problems (HY-48.3, HY-2, HY-3, HY-30). The
    // command tool still reads the manifest and the template files of the application.
    problems(manifest: Uint8Array, templates: ReadonlyMap<string, string>): readonly string[];
    // Partial. The read paths of the routes: rules.route_reads (HY-73). The caller still reads the manifest and the
    // sources of the templates.
    routeReads(manifest: Uint8Array, templates: ReadonlyMap<string, string>): unknown;
    // Partial. The read paths of one template: rules.template_reads (HY-73).
    reads(templates: ReadonlyMap<string, string>, name: string): unknown;
    // Partial. The reserved template of the embedded data: rules.reserved_data_template (HY-31.3).
    reserved(): DataTemplate;
  };
  readonly Application: {
    // Partial. App.open: `pages.open` checks the manifest, the templates, the read paths and the options of an
    // application (HY-2, HY-48, HY-59.1, HY-62.2) and `pages.register` registers a host function (HYC-24). The server
    // still reads the files of `program/` (HY-48.19), checks the handlers against the manifest (HY-30, HY-118) and
    // holds the limits of the body and of the response (HY-59, HY-66, HY-114, HY-131).
    open(manifest: Uint8Array, templates: ReadonlyMap<string, string>, reads: unknown, options: PagesOptions, functions: ReadonlyMap<string, CoreHostFunction>): CorePagesInstance;
    // rules.check_function_entry fails an entry of `functions` that is no function with kind `invalid_application`
    // (HYC-24.7); the server tells the core whether the entry is callable.
    checkFunctionEntry(name: string, callable: boolean): void;
  };
}

// The body of a plain answer is UTF-8 bytes, and the tag of a representation is computed from the UTF-8 bytes of its body.
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

// A plain answer with a body is text, as `Response.text` of the server writes it (HY-58); the 204 of the kept endpoint
// has no body and no `Content-Type` (HY-40.1).
function plainResponse(answer: Plain): PlainResponse {
  const headers: Record<string, string> = answer.status === 204 ? {} : { 'Content-Type': 'text/plain; charset=utf-8' };
  if (answer.allow !== undefined && answer.allow !== null) headers.Allow = answer.allow;
  if (answer.varyAccept) headers.Vary = 'Accept';
  return { status: answer.status, headers, body: decoder.decode(answer.body) };
}

// A module is the binding of the core when it has every member (MEMBERS), a function each.
function isBinding(module: object, missing: readonly string[]): module is CoreBinding {
  return missing.length === 0;
}

// Returns the rules of the core under the names of the units of the server. A module that lacks a member of the
// binding fails here with its name, before a request calls it.
/** @internal */
export function coreRules(module: object): CoreRules {
  const missing = MEMBERS.filter((name) => typeof Reflect.get(module, name) !== 'function');
  if (!isBinding(module, missing)) throw new Error(`hyper: the binding of the core has no member ${missing.join(', ')}`);
  const core = module;
  return {
    valueError: (message, kind) => new core.HyperValueError(message, kind, null),
    typeError: (message, kind) => new core.HyperTypeError(message, kind, null),
    libraryError: (library, prefix, error) => libraryError(core, library, prefix, error),
    sessionValue: (record) => core.sessionValue(record),
    sessionRecord: (value) => core.sessionRecord(value),
    csrfMask: (token, mask) => core.csrfMask(token, mask),
    csrfVerify: (token, value) => core.csrfVerify(token, value),
    csrfBrowserOf: (masked) => core.browser(masked),
    contextHash: (build, text) => core.contextHash(build, text),
    contextValidHeader: (value) => core.validContextHeader(value),
    jsonCodecDecode: (text) => core.jsonRead(encoder.encode(text)),
    jsonCodecEncode: (value) => core.jsonWrite(value),
    sessionFlashOf: (stored) => core.flashOf(stored),
    sessionKeptOf: (stored) => core.keptOf(stored),
    pageKeptCookie: (text) => core.keptCookie(text),
    acceptParse: (value) => core.acceptRanges(value === null ? [] : [value]),
    sessionCookieName: (secure) => core.sessionName(secure),
    sessionCookieHeader: (id, secure) => core.sessionCookie(id, secure),
    representationEtag: (contentType, body) => core.representationTag(contentType, encoder.encode(body)),
    requestMediaType: (contentType) => core.mediaType(contentType),
    requestFileOver: (sizes, limit) => core.fileOver(sizes, limit),
    requestCurrentPath: (header) => core.currentPath(header),
    replyCacheControl: (value) => core.cacheControl(value),
    replyReferrerPolicy: (value) => core.referrerPolicy(value),
    replyStatus: (status) => core.replyStatus(status),
    replyKeepsOutOfSharedCaches: (value) => core.keepsOutOfSharedCaches(value),
    resultRedirect: (location) => core.redirectLocation(location),
    resultPage: (status) => core.pageStatus(status),
    resultIsApplicationPath: (location) => core.isApplicationPath(location),
    appVaryHeader: (context) => core.pageVary(context),
    appFrameHeaders: (status, frameAncestors) => Object.fromEntries(core.frameHeaders(status, frameAncestors)),
    appCheckShellPath: (path) => {
      core.checkShellPath(path);
    },
    appShellText: (path, bytes) => core.shellText(path, bytes),
    appRoute: (pages, chosen, front) => core.routeRequest(pages, chosen, front),
    appPlain: (answer) => plainResponse(answer),
    appStoreKept: (pages, store, request) => plainResponse(core.answerKeepRequest(pages, store, request)),
    appKeptValue: (pages, region, path, text) => core.keptValue(pages, region, path, text),
    pageTag: (body, maskedToken, token) => core.pageTag(body, maskedToken, token),
    pageHeaders: (response) => {
      const computed = core.computePageHeaders(response);
      return { status: computed.status, headers: Object.fromEntries(computed.headers), body: computed.body };
    },
    pageOpen: (pages, store, opening) => core.openPage(pages, store, opening),
    pageRequest: (pages, input) => new core.PageRequest(pages, input),
    pageDocument: (pages, route, shared, regions, now) => pages.renderDocument(route, shared, regions, now),
    pageParts: (pages, route, shared, regions, now) => pages.renderParts(route, shared, regions, now),
    sessionStoredToken: (stored) => core.storedToken(stored),
    keptCookieName: (secure) => core.keepName(secure),
    buildRead: (bytes) => core.readBuild(bytes),
    buildCheckId: (text) => {
      core.checkBuildId(text);
    },
    buildId: (outputs) => core.buildId(outputs),
    buildPaths: (outputs) => core.buildPaths(outputs),
    buildStream: (outputs) => core.buildStream(outputs),
    buildShellFile: (basePath, build, entryUrl, entryCode) => core.shellFile(basePath, build, entryUrl, entryCode),
    buildFileText: (id) => core.buildFileText(id),
    Templates: {
      problems: (manifest, templates) => core.templateProblems(manifest, templates),
      routeReads: (manifest, templates) => core.routeReads(manifest, templates),
      reads: (templates, name) => core.templateReads(templates, name),
      reserved: () => core.reservedDataTemplate(),
    },
    Application: {
      open: (manifest, templates, reads, options, functions) => {
        const pages = new core.Pages(manifest, templates, reads, options);
        for (const [name, hostFunction] of functions) pages.register(name, hostFunction);
        return pages;
      },
      checkFunctionEntry: (name, callable) => {
        core.checkFunctionEntry(name, callable);
      },
    },
  };
}

// The generated entry of the Node binding, which loads the addon `hyper.<platform>.node` of the package (binding T-2);
// src/app and dist/app are both two directories below the package, whose files hold native/generated/index.cjs.
/** @internal */
export const ENTRY = '../../native/generated/index.cjs';

// The error of an addon that does not load, by its name `CoreBindingError`.
class CoreBindingError extends Error {
  constructor(message: string, options: { cause: unknown }) {
    super(message, options);
    this.name = 'CoreBindingError';
  }
}

// Returns the function that gives one CoreRules, built on its first successful call from the module that `load`
// returns (HY-133.2). A load that throws fails with CoreBindingError, which names the addon, at that call and at every
// later call; no rule of the server answers in its place.
/** @internal */
export function sharedRules(load: () => unknown): () => CoreRules {
  let shared: CoreRules | null = null;
  return () => {
    if (shared !== null) return shared;
    let module: unknown;
    try {
      module = load();
    } catch (error) {
      const platform = `${process.platform}-${process.arch}${process.platform === 'linux' ? '-gnu' : ''}`;
      throw new CoreBindingError(
        `hyper: the native addon hyper.${platform}.node of the Node package does not load (HY-133.2): ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    if (module === null || typeof module !== 'object') throw new CoreBindingError('hyper: the native addon of the Node package gave no module (HY-133.2)', { cause: module });
    shared = coreRules(module);
    return shared;
  };
}

// Returns the one CoreRules of the server, from the native addon of the package.
/** @internal */
export const rules: () => CoreRules = sharedRules(() => createRequire(import.meta.url)(ENTRY));
