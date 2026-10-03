// Answers requests with documents, JSON, action redirects and the static shell (HY-8, HY-10 to HY-19, HY-24 to HY-27,
// HY-40 to HY-46, HY-50 to HY-54, HY-58 to HY-60, HY-62).
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { Server } from 'node:http';
import { checkManifest, createApplication, keptPaths, routeReads, routeTemplates, stripBasePath, type Application, type Manifest, type RouteDeclaration, type RouteReads, type TemplateIndex } from '@polyspec/hyper';
import { resolvePath, type Template } from '@polyspec/template/render';
import { maskedToken, verifyToken } from './csrf.js';
import type { FileSessions } from './file-sessions.js';
import { createServer, type ServerOptions } from './http.js';
import { decodeJson, inDataModel, JsonDecodeError } from './json.js';
import { Disconnected, renderPage, stopClosed, type PageInput } from './page.js';
import { Reply } from './reply.js';
import type { Request } from './request.js';
import { Response } from './response.js';
import { BadRequest, Forbidden, NotFound, Redirect, Result } from './result.js';
import { Services } from './services.js';
import { Session, type SessionStore } from './session.js';
import type { Data } from './values.js';

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
  // The absolute path of the static shell, which declares the data base path with <meta name="hyper-api"> (HY-22).
  shell: string;
  // The data base path, such as /_props (HY-8).
  basePath: string;
  // Returns true for a request of a client-rendered page, for example by its Host header, or a promise of the
  // result, which the server awaits.
  selects: (request: Request) => boolean | Promise<boolean>;
}

// A checked client rendering with the bytes of its shell.
interface Client {
  basePath: string;
  shell: string;
  selects: (request: Request) => boolean | Promise<boolean>;
}

export interface AppOptions<S extends object> {
  // The absolute path of the manifest (HY-1).
  manifest: string;
  // The template index that the asset build writes, and the absolute directory that its file URLs are relative to
  // (HY-34). The server renders with these template files, as the browser does.
  templates: { index: string; root: string };
  handlers: Handlers<S>;
  timezone: string;
  basePath?: string;
  // Declares that the application is served over HTTPS, for example behind a TLS-terminating proxy (HY-45).
  https?: boolean;
  frameAncestors?: string;
  // The largest request body in bytes; a larger body receives 413. The default is 8 MiB, PHP's post_max_size (HY-59).
  bodyLimit?: number;
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
}

export class App<S extends object = Record<string, never>> {
  readonly services = new Services<S>();
  private readonly routes: Map<string, RouteDeclaration>;
  private readonly application: Application;
  private readonly handlers: Handlers<S>;
  readonly timezone: string;
  readonly basePath: string;
  readonly https: boolean;
  readonly frameAncestors: string;
  readonly bodyLimit: number;
  private readonly responseLimit: number;
  private readonly formTypes: readonly string[];
  private readonly onResponse: AppOptions<S>['onResponse'];
  private readonly onDisconnect: AppOptions<S>['onDisconnect'];
  private readonly log: (message: string) => void;
  private readonly reads: Record<string, RouteReads>;
  private readonly client: Client | null;

