// Answers requests with documents, JSON, action redirects and the static shell (HY-8, HY-10 to HY-19, HY-24 to HY-27,
// HY-40, HY-42 to HY-46, HY-50 to HY-54, HY-58 to HY-60, HY-62).
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { Server } from 'node:http';
import { checkManifest, checkTemplateIndex, createApplication, DATA_TEMPLATE_NAME, keptPaths, routeReads, routeTemplates, stripBasePath, type Application, type Manifest, type RouteDeclaration, type RouteReads } from '@polyspec/hyper-client';
import { decodeTemplate, resolvePath, type HostFunction, type Template } from '@polyspec/template/render';
import { Csrf } from './csrf.js';
import type { FileSessions } from './file-sessions.js';
import type { RedisSessions } from './redis-sessions.js';
import { createListener, createServer, type Listener, type ServerOptions } from './http.js';
import { readBuildId } from './build.js';
import { JsonCodec } from './json-codec.js';
import { JsonDecodeError } from './json-decode-error.js';
import { warningsAsErrors } from './warnings.js';
import { Disconnected, renderPage, stopClosed, VARY, type PageInput } from './page.js';
import { HYPER_CONTEXT, type ContextHandler } from './context.js';
import { checkClient, checkHandlers, type Client } from './open-checks.js';
import { Reply } from './reply.js';
import { negotiate, PAGE_AND_DATA, PAGE_TYPE } from './negotiate.js';
import { HYPER_JSON, type Request } from './request.js';
import { Response } from './response.js';
import { BadRequest, Forbidden, NotFound, Redirect, Result } from './result.js';
import { Services } from './services.js';
import { Session, type SessionStore } from './session.js';
import type { Data } from './values.js';

// Reads a JSON file of an application as strict UTF-8 JSON. A file that cannot be read fails with its system error;
// a file that is not valid UTF-8 or not valid JSON raises an Error that names it (HY-106).
function readJsonFile(path: string): unknown {
  const bytes = readFileSync(path);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`hyper: ${path} is not valid UTF-8`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`hyper: ${path} is not valid JSON`);
  }
}

// The one argument of every loader and action: the request, the reply of the request and the services that the
// application binds by key.
export interface Context<S extends object> {
  request: Request;
  reply: Reply;
  services: Services<S>;
}

export type Loader<S extends object> = (context: Context<S>) => Data | Promise<Data>;
export type Action<S extends object> = (context: Context<S>) => Result | Promise<Result>;
// The loader of a route region, which returns null when the region is absent from the response (HY-75).
export type RouteRegionLoader<S extends object> = (context: Context<S>) => Data | null | Promise<Data | null>;

export interface RouteHandlers<S extends object> {
  load?: Loader<S>;
  post?: Action<S>;
  regions?: Record<string, RouteRegionLoader<S>>;
}

export interface Handlers<S extends object> {
  shared?: Loader<S>;
  regions?: Record<string, Loader<S>>;
  routes?: Record<string, RouteHandlers<S>>;
}

// The client-rendered pages of an application (HY-62): their HTML requests receive the static shell, and their JSON
// requests and actions use the data base path.
export interface ClientRendering {
  // The absolute path of the static shell, which declares the data base path with <meta name="hyper-api"> (HYC-8).
  shell: string;
  // The data base path, such as /_props (HY-8).
  basePath: string;
  // Returns the choice of a request, for example by its Host header, or a promise of it, which the server awaits.
  selects: (request: Request) => Choice | Promise<Choice>;
}

// The result of the selection of a client rendering (HY-62): whether the request is of a client-rendered page, and a
// value that every loader and action of the request reads with request.selection(); the value is not undefined.
export interface Choice {
  chosen: boolean;
  value: unknown;
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

// The outcome of a request for its transport: the response, or a stop because its connection closed (HY-67).
export type Answer = { stopped: false; response: Response; reply: Reply } | { stopped: true; reply: Reply };

export class App<S extends object = Record<string, never>> {
  /** @internal */
  readonly services = new Services<S>();
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
  private readonly fileLimit: number;
  private readonly responseLimit: number;
  private readonly formTypes: readonly string[];
  private readonly onResponse: AppOptions<S>['onResponse'];
  private readonly onDisconnect: AppOptions<S>['onDisconnect'];
  private readonly log: (message: string) => void;
  private readonly reads: Record<string, RouteReads>;
  private readonly client: Client | null;
  private readonly build: string;
  private readonly context: ContextHandler | null;
  // The Vary of the html and JSON responses, with `Hyper-Context` for an application with a context (HY-117).
  private readonly vary: string;

