// Answers requests with documents, JSON, action redirects and the static shell (HY-8, HY-10 to HY-19, HY-24 to HY-27,
// HY-40, HY-42 to HY-46, HY-50 to HY-54, HY-58 to HY-60, HY-62).
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { Server } from 'node:http';
import { checkManifest, checkTemplateIndex, createApplication, DATA_TEMPLATE_NAME, keptPaths, routeReads, routeTemplates, stripBasePath, type Application, type Manifest, type RouteDeclaration } from '@polyspec/hyper-client';
import { decodeTemplate, resolvePath, type HostFunction, type Template } from '@polyspec/template/render';
import type { Choice } from './choice.js';
import type { ClientRendering } from './client-rendering.js';
import { Disconnected } from './disconnected.js';
import { InvalidAccept } from './invalid-accept.js';
import { Csrf } from './csrf.js';
import type { FileSessions } from './file-sessions.js';
import type { RedisSessions } from './redis-sessions.js';
import { createListener, createServer, type Listener, type ServerOptions } from './http-host.js';
import { Build } from './build.js';
import { JsonCodec, type DecodedValue } from './json-codec.js';
import { JsonDecodeError } from './json-decode-error.js';
import { WarningsGuard } from './warnings-guard.js';
import { Page, type PageParts } from './page.js';
import { Context, type ContextHandler } from './context.js';
import { Reply } from './reply.js';
import { MediaSelection } from './media-selection.js';
import { MediaType } from './media-type.js';
import type { Representation } from './representation.js';
import { RepresentationEntries } from './representation-entries.js';
import type { RepresentationEntry } from './representation-entry.js';
import { RepresentationResponse } from './representation-response.js';
import { HYPER_JSON, type Request } from './request.js';
import { Response } from './response.js';
import { BadRequest } from './bad-request.js';
import { Forbidden } from './forbidden.js';
import { NotFound } from './not-found.js';
import { Redirect } from './redirect.js';
import { Result } from './result.js';
import { Container } from './container.js';
import { Flash } from './flash.js';
import { Session } from './session.js';
import type { SessionStore } from './session-store.js';
import type { Data, Value } from './values.js';

// The one argument of every loader and action: the request, the reply of the request and the services that the
// application binds by key.
export interface HandlerArgument<S extends object> {
  request: Request;
  reply: Reply;
  services: Container<S>;
}

export type Loader<S extends object> = (argument: HandlerArgument<S>) => Data | Promise<Data>;
export type Action<S extends object> = (argument: HandlerArgument<S>) => Result | Promise<Result>;
// The loader of a route region, which returns null when the region is absent from the response (HY-75).
export type RouteRegionLoader<S extends object> = (argument: HandlerArgument<S>) => Data | null | Promise<Data | null>;

// The one argument of a representation handler: the request without its Cookie, the media type of the selection and
// the services of the application (HY-106, HY-119).
export interface RepresentationArgument<S extends object> {
  request: Request;
  media: MediaType;
  services: Container<S>;
}

export type RepresentationHandler<S extends object> = (argument: RepresentationArgument<S>) => Representation | Promise<Representation>;

export interface RouteHandlers<S extends object> {
  load?: Loader<S>;
  post?: Action<S>;
  regions?: Record<string, RouteRegionLoader<S>>;
  // The representation handlers of the route, by the type as the manifest writes it (HY-118).
  representations?: Record<string, RepresentationHandler<S>>;
}

export interface Handlers<S extends object> {
  shared?: Loader<S>;
  regions?: Record<string, Loader<S>>;
  routes?: Record<string, RouteHandlers<S>>;
}