  private constructor(
    application: Application,
    handlers: Handlers<S>,
    timezone: string,
    basePath: string,
    https: boolean,
    frameAncestors: string,
    bodyLimit: number,
    responseLimit: number,
    formTypes: readonly string[],
    onResponse: AppOptions<S>['onResponse'],
    onDisconnect: AppOptions<S>['onDisconnect'],
    log: (message: string) => void,
    client: Client | null,
    reads: Record<string, RouteReads>,
  ) {
    this.client = client;
    this.reads = reads;
    this.application = application;
    this.handlers = handlers;
    this.timezone = timezone;
    this.basePath = basePath;
    this.https = https;
    this.frameAncestors = frameAncestors;
    this.bodyLimit = bodyLimit;
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
    const responseLimit = options.responseLimit ?? 8 * 1024 * 1024;
    if (!Number.isSafeInteger(responseLimit) || responseLimit < 1) throw new Error(`hyper: response limit ${responseLimit} is not a positive number of bytes`);
    const formTypes = options.formTypes ?? ['application/x-www-form-urlencoded'];
    if (formTypes.length === 0 || new Set(formTypes).size !== formTypes.length || formTypes.some((type) => !FORM_TYPES.includes(type))) {
      throw new Error('hyper: form types must be distinct values of application/x-www-form-urlencoded and multipart/form-data');
    }
    for (const path of [options.manifest, options.templates.index, options.templates.root]) {
      if (!isAbsolute(path)) throw new Error(`hyper: ${path} is not an absolute path`);
    }
    const manifest = checkManifest(JSON.parse(readFileSync(options.manifest, 'utf8')) as Manifest);
    const index = JSON.parse(readFileSync(options.templates.index, 'utf8')) as TemplateIndex;
    const fetcher = async (url: string): Promise<Template> => JSON.parse(readFileSync(join(options.templates.root, url), 'utf8')) as Template;
    const application = createApplication(manifest, index, fetcher);
    checkHandlers(manifest, options.handlers);
    const client = options.clientRendering === undefined ? null : checkClient(options.clientRendering, manifest);
    for (const route of manifest.routes) await application.templates.ensure(routeTemplates(manifest, route));
    // HY-73: the read paths of every route, from the templates that the asset build wrote.
    const parsed = new Map<string, Template>();
    for (const [name, entry] of Object.entries(index)) parsed.set(name, await fetcher(entry.url));
    const reads = routeReads(manifest, (name) => parsed.get(name)!, resolvePath);
    return new App(application, options.handlers, options.timezone, basePath, options.https ?? false, options.frameAncestors ?? "'self'", bodyLimit, responseLimit, [...formTypes], options.onResponse, options.onDisconnect, options.log ?? ((message) => process.stderr.write(`${message}\n`)), client, reads);
  }

  // Registers the factory of an application service.
  bind<K extends keyof S>(key: K, factory: () => S[K]): void {
    this.services.bind(key, factory);
  }

  // Returns an HTTP server that answers every request with this application and sessions in files.
  server(sessions: FileSessions, options: ServerOptions = {}): Server {
    return createServer(this, sessions, options);
  }

  // Answers one request; an unhandled error and a body larger than the response limit give a plain 500 and are
  // logged (HY-43, HY-66). Every response limits framing (HY-45), every failure is not cacheable (HY-65), and every
  // response is reported with the milliseconds since `started`, a performance.now() value that defaults to now
  // (HY-60). With the signal of a connection, a request whose client closed the connection stops, is reported to
  // onDisconnect and gives null, the response that is not written (HY-67).
  async handle(request: Request, store: SessionStore, started?: number): Promise<Response>;
  async handle(request: Request, store: SessionStore, started: number, signal: AbortSignal): Promise<Response | null>;
  async handle(request: Request, store: SessionStore, started = performance.now(), signal?: AbortSignal): Promise<Response | null> {
    const reply = new Reply();
    let response: Response;
    // The failure of a 500 of HY-43 or HY-66, which the hook receives (HY-60).
    let failure: string | null = null;
    try {
      response = await this.answer(request, store, reply, signal);
    } catch (error) {
      if (error instanceof Disconnected) {
        this.onDisconnect?.(request, performance.now() - started, reply);
        return null;
      }
      failure = this.fail(error);
      response = Response.text(500, 'Internal Server Error');
    }
    const size = Buffer.byteLength(response.body);
    if (size > this.responseLimit) {
      failure = `the response to ${request.method} ${request.path()} has ${size} bytes, more than the response limit of ${this.responseLimit} bytes`;
      this.log(`hyper: ${failure}`);
      response = Response.text(500, 'Internal Server Error');
    }
    return this.report(request, this.frame(response), started, reply, failure);
  }