  private constructor(
    application: Application,
    handlers: Handlers<S>,
    timezone: string,
    basePath: string,
    https: boolean,
    frameAncestors: string,
    bodyLimit: number,
    fileLimit: number,
    responseLimit: number,
    formTypes: readonly string[],
    onResponse: AppOptions<S>['onResponse'],
    onDisconnect: AppOptions<S>['onDisconnect'],
    log: (message: string) => void,
    client: Client | null,
    reads: Record<string, RouteReads>,
    build: string,
    context: ContextHandler | null,
  ) {
    this.context = context;
    this.vary = context === null ? VARY : `${VARY}, Hyper-Context`;
    this.build = build;
    this.client = client;
    this.reads = reads;
    this.application = application;
    this.handlers = handlers;
    this.timezone = timezone;
    this.basePath = basePath;
    this.https = https;
    this.frameAncestors = frameAncestors;
    this.bodyLimit = bodyLimit;
    this.fileLimit = fileLimit;
    this.responseLimit = responseLimit;
    this.formTypes = formTypes;
    this.onResponse = onResponse;
    this.onDisconnect = onDisconnect;
    this.log = log;
    this.routes = new Map(application.manifest.routes.map((route) => [route.name, route]));
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
    const build = readBuildId(options.build);
    if (options.context !== undefined && typeof options.context !== 'function') throw new Error('hyper: the context must be a function (HY-106)');
    const manifest = checkManifest(readJsonFile(options.manifest));
    const index = checkTemplateIndex(readJsonFile(options.templates.index), `the template index ${options.templates.index}`);
    const fetcher = async (url: string): Promise<Template> => decodeTemplate(readJsonFile(join(options.templates.root, url)));
    const application = createApplication(manifest, index, fetcher, options.functions);
    checkHandlers(manifest, options.handlers);
    const client = options.clientRendering === undefined ? null : checkClient(options.clientRendering, manifest);
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
    return new App(application, options.handlers, options.timezone, basePath, options.https ?? false, options.frameAncestors ?? "'self'", bodyLimit, fileLimit, responseLimit, [...formTypes], options.onResponse, options.onDisconnect, options.log ?? ((message) => process.stderr.write(`${message}\n`)), client, reads, build, options.context ?? null);
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
    const answer = await this.respond(request, store, started, undefined);
    if (answer.stopped) throw new Error('hyper: a request stopped without the signal of a closed connection');
    return answer.response;
  }

  // Answers one request for the transport of a server, which gives the signal of the connection (HY-67). A request
  // whose client closed the connection stops and gives no response; the transport then calls `disconnected` after its
  // write hook (HY-99). The loaders and actions of a routed request receive the reply of the answer (HY-52, HY-60).
  /** @internal */
  async respond(request: Request, store: SessionStore, started: number, signal: AbortSignal | undefined): Promise<Answer> {
    const reply = new Reply();
    let response: Response;
    // The failure of a 500 of HY-43 or HY-66, which the hook receives (HY-60).
    let failure: string | null = null;
    try {
      // HY-74: a warning of the runtime fails the request instead of leaving a wrong page with status 200.
      response = await warningsAsErrors(() => this.answer(request, store, reply, signal));
    } catch (error) {
      if (error instanceof Disconnected) return { stopped: true, reply };
      failure = this.fail(error);
      response = Response.text(500, 'Internal Server Error');
    }
    const size = Buffer.byteLength(response.body);
    if (size > this.responseLimit) {
      failure = `the response to ${request.method} ${request.path()} has ${size} bytes, more than the response limit of ${this.responseLimit} bytes`;
      this.log(`hyper: ${failure}`);
      response = Response.text(500, 'Internal Server Error');
    }
    return { stopped: false, response: this.report(request, this.frame(response), started, reply, failure), reply };
  }