export interface AppOptions<S extends object> {
  // The absolute path of the manifest (HY-1).
  manifest: string;
  // The absolute path of the `build.json` of the asset output, which holds the build id (HY-125, HY-48).
  build: string;
  // The template index that the asset build writes, and the absolute directory that its file URLs are relative to
  // (HR-34). The server renders with these template files, as the browser does.
  templates: { index: string; root: string };
  handlers: Handlers<S>;
  timezone: string;
  basePath?: string;
  // Declares that the application is served over HTTPS, for example behind a TLS-terminating proxy (HY-45).
  https?: boolean;
  frameAncestors?: string;
  // The largest request body in bytes; a larger body receives 413. The default is 8 MiB, PHP's post_max_size (HY-59).
  bodyLimit?: number;
  // The largest file in bytes of a request body, a file part of it (HY-113): a larger file receives 413 before the
  // action or the kept value runs. The default is the smaller of 8 MiB and the body limit, so that the body limit refuses first.
  fileLimit?: number;
  // The largest bytes that the server holds as one value: a body that is not read in chunks, and the names and the
  // contents of the text values of a multipart body together; more receives 413. The default is the smaller of 8 MiB
  // and the body limit (HY-131).
  valueLimit?: number;
  // The largest number of parts of a multipart body; more receives 413. The default is 1000 (HY-131).
  partLimit?: number;
  // The media types of the request bodies that actions and /_hyper/keep accept: application/x-www-form-urlencoded
  // and multipart/form-data. The default is application/x-www-form-urlencoded (HY-59).
  formTypes?: string[];
  // The largest response body in bytes that the server sends; a larger body gives a plain 500. The default is
  // 8 MiB (HY-66).
  responseLimit?: number;
  // Called once for every response with the request, the response, the elapsed milliseconds, the reply of the
  // request and the failure of a 500 of HY-43 or HY-66, also for the responses that hyper answers itself (HY-60). The
  // request is null only for a request whose request line node:http could not read. The reply is the reply of the
  // loaders and actions of the request, or an empty reply when the server answered before routing. The failure is
  // the message of the error or the response limit line without its prefix, and null for every other response.
  onResponse?: (request: Request | null, response: Response, elapsed: number, reply: Reply, failure: string | null) => void;
  // Called once with the request, the elapsed milliseconds and the reply of a request whose client closed the
  // connection before the server wrote its response; the server stops the request and writes no response (HY-67).
  onDisconnect?: (request: Request, elapsed: number, reply: Reply) => void;
  // Receives the log line of an unhandled error (HY-43); the default writes it to the standard error.
  log?: (message: string) => void;
  // The client-rendered pages, which receive the static shell for HTML requests and JSON under the data base path
  // (HY-62).
  clientRendering?: ClientRendering;
  // The context handler (HY-124, HY-106): a function of the selection value that returns a Map, or a promise of one.
  context?: ContextHandler;
  // The host functions of the templates (HYC-24, HY-106): a map from names to functions that the template engine registers when
  // the application opens; a registration that fails fails the open (template FUN-44, RT-5).
  functions?: Record<string, HostFunction>;
}

// The parts of an application that `open` checked and read, the one argument of the constructor.
/** @internal */
export interface AppParts<S extends object> {
  application: Application;
  handlers: Handlers<S>;
  timezone: string;
  basePath: string;
  https: boolean;
  frameAncestors: string;
  bodyLimit: number;
  fileLimit: number;
  valueLimit: number;
  partLimit: number;
  responseLimit: number;
  formTypes: readonly string[];
  onResponse: AppOptions<S>['onResponse'];
  onDisconnect: AppOptions<S>['onDisconnect'];
  log: (message: string) => void;
  client: ClientRendering | null;
  shell: string;
  reads: PageParts<S>['reads'];
  build: string;
  context: ContextHandler | null;
  entries: Map<string, RepresentationEntry[]>;
}

/**
 * The outcome of a request for its transport: the response, or a stop because its connection closed (HY-67).
 *
 * @internal
 */
export type Answer = { stopped: false; response: Response; reply: Reply } | { stopped: true; reply: Reply };

// The media types of the request bodies that an application may accept (HY-59).
const FORM_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data'];
// The media types of the page and of the JSON of hyper, in the order of ties (HY-116).
const PAGE_TYPE = 'text/html';
const PAGE_AND_DATA = [PAGE_TYPE, HYPER_JSON];
// The Vary of a response with text/html or the JSON of hyper (HY-117).
const VARY = 'Accept, HX-Request, HX-Current-URL';

export class App<S extends object = Record<string, never>> {
  /** @internal */
  readonly services = new Container<S>();
  private readonly routes: Map<string, RouteDeclaration>;
  private readonly application: Application;
  private readonly handlers: Handlers<S>;
  /** @internal */
  readonly timezone: string;
  /** @internal */
  readonly basePath: string;
  /** @internal */
  readonly https: boolean;
  /** @internal */
  readonly frameAncestors: string;
  /** @internal */
  readonly bodyLimit: number;
  /** @internal */
  readonly fileLimit: number;
  /** @internal */
  readonly valueLimit: number;
  /** @internal */
  readonly partLimit: number;
  private readonly responseLimit: number;
  /** @internal */
  readonly formTypes: readonly string[];
  private readonly onResponse: AppOptions<S>['onResponse'];
  private readonly onDisconnect: AppOptions<S>['onDisconnect'];
  private readonly log: (message: string) => void;
  // The client rendering of the application, or null, and the text of its static shell, empty without it (HY-62).
  private readonly client: ClientRendering | null;
  private readonly shellText: string;
  private readonly context: ContextHandler | null;
  // The representations of each route, by the route name (HY-118).
  private readonly entries: Map<string, RepresentationEntry[]>;
  // The page of the application, which renders the page of every route.
  private readonly page: Page<S>;

