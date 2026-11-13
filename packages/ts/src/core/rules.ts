// The rules of the Rust core behind the names of the units of the Node server (HY-132.2). `coreRules` takes the module
// of the Node binding of the core, the generated entry of `native/generated`, and gives each rule under the name of the
// unit of the server that states it today, so that a unit of the server calls the core in place of its own rule. This
// file imports nothing of the package, and its caller loads the binding, so a test gives it a stand-in of that module.
//
// A unit below is exact when the core decides everything that the unit of the server decides, and partial when the
// server still does a part itself; each partial unit names that part by its rule.
//
// A failure of the core reaches the caller as the binding raises it: an error of the class of its category with
// `kind` and `status` (HY-132.1, HY-132.2). No function here catches or replaces one.

// A value of the template data model as the binding passes it (HY-44).
export type CoreValue = unknown;

// The instance of the class `Pages` of the binding, the opened application.
export type CorePages = object;

// The store of a session of the session-store binding (HY-97).
export type CoreStore = object;

export type PageKind = 'html' | 'document_json' | 'region_json';

export interface BuildOutput {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface DataTemplate {
  readonly name: string;
  readonly source: string;
}

export interface PagesOptions {
  readonly build: string;
  readonly timezone: string;
  readonly context: boolean;
  readonly basePath: string;
  readonly formTypes: Iterable<string>;
  readonly dataBasePath?: string | null;
}

export interface PageInput {
  readonly route: string;
  readonly params: ReadonlyMap<string, string>;
  readonly kind: PageKind;
  readonly action: boolean;
  readonly csrf: string;
  readonly changed: Iterable<string>;
  readonly stored: ReadonlyMap<string, ReadonlyMap<string, CoreValue>>;
  readonly now: number;
  readonly keepCookie?: string | null;
  readonly heldHash?: string | null;
}

export type Call =
  | { readonly call: 'action' | 'context' | 'shared' | 'route_loader' | 'reply' }
  | { readonly call: 'route_region_loader' | 'region_loader'; readonly region: string };

export type ActionOutcome =
  | { readonly outcome: 'page'; readonly status: number; readonly data: ReadonlyMap<string, CoreValue> }
  | { readonly outcome: 'revision_changed' | 'no_page' };

export type PageStepInput =
  | { readonly input: 'start' | 'absent' | 'no_handler' }
  | { readonly input: 'action'; readonly outcome: ActionOutcome }
  | { readonly input: 'context'; readonly context: ReadonlyMap<string, CoreValue> }
  | { readonly input: 'shared'; readonly shared: ReadonlyMap<string, CoreValue> }
  | { readonly input: 'loaded'; readonly data: ReadonlyMap<string, CoreValue> }
  | { readonly input: 'reply'; readonly embeds: boolean; readonly status?: number | null };

export type Answer =
  | { readonly answer: 'document'; readonly status: number; readonly html: string }
  | { readonly answer: 'json'; readonly status: number; readonly text: string }
  | { readonly answer: 'no_page' };

export type Step = { readonly step: 'call'; readonly call: Call } | { readonly step: 'answer'; readonly answer: Answer };

export interface Front {
  readonly method: string;
  readonly path: string;
  readonly accept: Iterable<string>;
  readonly hxRequest: boolean;
  readonly malformedContentType: boolean;
  readonly contextHeader?: string | null;
  readonly mediaType?: string | null;
}

export interface Plain {
  readonly status: number;
  readonly body: Uint8Array;
  readonly varyAccept: boolean;
  readonly allow?: string | null;
}

export type Route =
  | { readonly route: 'plain'; readonly answer: Plain }
  | { readonly route: 'shell' | 'keep' }
  | { readonly route: 'representation'; readonly name: string; readonly params: readonly (readonly [string, string])[]; readonly entry: number; readonly values: readonly string[] }
  | { readonly route: 'page'; readonly name: string; readonly params: readonly (readonly [string, string])[]; readonly kind: PageKind; readonly action: boolean };

export interface PageResponse {
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

export interface PageHeaders {
  readonly status: number;
  readonly headers: Iterable<readonly [string, string]>;
  readonly body: boolean;
}

export interface Opening {
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

export type Opened =
  | { readonly opened: 'refused'; readonly answer: Plain }
  | { readonly opened: 'page'; readonly input: PageInput; readonly flash: ReadonlyMap<string, CoreValue>; readonly token: string };

export interface KeepRequest {
  readonly region: string;
  readonly path: string;
  readonly value: string;
  readonly formCsrf?: string | null;
}

// A host function of the templates as the binding calls it (HYC-24).
export type CoreHostFunction = (args: readonly CoreValue[], environment: unknown) => CoreValue;

export interface CorePageRequest {
  next(input: PageStepInput): Step;
}

export interface CorePagesInstance {
  register(name: string, hostFunction: CoreHostFunction): void;
}

// The members of the Node binding of the core that the server calls, under the names that the binding gives the
// members of `packages/rust/interface.json`: a function of a unit of kind functions is a function of the module, and a
// class is a class of the module.
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
  pageStatus(status: number): number;
  replyStatus(status: number): number;
  pageVary(hasContext: boolean): string;
  contextHash(build: string, text: string): string;
  currentPath(header: string | null): string | null;
  checkShellPath(path: string): void;
  shellText(path: string, bytes: Uint8Array): string;
  buildId(outputs: Iterable<BuildOutput>): string;
  checkBuildId(text: string): void;
  buildFileText(id: string): string;
  readBuild(bytes: Uint8Array): string;
  templateProblems(manifest: Uint8Array, templates: ReadonlyMap<string, string>): readonly string[];
  routeReads(manifest: Uint8Array, templates: ReadonlyMap<string, string>): CoreValue;
  templateReads(templates: ReadonlyMap<string, string>, name: string): CoreValue;
  reservedDataTemplate(): DataTemplate;
  validContextHeader(value: string | null): boolean;
  routeRequest(pages: CorePages, chosen: boolean, front: Front): Route;
  computePageHeaders(response: PageResponse): PageHeaders;
  frameHeaders(status: number, frameAncestors: string): readonly (readonly [string, string])[];
  keptValue(pages: CorePages, region: string, path: string, text: string): CoreValue | null;
  openPage(pages: CorePages, store: CoreStore, opening: Opening): Opened;
  answerKeepRequest(pages: CorePages, store: CoreStore, request: KeepRequest): Plain;
  Pages: new (manifest: Uint8Array, templates: ReadonlyMap<string, string>, reads: CoreValue, options: PagesOptions) => CorePagesInstance;
  PageRequest: new (pages: CorePages, input: PageInput) => CorePageRequest;
}

// The names of the members of `CoreBinding`, which `coreRules` requires of the module that it receives.
const MEMBERS: readonly (keyof CoreBinding)[] = [
  'csrfMask', 'csrfVerify', 'browser', 'storedToken', 'isApplicationPath', 'redirectLocation', 'cacheControl', 'keepsOutOfSharedCaches',
  'referrerPolicy', 'sessionName', 'keepName', 'sessionCookie', 'pageTag', 'representationTag', 'pageStatus', 'replyStatus', 'pageVary',
  'contextHash', 'currentPath', 'checkShellPath', 'shellText', 'buildId', 'checkBuildId', 'buildFileText', 'readBuild', 'templateProblems',
  'routeReads', 'templateReads', 'reservedDataTemplate', 'validContextHeader', 'routeRequest', 'computePageHeaders', 'frameHeaders',
  'keptValue', 'openPage', 'answerKeepRequest', 'Pages', 'PageRequest',
];

// A plain answer of the core as the parts of a response of the server: the status, the headers and the text of the body.
export interface PlainResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

// The headers of a page response as the server holds them, a record in the order of the core.
export interface PageHeaderParts {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: boolean;
}

export interface CoreRules {
  // Exact units.
  readonly Csrf: {
    // Csrf.mask: rules.csrf_mask (HY-24.2, HY-24.14).
    mask(token: string, mask: string): string;
    // Csrf.verify: rules.csrf_verify (HY-24.4).
    verify(token: string, value: string): boolean;
    // Csrf.browserOf: rules.browser (HY-24.10, HY-24.13).
    browserOf(masked: string): string | null;
  };
  readonly Context: {
    // Context.hash: rules.context_hash (HY-125.12).
    hash(build: string, text: string): string;
    // Context.validHeader: rules.valid_context_header (HY-127.2).
    validHeader(value: string | null): boolean;
  };
  readonly RecordSession: {
    // RecordSession.cookieName: rules.session_name (HY-45.1).
    cookieName(secure: boolean): string;
    // Partial. RecordSession.cookieHeader: rules.session_cookie gives the field value (HY-45.8). The server still
    // decides when a response sets the cookie, only for a session that the request started (HY-45.4).
    cookieHeader(id: string, secure: boolean): string;
  };
  readonly RepresentationResponse: {
    // RepresentationResponse.etag: rules.representation_tag (HY-122.10, HY-122.11), of the UTF-8 bytes of the body.
    etag(contentType: string, body: string): string;
  };
  readonly Request: {
    // Request.currentPath: rules.current_path of the value of HX-Current-URL (HY-11.4).
    currentPath(header: string | null): string | null;
  };
  readonly Reply: {
    // Reply.cacheControl: rules.cache_control gives the value that the reply keeps (HY-52.6).
    cacheControl(value: string): string;
    // Reply.referrerPolicy: rules.referrer_policy gives the value that the reply keeps (HY-103.2, HY-103.9).
    referrerPolicy(value: string): string;
    // Reply.status: rules.reply_status gives the page status that the reply keeps (HY-69).
    status(status: number): number;
    // Partial. rules.keeps_out_of_shared_caches (HY-52.6), which Reply.cacheControl decided inside its check; the
    // server reads it for no other rule.
    keepsOutOfSharedCaches(value: string): boolean;
  };
  readonly Result: {
    // Result.redirect: rules.redirect_location gives the location of the result (HY-46).
    redirect(location: string): string;
    // Result.page: rules.page_status gives the status of the result (HY-58).
    page(status: number): number;
    // Partial. rules.is_application_path (HY-46), the test inside Result.redirect; the server has no caller of it
    // besides the redirect.
    isApplicationPath(location: string): boolean;
  };
  readonly App: {
    // App.varyHeader: rules.page_vary (HY-117.1).
    varyHeader(context: boolean): string;
    // Partial. App.frame: front_functions.frame_headers gives the headers that every response carries (HY-45.5,
    // HY-65.1). The server still adds them to its response, a header of the same name replaced.
    frameHeaders(status: number, frameAncestors: string): Record<string, string>;
    // Partial. App.checkedShell: rules.check_shell_path checks the path of the static shell before the server reads
    // the file, and rules.shell_text gives the text of its bytes (HY-62). The server still reads the file between both
    // calls, and checks the data base path of the declaration against the routes and the meta element of the shell
    // (HY-62.2).
    checkShellPath(path: string): void;
    shellText(path: string, bytes: Uint8Array): string;
    // Partial. App.dispatch: front_functions.route_request gives the route of a request (HY-62.16 to HY-62.23, HY-27,
    // HY-116, HY-127, HY-59.12). The server still reads the request (HY-42, HY-56, HY-57), answers the limits of the
    // body (HY-59.4, HY-131.11) before this call, calls the selection of client rendering (HY-62.9) and reads the media
    // type of the body (HY-59.13).
    route(pages: CorePages, chosen: boolean, front: Front): Route;
    // Partial. The text responses of App.dispatch: a plain answer of the core as the parts of a response (HY-58,
    // HY-27.6, HY-117.3). The server still frames it (HY-45.5) and reports it (HY-60).
    plain(answer: Plain): PlainResponse;
    // Partial. App.storeKept: opening_functions.answer_keep_request answers a request to the kept endpoint after its
    // route (HY-40.1, HY-59.8, HY-120.7). The server still opens and closes the session of the store (HY-97, HY-104) and
    // reads the form fields (HY-57).
    storeKept(pages: CorePages, store: CoreStore, request: KeepRequest): PlainResponse;
    // Partial. The value check of App.storeKept: front_functions.kept_value (HY-40.1), for a caller that stores the
    // value itself.
    keptValue(pages: CorePages, region: string, path: string, text: string): CoreValue | null;
  };
  readonly Page: {
    // The tag of a JSON response of Page.respond: rules.page_tag (HY-53.1).
    tag(body: string, maskedToken: string, token: string): string;
    // Partial. The headers of Page.respond: front_functions.compute_page_headers (HY-15.3, HY-52, HY-53, HY-65,
    // HY-103.5, HY-117.1). The server still writes the body and adds the cookies of the reply (HY-52.13).
    headers(response: PageResponse): PageHeaderParts;
    // Partial. The session of a page in App.dispatch: opening_functions.open_page takes the flash data, reads the
    // token, checks the token of a POST and reads the kept values (HY-120.6, HY-24, HY-59.8, HY-40). The server still
    // draws the mask of the response (HY-24.3), reads the cookie `hy-keep` (HY-38.10) and the clock, and opens and
    // closes the session of the store (HY-97, HY-104).
    open(pages: CorePages, store: CoreStore, opening: Opening): Opened;
    // Partial. Page.respond: `page_request.new` and `page_request.next` give the steps of a page (HY-15, HY-26, HY-58,
    // HY-73, HY-75, HY-124). The server still calls each handler that a step names and gives its result to the next
    // step (HY-30, HY-54), and answers the stops of a handler (HY-50, HY-51, HY-107).
    request(pages: CorePages, input: PageInput): CorePageRequest;
  };
  readonly Session: {
    // Partial. Session.csrfToken: rules.stored_token checks the value that the session holds in the place of the
    // token (HY-24.14). The server still reads the store and creates the token of a session that holds none (HY-24.1),
    // which opening_functions.open_page does once the server gives the core its store.
    storedToken(stored: string): string;
  };
  readonly Kept: {
    // Partial. The name of the cookie of the kept values: rules.keep_name (HYC-13.6). The server still reads the cookie
    // from the request (HY-129).
    cookieName(secure: boolean): string;
  };
  readonly Build: {
    // Partial. Build.read: rules.read_build gives the build id of the bytes of a `build.json` (HY-125.18, HY-125.19).
    // The server still reads the file and names the absolute path of the file in a failure (HY-125.18).
    read(bytes: Uint8Array): string;
    // Partial. rules.check_build_id (HY-125.19), for a caller that holds a build id as text.
    checkId(text: string): void;
    // Partial. The build id of the command tool: rules.build_id (HY-125.15 to HY-125.17). The command tool still
    // collects the files that one build writes and gives each its path with the prefix of its place.
    id(outputs: Iterable<BuildOutput>): string;
    // Partial. The text of `build.json`: rules.build_file_text (HY-125.18). The command tool still writes the file.
    fileText(id: string): string;
  };
  readonly Templates: {
    // Partial. The template check of the command tool: rules.template_problems (HY-48.3, HY-2, HY-3, HY-30). The
    // command tool still reads the manifest and the template files of the application.
    problems(manifest: Uint8Array, templates: ReadonlyMap<string, string>): readonly string[];
    // Partial. The read paths of the routes: rules.route_reads (HY-73). The caller still reads the manifest and the
    // sources of the templates.
    routeReads(manifest: Uint8Array, templates: ReadonlyMap<string, string>): CoreValue;
    // Partial. The read paths of one template: rules.template_reads (HY-73).
    reads(templates: ReadonlyMap<string, string>, name: string): CoreValue;
    // Partial. The reserved template of the embedded data: rules.reserved_data_template (HY-31.3). The build still
    // writes its copy for a server that does not call the core (HY-31.10).
    reserved(): DataTemplate;
  };
  readonly Application: {
    // Partial. App.open: `pages.open` checks the manifest, the templates, the read paths and the options of an
    // application (HY-2, HY-48, HY-59.1, HY-62.2) and `pages.register` registers a host function (HYC-24). The server
    // still reads the files of `program/` (HY-48.11), checks the handlers against the manifest (HY-30, HY-118) and
    // holds the limits of the body and of the response (HY-59, HY-66, HY-114, HY-131).
    open(manifest: Uint8Array, templates: ReadonlyMap<string, string>, reads: CoreValue, options: PagesOptions, functions: ReadonlyMap<string, CoreHostFunction>): CorePages;
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

// Returns the rules of the core under the names of the units of the server. A module that lacks a member of the
// binding fails here with its name, before a request calls it.
export function coreRules(core: CoreBinding): CoreRules {
  const record: Record<string, unknown> = core as unknown as Record<string, unknown>;
  const missing = MEMBERS.filter((name) => typeof record[name] !== 'function');
  if (missing.length > 0) throw new Error(`hyper: the binding of the core has no member ${missing.join(', ')}`);
  return {
    Csrf: {
      mask: (token, mask) => core.csrfMask(token, mask),
      verify: (token, value) => core.csrfVerify(token, value),
      browserOf: (masked) => core.browser(masked),
    },
    Context: {
      hash: (build, text) => core.contextHash(build, text),
      validHeader: (value) => core.validContextHeader(value),
    },
    RecordSession: {
      cookieName: (secure) => core.sessionName(secure),
      cookieHeader: (id, secure) => core.sessionCookie(id, secure),
    },
    RepresentationResponse: {
      etag: (contentType, body) => core.representationTag(contentType, encoder.encode(body)),
    },
    Request: {
      currentPath: (header) => core.currentPath(header),
    },
    Reply: {
      cacheControl: (value) => core.cacheControl(value),
      referrerPolicy: (value) => core.referrerPolicy(value),
      status: (status) => core.replyStatus(status),
      keepsOutOfSharedCaches: (value) => core.keepsOutOfSharedCaches(value),
    },
    Result: {
      redirect: (location) => core.redirectLocation(location),
      page: (status) => core.pageStatus(status),
      isApplicationPath: (location) => core.isApplicationPath(location),
    },
    App: {
      varyHeader: (context) => core.pageVary(context),
      frameHeaders: (status, frameAncestors) => Object.fromEntries(core.frameHeaders(status, frameAncestors)),
      checkShellPath: (path) => {
        core.checkShellPath(path);
      },
      shellText: (path, bytes) => core.shellText(path, bytes),
      route: (pages, chosen, front) => core.routeRequest(pages, chosen, front),
      plain: (answer) => plainResponse(answer),
      storeKept: (pages, store, request) => plainResponse(core.answerKeepRequest(pages, store, request)),
      keptValue: (pages, region, path, text) => core.keptValue(pages, region, path, text),
    },
    Page: {
      tag: (body, maskedToken, token) => core.pageTag(body, maskedToken, token),
      headers: (response) => {
        const computed = core.computePageHeaders(response);
        return { status: computed.status, headers: Object.fromEntries(computed.headers), body: computed.body };
      },
      open: (pages, store, opening) => core.openPage(pages, store, opening),
      request: (pages, input) => new core.PageRequest(pages, input),
    },
    Session: {
      storedToken: (stored) => core.storedToken(stored),
    },
    Kept: {
      cookieName: (secure) => core.keepName(secure),
    },
    Build: {
      read: (bytes) => core.readBuild(bytes),
      checkId: (text) => {
        core.checkBuildId(text);
      },
      id: (outputs) => core.buildId(outputs),
      fileText: (id) => core.buildFileText(id),
    },
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
    },
  };
}