  // Calls onResponse with a response, the milliseconds since `started`, the reply of the request and the failure of a
  // 500 of HY-43 or HY-66, and returns the response (HY-60).
  report(request: Request | null, response: Response, started: number, reply: Reply, failure: string | null = null): Response {
    this.onResponse?.(request, response, performance.now() - started, reply, failure);
    return response;
  }

  // Adds the frame-ancestors policy of the application to a response (HY-45), and to a failure the header that no
  // cache stores it (HY-65).
  frame(response: Response): Response {
    const framed = response.withHeader('Content-Security-Policy', `frame-ancestors ${this.frameAncestors}`);
    return framed.status >= 400 ? framed.withHeader('Cache-Control', 'no-store') : framed;
  }

  // Writes the log line of an unhandled error (HY-43) and returns its failure for the response hook (HY-60): the
  // message of an Error, or the text of another thrown value.
  fail(error: unknown): string {
    this.log(`hyper: ${error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error)}`);
    return error instanceof Error ? error.message : String(error);
  }

  // Answers a request; the loaders and actions of a routed request receive `reply` (HY-52, HY-60).
  private async answer(request: Request, store: SessionStore, reply: Reply, signal: AbortSignal | undefined): Promise<Response> {
    if (request.bodySize() > this.bodyLimit) return Response.text(413, 'Content Too Large');
    if (!request.validInput()) return Response.text(400, 'Bad Request');
    const client = await this.chosen(request);
    stopClosed(signal);
    const basePath = client?.basePath ?? this.basePath;
    const path = stripBasePath(request.path(), basePath);
    if (client !== null && path === null) return this.shell(request, client);
    if (path === '/_hyper/keep') return this.keep(request, new Session(store));
    const match = path === null ? null : this.application.router.match(path);
    if (match === null || path === null) return Response.text(404, 'Not Found');
    const route = this.routes.get(match.name)!;
    const handler = this.handlers.routes?.[route.name] ?? {};
    if (client !== null) {
      // HY-62: the data base path answers only JSON requests and actions, before the session is read.
      if (request.method !== 'GET' && (request.method !== 'POST' || handler.post === undefined)) return Response.text(405, 'Method Not Allowed');
      if (!request.wantsJson()) return Response.text(406, 'Not Acceptable');
    }
    const session = new Session(store);
    const flash = session.takeFlash();
    const routed = request.withRoute(path, match.params).withSession(flash, maskedToken(session.csrfToken()));
    const response = await this.routed({ request: routed, route, handler, session, flash, reply, status: 200, invalid: {}, basePath, signal });
    return response.withCookies(reply, this.https || request.https);
  }

  // Returns the client rendering when its selection chooses the request, and null otherwise (HY-62).
  private async chosen(request: Request): Promise<Client | null> {
    if (this.client === null) return null;
    const chosen: unknown = await this.client.selects(request);
    if (typeof chosen !== 'boolean') throw new Error('hyper: the selection of the client rendering did not return a boolean');
    return chosen ? this.client : null;
  }