  private constructor(parts: AppParts<S>) {
    const { application, handlers, timezone, basePath, https, frameAncestors, bodyLimit, fileLimit, valueLimit, partLimit, responseLimit, formTypes, onResponse, onDisconnect, log, client, shell, reads, build, context, entries } = parts;
    this.entries = entries;
    this.context = context;
    this.client = client;
    this.shellText = shell;
    this.application = application;
    this.handlers = handlers;
    this.timezone = timezone;
    this.basePath = basePath;
    this.https = https;
    this.frameAncestors = frameAncestors;
    this.bodyLimit = bodyLimit;
    this.fileLimit = fileLimit;
    this.valueLimit = valueLimit;
    this.partLimit = partLimit;
    this.responseLimit = responseLimit;
    this.formTypes = formTypes;
    this.onResponse = onResponse;
    this.onDisconnect = onDisconnect;
    this.log = log;
    this.routes = new Map(application.manifest.routes.map((route) => [route.name, route]));
    this.page = new Page({ application, handlers, services: this.services, timezone, https, reads, build, context, vary: this.varyHeader() });
  }

  // Creates an application from its manifest, the template files of the asset build and the handlers that load
  // data and run actions. It loads every template that a route needs, so a missing template fails here.
  static async open<S extends object = Record<string, never>>(options: AppOptions<S>): Promise<App<S>> {
    const basePath = options.basePath ?? '';
    if (basePath !== '' && (!basePath.startsWith('/') || basePath.endsWith('/'))) {
      throw new Error(`hyper: base path ${basePath} must start with / and must not end with /`);
    }
    const bodyLimit = options.bodyLimit ?? 8 * 1024 * 1024;
    if (!Number.isSafeInteger(bodyLimit) || bodyLimit < 1) throw new Error(`hyper: body limit ${bodyLimit} is not a positive number of bytes`);
    const fileLimit = options.fileLimit ?? Math.min(8 * 1024 * 1024, bodyLimit);
    if (!Number.isSafeInteger(fileLimit) || fileLimit < 1 || fileLimit > bodyLimit) {
      throw new Error(`hyper: file limit ${fileLimit} is not a positive number of bytes no larger than the body limit ${bodyLimit} (HY-114)`);
    }
    const valueLimit = options.valueLimit ?? Math.min(8 * 1024 * 1024, bodyLimit);
    if (!Number.isSafeInteger(valueLimit) || valueLimit < 1 || valueLimit > bodyLimit) {
      throw new Error(`hyper: value limit ${valueLimit} is not a positive number of bytes no larger than the body limit ${bodyLimit} (HY-131)`);
    }
    const partLimit = options.partLimit ?? 1000;
    if (!Number.isSafeInteger(partLimit) || partLimit < 1) throw new Error(`hyper: part limit ${partLimit} is not a positive number (HY-131)`);
    const responseLimit = options.responseLimit ?? 8 * 1024 * 1024;
    if (!Number.isSafeInteger(responseLimit) || responseLimit < 1) throw new Error(`hyper: response limit ${responseLimit} is not a positive number of bytes`);
    const formTypes = options.formTypes ?? ['application/x-www-form-urlencoded'];
    if (formTypes.length === 0 || new Set(formTypes).size !== formTypes.length || formTypes.some((type) => !FORM_TYPES.includes(type))) {
      throw new Error('hyper: form types must be distinct values of application/x-www-form-urlencoded and multipart/form-data');
    }
    for (const path of [options.manifest, options.templates.index, options.templates.root]) {
      if (!isAbsolute(path)) throw new Error(`hyper: ${path} is not an absolute path`);
    }
    if (typeof options.build !== 'string' || !isAbsolute(options.build)) throw new Error(`hyper: the build file ${String(options.build)} is not an absolute path`);
    const build = Build.read(options.build);
    if (options.context !== undefined && typeof options.context !== 'function') throw new Error('hyper: the context must be a function (HY-106)');
    const manifest = checkManifest(App.readJsonFile(options.manifest));
    // HY-118: the representations of each route, by the route name. The manifest is decoded with maps for objects,
    // because the parameters of an entry keep the order of the manifest, which a plain object does not keep for a name
    // that is an integer.
    let decoded: DecodedValue;
    try {
      decoded = JsonCodec.decode(App.readJsonText(options.manifest));
    } catch (error) {
      if (!(error instanceof JsonDecodeError)) throw error;
      throw new Error(`hyper: ${options.manifest} is not valid JSON`, { cause: error });
    }
    const entries = new Map<string, RepresentationEntry[]>();
    const routes = decoded instanceof Map ? decoded.get('routes') : undefined;
    for (const route of Array.isArray(routes) ? routes : []) {
      if (!(route instanceof Map)) continue;
      const name = route.get('name');
      if (typeof name === 'string') entries.set(name, RepresentationEntries.declare(name, route.get('representations')));
    }
    const index = checkTemplateIndex(App.readJsonFile(options.templates.index), `the template index ${options.templates.index}`);
    const fetcher = async (url: string): Promise<Template> => decodeTemplate(App.readJsonFile(join(options.templates.root, url)));
    const application = createApplication(manifest, index, fetcher, options.functions);
    App.checkHandlers({ ...manifest, entries }, options.handlers);
    const shell = options.clientRendering === undefined ? '' : App.checkedShell(options.clientRendering, manifest);
    // Every entry template of every route and the template of the embedded data are in the index (HY-31, HR-34), and the
    // server renders every page, so it reads every template of the index (HYC-12).
    for (const route of manifest.routes) {
      for (const name of [...routeTemplates(manifest, route), DATA_TEMPLATE_NAME]) {
        if (typeof index[name]?.url !== 'string') throw new Error(`hyper: template ${name} is not in the template index`);
      }
    }
    await application.templates.ensure(Object.keys(index));
    // HY-73: the read paths of every route, from the templates that the asset build wrote.
    const parsed = new Map<string, Template>();
    for (const [name, entry] of Object.entries(index)) parsed.set(name, await fetcher(entry.url));
    const reads = routeReads(manifest, (name) => {
      const template = parsed.get(name);
      if (template === undefined) throw new Error(`hyper: template ${name} is not in the template index`);
      return template;
    }, resolvePath);
    return new App({
      application,
      handlers: options.handlers,
      timezone: options.timezone,
      basePath,
      https: options.https ?? false,
      frameAncestors: options.frameAncestors ?? "'self'",
      bodyLimit,
      fileLimit,
      valueLimit,
      partLimit,
      responseLimit,
      formTypes: [...formTypes],
      onResponse: options.onResponse,
      onDisconnect: options.onDisconnect,
      log: options.log ?? ((message) => process.stderr.write(`${message}\n`)),
      client: options.clientRendering ?? null,
      shell,
      reads,
      build,
      context: options.context ?? null,
      entries,
    });
  }