  // Calls onDisconnect with the request, the elapsed milliseconds since `started` and the reply of a stopped request (HY-67).
  /** @internal */
  disconnected(request: Request, started: number, reply: Reply): void {
    this.onDisconnect?.(request, performance.now() - started, reply);
  }

  // Calls onResponse with a response, the milliseconds since `started`, the reply of the request and the failure of a
  // 500 of HY-43 or HY-66, and returns the response (HY-60).
  /** @internal */
  report(request: Request | null, response: Response, started: number, reply: Reply, failure: string | null = null): Response {
    this.onResponse?.(request, response, performance.now() - started, reply, failure);
    return response;
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
  fail(error: unknown): string {
    this.log(`hyper: ${error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error)}`);
    return error instanceof Error ? error.message : String(error);
  }

  // Answers a request; the loaders and actions of a routed request receive `reply` (HY-52, HY-60).
  private async answer(received: Request, store: SessionStore, reply: Reply, signal: AbortSignal | undefined): Promise<Response> {
    if (received.bodySize() > this.bodyLimit) return Response.text(413, 'Content Too Large');
    if (!received.validInput()) return Response.text(400, 'Bad Request');
    const choice = await this.choice(received);
    stopClosed(signal);
    const client = choice?.chosen === true ? this.client : null;
    const request = received.withSelection(choice === null ? null : choice.value);
    const basePath = client?.basePath ?? this.basePath;
    const path = stripBasePath(request.path(), basePath);
    if (client !== null && path === null) return this.shell(request, client);
    if (path === '/_hyper/keep') return this.keep(request, new Session(store));
    const match = path === null ? null : this.application.router.match(path);
    if (match === null || path === null) return Response.text(404, 'Not Found');
    const route = this.routes.get(match.name);
    if (route === undefined) throw new Error(`hyper: route ${match.name} is not declared`);
    const handler = this.handlers.routes?.[route.name] ?? {};
    // HY-116: the media type is selected after the routing; the data base path of HY-62 step 2 serves only the JSON of hyper.
    const selected = negotiate(request, client === null ? PAGE_AND_DATA : [HYPER_JSON]);
    if (selected instanceof Response) return selected;
    // HY-116, HY-27: a method other than GET or a declared POST is refused before the session is read (HY-120).
    if (selected.method !== 'GET' && (selected.method !== 'POST' || handler.post === undefined)) return Response.text(405, 'Method Not Allowed');
    // HY-127: a Hyper-Context value that is not 64 lowercase hexadecimal characters is refused before any handler runs.
    const hash = selected.header('Hyper-Context');
    if (this.context !== null && hash !== null && !HYPER_CONTEXT.test(hash)) return Response.text(400, 'Bad Request');
    const session = new Session(store);
    const flash = session.takeFlash();
    const routed = selected.withRoute(path, match.params).withSession(flash, Csrf.masked(session.csrfToken()));
    const response = await this.routed({ request: routed, route, handler, session, flash, reply, status: 200, invalid: {}, basePath, signal });
    return response.withCookies(reply, this.https || request.https);
  }

  // Returns the choice of the client rendering selection for the request, or null without client rendering (HY-62).
  private async choice(request: Request): Promise<Choice | null> {
    if (this.client === null) return null;
    const choice: unknown = await this.client.selects(request);
    if (typeof choice !== 'object' || choice === null || !('chosen' in choice) || typeof choice.chosen !== 'boolean' || !('value' in choice) || choice.value === undefined) {
      throw new Error('hyper: the selection of the client rendering did not return a choice');
    }
    return { chosen: choice.chosen, value: choice.value };
  }

  // Answers a client-rendered request outside the data base path: the static shell for a page (HY-62). The path is
  // routed and the method checked before the media type is selected (HY-62 step 3).
  private shell(request: Request, client: Client): Response {
    if (this.application.router.match(request.path()) === null) return Response.text(404, 'Not Found');
    if (request.method !== 'GET') return Response.text(405, 'Method Not Allowed');
    const selected = negotiate(request, [PAGE_TYPE]);
    if (selected instanceof Response) return selected;
    return new Response(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', Vary: this.vary }, client.shell);
  }

  // Answers a routed request with its page, action result or stop result.
  private async routed(input: PageInput<S>): Promise<Response> {
    const { request, handler, session, reply } = input;
    try {
      if (request.method === 'GET') return withoutRenewal(reply, await this.page(input));
      if (request.method !== 'POST' || handler.post === undefined) return Response.text(405, 'Method Not Allowed');
      if (!this.formTypes.includes(request.mediaType())) return Response.text(415, 'Unsupported Media Type');
      if (!Csrf.verify(session.csrfToken(), request.formString('_csrf'))) return Response.text(403, 'Forbidden');
      // HY-114: a file over the file limit is refused before the action runs, as HY-59 refuses a large body.
      if (request.fileOver(this.fileLimit)) return Response.text(413, 'Content Too Large');
      const result = await handler.post({ request, reply, services: this.services });
      stopClosed(input.signal);
      if (!(result instanceof Result)) throw new Error(`hyper: POST action of route ${input.route.name} did not return a Result`);
      // HY-72: the action renews the session after it returns, and a page that it renders carries the new token.
      let page = input;
      if (reply.takeRenewal()) {
        session.renew();
        page = { ...input, request: request.withSession(input.flash, Csrf.masked(session.csrfToken())) };
      }
      if (result.isRedirect()) return this.redirect(session, result, input.basePath);
      return withoutRenewal(reply, await this.page({ ...page, status: result.status, invalid: result.data }));
    } catch (error) {
      if (error instanceof NotFound) return Response.text(404, 'Not Found');
      if (error instanceof Redirect) return this.redirect(session, error.result, input.basePath);
      if (error instanceof Forbidden) return Response.text(403, 'Forbidden');
      if (error instanceof BadRequest) return Response.text(400, 'Bad Request');
      // HY-107: an error of the ORM is answered as the stop of its meaning; every other error escapes (HY-43).
      const code = ormCode(error);
      if (code === 'NO_ROWS') return Response.text(404, 'Not Found');
      if (code === 'REVISION_CHANGED' && request.method === 'POST') return withoutRenewal(reply, await this.page({ ...input, status: 409, invalid: {} }));
      throw error;
    }
  }

  // The read paths of a route, which create computes for every route of the manifest (HY-73).
  private readsOf(route: string): RouteReads {
    const reads = this.reads[route];
    if (reads === undefined) throw new Error(`hyper: route ${route} has no read paths`);
    return reads;
  }

  private page(input: PageInput<S>): Promise<Response> {
    return renderPage(input, { application: this.application, handlers: this.handlers, services: this.services, timezone: this.timezone, https: this.https, reads: this.readsOf(input.route.name), build: this.build, context: this.context, vary: this.vary });
  }

  // Stores the flash values and changed topics of a redirect result and answers 303 (HY-25, HY-50).
  private redirect(session: Session, result: Result, basePath: string): Response {
    session.putFlash({ values: new Map(result.flashValues), changed: [...result.changedTopics] });
    return new Response(303, { Location: basePath + result.location }, '');
  }

  // Stores a kept value of a `server` path in the session (HY-40).
  private keep(request: Request, session: Session): Response {
    if (request.method !== 'POST') return Response.text(405, 'Method Not Allowed');
    if (!this.formTypes.includes(request.mediaType())) return Response.text(415, 'Unsupported Media Type');
    if (!Csrf.verify(session.csrfToken(), request.formString('_csrf'))) return Response.text(403, 'Forbidden');
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

const FORM_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data'];

// The code of an error of the ORM, which hyper knows by the name of its class and by its property `code`, because it does not
// depend on the ORM (HY-107), or undefined for every other error.
function ormCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || error.name !== 'OrmError' || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

// Fails when a loader or the shared handler renewed the session, because the page carries the old token (HY-72).
function withoutRenewal(reply: Reply, response: Response): Response {
  if (reply.takeRenewal()) throw new Error('hyper: a loader or the shared handler called renewSession; only an action renews the session');
  return response;
}