  // Answers a client-rendered request outside the data base path: the static shell for a page (HY-62).
  private shell(request: Request, client: Client): Response {
    if (this.application.router.match(request.path()) === null) return Response.text(404, 'Not Found');
    if (request.method !== 'GET') return Response.text(405, 'Method Not Allowed');
    if (request.wantsJson()) return Response.text(406, 'Not Acceptable');
    return new Response(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', Vary: 'Accept' }, client.shell);
  }

  // Answers a routed request with its page, action result or stop result.
  private async routed(input: PageInput<S>): Promise<Response> {
    const { request, handler, session, reply } = input;
    try {
      if (request.method === 'GET') return withoutRenewal(reply, await this.page(input));
      if (request.method !== 'POST' || handler.post === undefined) return Response.text(405, 'Method Not Allowed');
      if (!this.formTypes.includes(request.mediaType())) return Response.text(415, 'Unsupported Media Type');
      if (!verifyToken(session.csrfToken(), request.formString('_csrf'))) return Response.text(403, 'Forbidden');
      const result = await handler.post({ request, reply, services: this.services });
      stopClosed(input.signal);
      if (!(result instanceof Result)) throw new Error(`hyper: POST action of route ${input.route.name} did not return a Result`);
      // HY-72: the action renews the session after it returns, and a page that it renders carries the new token.
      let page = input;
      if (reply.takeRenewal()) {
        session.renew();
        page = { ...input, request: request.withSession(input.flash, maskedToken(session.csrfToken())) };
      }
      if (result.isRedirect()) return this.redirect(session, result, input.basePath);
      return withoutRenewal(reply, await this.page({ ...page, status: result.status, invalid: result.data }));
    } catch (error) {
      if (error instanceof NotFound) return Response.text(404, 'Not Found');
      if (error instanceof Redirect) return this.redirect(session, error.result, input.basePath);
      if (error instanceof Forbidden) return Response.text(403, 'Forbidden');
      if (error instanceof BadRequest) return Response.text(400, 'Bad Request');
      throw error;
    }
  }

  private page(input: PageInput<S>): Promise<Response> {
    return renderPage(input, { application: this.application, handlers: this.handlers, services: this.services, timezone: this.timezone, https: this.https, reads: this.reads[input.route.name]! });
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
    if (!verifyToken(session.csrfToken(), request.formString('_csrf'))) return Response.text(403, 'Forbidden');
    const name = request.formString('region');
    const path = request.formString('path');
    if (!Object.hasOwn(keptPaths(this.application.manifest, name), path) || keptPaths(this.application.manifest, name)[path] !== 'server') {
      return Response.text(400, 'Bad Request');
    }
    const text = request.formString('value');
    if (Buffer.byteLength(text) > 4096) return Response.text(400, 'Bad Request');
    let value;
    try {
      value = decodeJson(text);
    } catch (error) {
      if (error instanceof JsonDecodeError) return Response.text(400, 'Bad Request');
      throw error;
    }
    if (!inDataModel(value)) return Response.text(400, 'Bad Request');
    session.keep(name, path, value);
    return new Response(204, {}, '');
  }
}

const FORM_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data'];

// Reads the static shell after checking the declaration of the client rendering against the manifest (HY-62).
function checkClient(client: ClientRendering, manifest: Manifest): Client {
  const base = client.basePath;
  if (base === '' || !base.startsWith('/') || base.endsWith('/')) throw new Error(`hyper: data base path ${base} must start with / and must not end with /`);
  for (const route of manifest.routes) {
    if (route.path === base || route.path.startsWith(`${base}/`)) throw new Error(`hyper: route ${route.name} lies under the data base path ${base}`);
  }
  if (!isAbsolute(client.shell)) throw new Error(`hyper: static shell ${client.shell} is not an absolute path`);
  const shell = readFileSync(client.shell, 'utf8');
  if (!shell.includes(`<meta name="hyper-api" content="${escapeAttribute(base)}">`)) throw new Error(`hyper: static shell ${client.shell} does not declare the data base path ${base}`);
  return { basePath: base, shell, selects: client.selects };
}

// Escapes a value as PHP htmlspecialchars with ENT_QUOTES does.
function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#039;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Fails when a loader or the shared handler renewed the session, because the page carries the old token (HY-72).
function withoutRenewal(reply: Reply, response: Response): Response {
  if (reply.takeRenewal()) throw new Error('hyper: a loader or the shared handler called renewSession; only an action renews the session');
  return response;
}

// Checks that the handlers match the manifest (HY-2, HY-30).
function checkHandlers<S extends object>(manifest: Manifest, handlers: Handlers<S>): void {
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
  }
}