  // Reads a JSON file of an application as strict UTF-8 JSON. A file that cannot be read fails with its system error;
  // a file that is not valid UTF-8 or not valid JSON raises an Error that names it (HY-106).
  private static readJsonFile(path: string): unknown {
    const text = App.readJsonText(path);
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`hyper: ${path} is not valid JSON`, { cause: error });
    }
  }

  // Reads the text of a JSON file of an application as strict UTF-8.
  private static readJsonText(path: string): string {
    try {
      // ignoreBOM keeps a leading U+FEFF, so that a file that starts with it is not valid JSON, as in PHP and Python.
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readFileSync(path));
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      throw new Error(`hyper: ${path} is not valid UTF-8`, { cause: error });
    }
  }

  // Returns the text of the static shell after checking the declaration of the client rendering against the manifest
  // (HY-62).
  private static checkedShell(client: ClientRendering, manifest: Manifest): string {
    const base = client.basePath;
    if (base === '' || !base.startsWith('/') || base.endsWith('/')) throw new Error(`hyper: data base path ${base} must start with / and must not end with /`);
    for (const route of manifest.routes) {
      if (route.path === base || route.path.startsWith(`${base}/`)) throw new Error(`hyper: route ${route.name} lies under the data base path ${base}`);
    }
    if (!isAbsolute(client.shell)) throw new Error(`hyper: static shell ${client.shell} is not an absolute path`);
    let bytes: Buffer;
    try {
      bytes = readFileSync(client.shell);
    } catch {
      throw new Error(`hyper: static shell ${client.shell} does not exist or cannot be read`);
    }
    let shell: string;
    try {
      shell = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new Error(`hyper: static shell ${client.shell} is not valid UTF-8`);
    }
    // The data base path is escaped as PHP htmlspecialchars with ENT_QUOTES does.
    const escaped = base.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#039;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (!shell.includes(`<meta name="hyper-api" content="${escaped}">`)) throw new Error(`hyper: static shell ${client.shell} does not declare the data base path ${base}`);
    return shell;
  }

  // Checks that the handlers match the manifest (HY-2, HY-30), and that the representation handlers of each route are
  // those of its entries (HY-118). `manifest` holds the representations of each route by the route name.
  private static checkHandlers<S extends object>(manifest: Manifest & { entries: ReadonlyMap<string, readonly RepresentationEntry[]> }, handlers: Handlers<S>): void {
    for (const name of Object.keys(handlers.regions ?? {})) {
      const region = manifest.regions.find((item) => item.name === name);
      if (region === undefined || region.page === true) throw new Error(`hyper: region loader ${name} has no non-page region in the manifest`);
    }
    for (const [name, handler] of Object.entries(handlers.routes ?? {})) {
      const route = manifest.routes.find((item) => item.name === name);
      if (route === undefined) throw new Error(`hyper: route handler ${name} has no route in the manifest`);
      if ((handler.post !== undefined) !== (route.post === true)) throw new Error(`hyper: route ${name} must have a POST action exactly when the manifest declares post`);
      const routeRegions = (route.regions ?? []).map((region) => region.name);
      for (const regionName of Object.keys(handler.regions ?? {})) {
        if (!routeRegions.includes(regionName)) throw new Error(`hyper: route ${name} has a loader for undeclared region ${regionName}`);
      }
    }
    for (const route of manifest.routes) {
      if (route.post === true && handlers.routes?.[route.name]?.post === undefined) throw new Error(`hyper: route ${route.name} declares post but has no POST action`);
      RepresentationEntries.checkHandlers(route.name, manifest.entries.get(route.name) ?? [], handlers.routes?.[route.name]?.representations ?? {});
    }
  }

  // Registers the factory of an application service.
  bind<K extends keyof S>(key: K, factory: () => S[K]): void {
    this.services.bind(key, factory);
  }

  // Returns an HTTP server that answers every request with this application and its sessions.
  server(sessions: FileSessions | RedisSessions, options: ServerOptions = {}): Server {
    return createServer(this, sessions, options);
  }

  // Returns the node:http request listener that `server` installs (HY-100).
  listener(sessions: FileSessions | RedisSessions, options: ServerOptions = {}): Listener {
    return createListener(this, sessions, options);
  }

  // Answers one request; an unhandled error and a body larger than the response limit give a plain 500 and are
  // logged (HY-43, HY-66). Every response limits framing (HY-45), every failure is not cacheable (HY-65), and every
  // response is reported with the milliseconds since `started`, a performance.now() value that defaults to now
  // (HY-60).
  async handle(request: Request, store: SessionStore, started = performance.now()): Promise<Response> {
    const answer = await this.respond(request, store, started);
    if (answer.stopped) throw new Error('hyper: a request stopped without the signal of a closed connection');
    return answer.response;
  }

  // Answers one request for the transport of a server, whose request holds the signal of the connection (HY-67). A request
  // whose client closed the connection stops and gives no response; the transport then calls `disconnected` after its
  // write hook (HY-99). The loaders and actions of a routed request receive the reply of the answer (HY-52, HY-60).
  /** @internal */
  async respond(request: Request, store: SessionStore, started: number): Promise<Answer> {
    const reply = new Reply();
    let response: Response;
    // The failure of a 500 of HY-43 or HY-66, which the hook receives (HY-60).
    let failure: string | null = null;
    try {
      // HY-74: a warning of the runtime fails the request instead of leaving a wrong page with status 200.
      response = await WarningsGuard.run(() => this.dispatch(request, store, reply));
    } catch (error) {
      if (error instanceof Disconnected) return { stopped: true, reply };
      failure = this.logFailure(error);
      response = Response.text(500, 'Internal Server Error');
    }
    const size = Buffer.byteLength(response.body);
    if (size > this.responseLimit) {
      failure = `the response to ${request.method} ${request.path()} has ${size} bytes, more than the response limit of ${this.responseLimit} bytes`;
      this.log(`hyper: ${failure}`);
      response = Response.text(500, 'Internal Server Error');
    }
    const framed = this.frame(response);
    this.report(request, framed, started, reply, failure);
    return { stopped: false, response: framed, reply };
  }

  // Calls onDisconnect with the request, the elapsed milliseconds since `started` and the reply of a stopped request (HY-67).
  /** @internal */
  disconnected(request: Request, started: number, reply: Reply): void {
    this.onDisconnect?.(request, performance.now() - started, reply);
  }

  // Calls onResponse with a response, the milliseconds since `started`, the reply of the request and the failure of a
  // 500 of HY-43 or HY-66 (HY-60).
  /** @internal */
  report(request: Request | null, response: Response, started: number, reply: Reply, failure: string | null = null): void {
    this.onResponse?.(request, response, performance.now() - started, reply, failure);
  }

  // Adds the frame-ancestors policy of the application to a response (HY-45), and to a failure the header that no
  // cache stores it (HY-65).
  /** @internal */
  frame(response: Response): Response {
    const framed = response.withHeader('Content-Security-Policy', `frame-ancestors ${this.frameAncestors}`);
    return framed.status >= 400 ? framed.withHeader('Cache-Control', 'no-store') : framed;
  }

  // Writes the log line of an unhandled error (HY-43) and returns its failure for the response hook (HY-60): the
  // message of an Error, or the text of another thrown value.
  /** @internal */
  logFailure(error: unknown): string {
    this.log(`hyper: ${error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error)}`);
    return error instanceof Error ? error.message : String(error);
  }

  // Answers a request; the loaders and actions of a routed request receive `reply` (HY-52, HY-60).
  private async dispatch(received: Request, store: SessionStore, reply: Reply): Promise<Response> {
    // HY-131.11: a body that passed the value limit, the part limit or the file limit is answered as a body over the
    // body limit.
    if (received.bodySize() > this.bodyLimit || received.exceeded(this.valueLimit, this.partLimit, this.fileLimit, this.formTypes.includes('multipart/form-data'))) {
      return Response.text(413, 'Content Too Large');
    }
    if (!received.validInput()) return Response.text(400, 'Bad Request');
    // HY-27.4: a HEAD request is answered as the GET request of its target.
    if (received.method === 'HEAD') return this.dispatch(received.asGet(), store, reply);
    const choice = await this.clientChoice(received);
    received.stopClosed();
    const client = choice?.chosen === true ? this.client : null;
    const request = received.withSelection(choice === null ? null : choice.value);
    const basePath = client?.basePath ?? this.basePath;
    const path = stripBasePath(request.path(), basePath);
    if (client !== null && path === null) return this.shellResponse(request);
    if (path === '/_hyper/keep') return this.storeKept(request, new Session(store));
    const match = path === null ? null : this.application.router.match(path);
    if (match === null || path === null) return Response.text(404, 'Not Found');
    const route = this.routes.get(match.name);
    if (route === undefined) throw new Error(`hyper: route ${match.name} is not declared`);
    const handler = this.handlers.routes?.[route.name] ?? {};
    // HY-116: the media type is selected after the routing; the data base path of HY-62 step 2 serves the JSON of hyper
    // and the representations of the route (HY-116.14).
    const entries = this.entries.get(route.name) ?? [];
    const chosen = App.negotiate(request, client === null ? PAGE_AND_DATA : [HYPER_JSON], entries);
    if (chosen instanceof Response) return chosen;
    // HY-120, HY-121: a representation request opens no session and runs only its handler.
    const [type, entry, values] = chosen;
    if (entry !== null) return this.answerRepresentation(request.withRoute(path, match.params), handler, entry, values, basePath);
    const selected = request.withMedia(type);
    // HY-116, HY-27: a method other than GET or a declared POST is refused before the session is read (HY-120).
    if (selected.method !== 'GET' && (selected.method !== 'POST' || handler.post === undefined)) return App.notAllowed(handler.post === undefined ? 'GET, HEAD' : 'GET, HEAD, POST');
    // HY-62.20: the data base path answers no page, which is refused after the method check (HY-116.12).
    if (client !== null && type === PAGE_TYPE) return App.notAcceptable();
    // HY-127: a Hyper-Context value that is not 64 lowercase hexadecimal characters is refused before any handler runs.
    const hash = selected.header('Hyper-Context');
    if (this.context !== null && !Context.validHeader(hash)) return Response.text(400, 'Bad Request');
    const session = new Session(store);
    const flash = session.takeFlash();
    const routed = selected.withRoute(path, match.params).withSession(flash, Csrf.masked(session.csrfToken()));
    const response = await this.routed(routed, route, handler, session, flash, reply, basePath);
    return response.withCookies(reply, this.https || request.https);
  }

  // Returns the choice of the client rendering selection for the request, or null without client rendering (HY-62).
  private async clientChoice(request: Request): Promise<Choice | null> {
    if (this.client === null) return null;
    const choice: unknown = await this.client.selects(request);
    if (typeof choice !== 'object' || choice === null || !('chosen' in choice) || typeof choice.chosen !== 'boolean' || !('value' in choice) || choice.value === undefined) {
      throw new Error('hyper: the selection of the client rendering did not return a choice');
    }
    return { chosen: choice.chosen, value: choice.value };
  }

  // Answers a client-rendered request outside the data base path: the static shell for a page (HY-62). The path is
  // routed and the method checked before the media type is selected (HY-62 step 3).
  private shellResponse(request: Request): Response {
    const match = this.application.router.match(request.path());
    if (match === null) return Response.text(404, 'Not Found');
    if (request.method !== 'GET') return App.notAllowed('GET, HEAD');
    // The representations of the route take part in the selection, so that a request that selects one of them is not
    // acceptable here, and they are not listed (HY-116.14).
    let selected: [string, RepresentationEntry | null, Map<string, string>] | null;
    try {
      selected = MediaSelection.select(request.header('Accept'), PAGE_AND_DATA, this.entries.get(match.name) ?? []);
    } catch (error) {
      if (!(error instanceof InvalidAccept)) throw error;
      return Response.text(400, 'Bad Request').withHeader('Vary', 'Accept');
    }
    if (selected === null) return Response.text(406, MediaSelection.listing([PAGE_TYPE], [])).withHeader('Vary', 'Accept');
    if (selected[1] !== null || selected[0] !== PAGE_TYPE) return App.notAcceptable();
    return new Response(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', Vary: this.varyHeader() }, this.shellText);
  }

  // Returns the Vary of the html and JSON responses, with `Hyper-Context` for an application with a context (HY-117).
  private varyHeader(): string {
    return this.context === null ? VARY : `${VARY}, Hyper-Context`;
  }

  // Selects the media type of a request among the page, the JSON of hyper and the representations of its route by its
  // Accept header (HY-116). A refusal is the response of HY-116: 400 for an invalid Accept, and 406 with the types that
  // the path serves, the page types of `served` and the entries, when no type matches. The caller refuses a selected
  // page type that the path does not serve after its method check (HY-116.12, HY-62.20).
  private static negotiate(request: Request, served: readonly string[], entries: readonly RepresentationEntry[]): [string, RepresentationEntry | null, Map<string, string>] | Response {
    let selected: [string, RepresentationEntry | null, Map<string, string>] | null;
    try {
      selected = MediaSelection.select(request.header('Accept'), PAGE_AND_DATA, entries);
    } catch (error) {
      if (!(error instanceof InvalidAccept)) throw error;
      return Response.text(400, 'Bad Request').withHeader('Vary', 'Accept');
    }
    return selected ?? Response.text(406, MediaSelection.listing(served, entries)).withHeader('Vary', 'Accept');
  }

  // Answers a representation request (HY-121, HY-122): the method check, the body checks, the handler of the entry, and
  // the response of what it returned with its tag.
  private async answerRepresentation(request: Request, handler: RouteHandlers<S>, entry: RepresentationEntry, values: ReadonlyMap<string, string>, basePath: string): Promise<Response> {
    const vary = ['Accept', ...entry.vary].join(', ');
    const method = request.method;
    if (!entry.methods.includes(method)) {
      // HY-121.6: an entry with GET also answers HEAD, which reaches here as GET (HY-27.4).
      const answered = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'].filter((name) => entry.methods.includes(name === 'HEAD' ? 'GET' : name));
      return App.notAllowed(answered.join(', ')).withHeader('Vary', vary);
    }
    let value: Value = null;
    if (method === 'GET' || method === 'DELETE') {
      if (request.bodySize() !== 0) return Response.text(400, 'Bad Request').withHeader('Vary', vary);
    } else {
      if (request.mediaType() !== 'application/json') return Response.text(415, 'Unsupported Media Type').withHeader('Vary', vary);
      let decoded: DecodedValue;
      try {
        decoded = JsonCodec.decode(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(request.bodyBytes()));
      } catch (error) {
        if (!(error instanceof JsonDecodeError) && !(error instanceof TypeError)) throw error;
        return Response.text(400, 'Bad Request').withHeader('Vary', vary);
      }
      // HY-121.8: a number outside the data model is no value that a handler reads.
      if (!JsonCodec.inDataModel(decoded)) return Response.text(400, 'Bad Request').withHeader('Vary', vary);
      value = decoded;
    }
    const contentType = MediaSelection.contentType(entry, values);
    const handle = handler.representations?.[entry.type];
    if (handle === undefined) throw new Error(`hyper: route has no representation handler for ${entry.type} (HY-118)`);
    let returned: unknown;
    try {
      returned = await handle({ request: request.asRepresentation(value), media: new MediaType(values, contentType), services: this.services });
    } catch (error) {
      // HY-107: an error of the ORM is known by its class name and code.
      const code = App.ormCode(error);
      if (code === 'NO_ROWS') return Response.text(404, 'Not Found').withHeader('Vary', vary);
      if (code === 'REVISION_CHANGED') return Response.text(412, 'Precondition Failed').withHeader('Vary', vary);
      throw error;
    }
    const response = RepresentationResponse.of(returned, contentType, vary, request.header('Authorization') !== null, basePath);
    if (response.status !== 200 || method !== 'GET') return response;
    // HY-122.10: a 200 of a GET, as which a HEAD is answered, has a strong tag, and a request that names it receives 304.
    const tag = RepresentationResponse.etag(contentType, response.body);
    const tagged = response.withHeader('ETag', tag);
    if (request.header('If-None-Match') !== tag) return tagged;
    const { 'Content-Type': _, ...notModified } = tagged.headers;
    return new Response(304, notModified, '');
  }

  // Returns the 405 of a method that a target does not take, with the methods that it takes (HY-27.6).
  private static notAllowed(allow: string): Response {
    return Response.text(405, 'Method Not Allowed').withHeader('Allow', allow);
  }

  // Returns the 406 of a selected type that the path does not serve (HY-116.12, HY-62.20).
  private static notAcceptable(): Response {
    return Response.text(406, 'Not Acceptable').withHeader('Vary', 'Accept');
  }

  // Answers a routed request with its page, action result or stop result. `basePath` is the base path of the request:
  // the data base path for a client-rendered request (HY-8, HY-62).
  private async routed(request: Request, route: RouteDeclaration, handler: RouteHandlers<S>, session: Session, flash: Flash, reply: Reply, basePath: string): Promise<Response> {
    // The request of the page, which holds the new token after the action renewed the session (HY-72).
    let rendered = request;
    try {
      if (request.method === 'GET') return App.withoutRenewal(reply, await this.page.respond(request, route, handler, session, flash, 200, {}, reply, basePath));
      if (request.method !== 'POST' || handler.post === undefined) return App.notAllowed(handler.post === undefined ? 'GET, HEAD' : 'GET, HEAD, POST');
      const refused = this.refusedForm(request, session);
      if (refused !== null) return refused;
      // HY-114: a file over the file limit is refused before the action runs, as HY-59 refuses a large body.
      if (request.fileOver(this.fileLimit)) return Response.text(413, 'Content Too Large');
      // HY-107.4: only a REVISION_CHANGED that the action raises is answered as the 409 page; `result` stays null for it.
      let result: Result | null = null;
      try {
        const returned = await handler.post({ request, reply, services: this.services });
        request.stopClosed();
        if (!(returned instanceof Result)) throw new Error(`hyper: POST action of route ${route.name} did not return a Result`);
        result = returned;
      } catch (error) {
        if (App.ormCode(error) !== 'REVISION_CHANGED') throw error;
      }
      // HY-72: the action renews the session after it ends, and a page that its request renders carries the new token.
      if (reply.takeRenewal()) {
        session.renew();
        rendered = request.withSession(flash, Csrf.masked(session.csrfToken()));
      }
      if (result !== null) {
        if (result.isRedirect()) return this.redirectResponse(session, result, basePath);
        return App.withoutRenewal(reply, await this.page.respond(rendered, route, handler, session, flash, result.status, result.data, reply, basePath));
      }
    } catch (error) {
      if (error instanceof NotFound) return Response.text(404, 'Not Found');
      if (error instanceof Redirect) return this.redirectResponse(session, error.result, basePath);
      if (error instanceof Forbidden) return Response.text(403, 'Forbidden');
      if (error instanceof BadRequest) return Response.text(400, 'Bad Request');
      // HY-107: an error of the ORM is answered as the stop of its meaning; every other error, also the REVISION_CHANGED
      // of a loader (HY-107.4), escapes (HY-43).
      if (App.ormCode(error) === 'NO_ROWS') return Response.text(404, 'Not Found');
      throw error;
    }
    // HY-107.4, HY-58: the 409 page of the action, whose loaders stop nothing; a loader that renews the session fails
    // it (HY-72.4).
    return App.withoutRenewal(reply, await this.page.respond(rendered, route, handler, session, flash, 409, {}, reply, basePath));
  }

  // The code of an error of the ORM, which hyper knows by the name of its class and by its property `code`, because it does not
  // depend on the ORM (HY-107), or undefined for every other error.
  private static ormCode(error: unknown): string | undefined {
    if (!(error instanceof Error) || error.name !== 'OrmError' || !('code' in error)) return undefined;
    return typeof error.code === 'string' ? error.code : undefined;
  }

  // Fails when a loader or the shared handler renewed the session, because the page carries the old token (HY-72).
  private static withoutRenewal(reply: Reply, response: Response): Response {
    if (reply.takeRenewal()) throw new Error('hyper: a loader or the shared handler called renewSession; only an action renews the session');
    return response;
  }

  // Stores the flash values and changed topics of a redirect result and answers 303 (HY-25, HY-50).
  private redirectResponse(session: Session, result: Result, basePath: string): Response {
    session.putFlash(new Flash(new Map(result.flashValues), [...result.changedTopics]));
    return new Response(303, { Location: basePath + result.location }, '');
  }

  // Returns the refusal of a form request: 415 for a media type that the application does not accept (HY-59) and 403
  // for a token that does not match the session, or null.
  private refusedForm(request: Request, session: Session): Response | null {
    if (!this.formTypes.includes(request.mediaType())) return Response.text(415, 'Unsupported Media Type');
    if (!Csrf.verify(session.csrfToken(), request.formString('_csrf'))) return Response.text(403, 'Forbidden');
    return null;
  }

  // Stores a kept value of a `server` path in the session (HY-40).
  private storeKept(request: Request, session: Session): Response {
    if (request.method !== 'POST') return App.notAllowed('POST');
    const refused = this.refusedForm(request, session);
    if (refused !== null) return refused;
    if (request.fileOver(this.fileLimit)) return Response.text(413, 'Content Too Large');
    const name = request.formString('region');
    const path = request.formString('path');
    if (!Object.hasOwn(keptPaths(this.application.manifest, name), path) || keptPaths(this.application.manifest, name)[path] !== 'server') {
      return Response.text(400, 'Bad Request');
    }
    const text = request.formString('value');
    if (Buffer.byteLength(text) > 4096) return Response.text(400, 'Bad Request');
    let value;
    try {
      value = JsonCodec.decode(text);
    } catch (error) {
      if (error instanceof JsonDecodeError) return Response.text(400, 'Bad Request');
      throw error;
    }
    if (!JsonCodec.inDataModel(value)) return Response.text(400, 'Bad Request');
    session.keep(name, path, value);
    return new Response(204, {}, '');
  }
}
