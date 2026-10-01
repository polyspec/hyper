// Answers requests with documents, JSON and action redirects (HY-8, HY-10 to HY-19, HY-24 to HY-27, HY-40 to
// HY-46, HY-50 to HY-54, HY-58, HY-59).
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { Server } from 'node:http';
import { checkManifest, createApplication, keptPaths, routeTemplates, stripBasePath, type Application, type Manifest, type RouteDeclaration, type TemplateIndex } from '@polyspec/hyper';
import type { Template } from '@polyspec/template/render';
import type { FileSessions } from './file-sessions.js';
import { createServer, type ServerOptions } from './http.js';
import { decodeJson, inDataModel, JsonDecodeError } from './json.js';
import { renderPage, type PageInput } from './page.js';
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

export interface RouteHandlers<S extends object> {
  load?: Loader<S>;
  post?: Action<S>;
  regions?: Record<string, Loader<S>>;
}

export interface Handlers<S extends object> {
  shared?: Loader<S>;
  regions?: Record<string, Loader<S>>;
  routes?: Record<string, RouteHandlers<S>>;
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
  // Receives the log line of an unhandled error (HY-43); the default writes it to the standard error.
  log?: (message: string) => void;
}

export class App<S extends object = Record<string, never>> {
  readonly services = new Services<S>();
  private readonly routes: Map<string, RouteDeclaration>;

  private constructor(
    private readonly application: Application,
    private readonly handlers: Handlers<S>,
    readonly timezone: string,
    readonly basePath: string,
    readonly https: boolean,
    readonly frameAncestors: string,
    readonly bodyLimit: number,
    private readonly formTypes: readonly string[],
    private readonly log: (message: string) => void,
  ) {
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
    for (const route of manifest.routes) await application.templates.ensure(routeTemplates(manifest, route));
    return new App(application, options.handlers, options.timezone, basePath, options.https ?? false, options.frameAncestors ?? "'self'", bodyLimit, [...formTypes], options.log ?? ((message) => process.stderr.write(`${message}\n`)));
  }

  // Registers the factory of an application service.
  bind<K extends keyof S>(key: K, factory: () => S[K]): void {
    this.services.bind(key, factory);
  }

  // Returns an HTTP server that answers every request with this application and sessions in files.
  server(sessions: FileSessions, options: ServerOptions = {}): Server {
    return createServer(this, sessions, options);
  }

  // Answers one request; an unhandled error gives a plain 500 and is logged (HY-43). Every response limits
  // framing (HY-45).
  async handle(request: Request, store: SessionStore): Promise<Response> {
    let response: Response;
    try {
      response = await this.answer(request, store);
    } catch (error) {
      this.fail(error);
      response = Response.text(500, 'Internal Server Error');
    }
    return this.frame(response);
  }

  // Adds the frame-ancestors policy of the application to a response (HY-45).
  frame(response: Response): Response {
    return response.withHeader('Content-Security-Policy', `frame-ancestors ${this.frameAncestors}`);
  }

  // Writes the log line of an unhandled error (HY-43).
  fail(error: unknown): void {
    this.log(`hyper: ${error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error)}`);
  }

  private async answer(request: Request, store: SessionStore): Promise<Response> {
    if (request.bodySize() > this.bodyLimit) return Response.text(413, 'Content Too Large');
    if (!request.validInput()) return Response.text(400, 'Bad Request');
    const path = stripBasePath(request.path(), this.basePath);
    if (path === '/_hyper/keep') return this.keep(request, new Session(store));
    const match = path === null ? null : this.application.router.match(path);
    if (match === null || path === null) return Response.text(404, 'Not Found');
    const route = this.routes.get(match.name)!;
    const handler = this.handlers.routes?.[route.name] ?? {};
    const session = new Session(store);
    const flash = session.takeFlash();
    const routed = request.withRoute(path, match.params).withSession(flash, session.csrfToken());
    const reply = new Reply();
    const response = await this.routed({ request: routed, route, handler, session, flash, reply, status: 200, invalid: {} });
    return response.withCookies(reply, this.https || request.https);
  }

  // Answers a routed request with its page, action result or stop result.
  private async routed(input: PageInput<S>): Promise<Response> {
    const { request, handler, session, reply } = input;
    try {
      if (request.method === 'GET') return await this.page(input);
      if (request.method !== 'POST' || handler.post === undefined) return Response.text(405, 'Method Not Allowed');
      if (!this.formTypes.includes(request.mediaType())) return Response.text(415, 'Unsupported Media Type');
      if (!tokensEqual(request.csrfToken(), request.formString('_csrf'))) return Response.text(403, 'Forbidden');
      const result = await handler.post({ request, reply, services: this.services });
      if (!(result instanceof Result)) throw new Error(`hyper: POST action of route ${input.route.name} did not return a Result`);
      if (result.isRedirect()) return this.redirect(session, result);
      return await this.page({ ...input, status: result.status, invalid: result.data });
    } catch (error) {
      if (error instanceof NotFound) return Response.text(404, 'Not Found');
      if (error instanceof Redirect) return this.redirect(session, error.result);
      if (error instanceof Forbidden) return Response.text(403, 'Forbidden');
      if (error instanceof BadRequest) return Response.text(400, 'Bad Request');
      throw error;
    }
  }

  private page(input: PageInput<S>): Promise<Response> {
    return renderPage(input, { application: this.application, handlers: this.handlers, services: this.services, timezone: this.timezone, basePath: this.basePath, https: this.https });
  }

  // Stores the flash values and changed topics of a redirect result and answers 303 (HY-25, HY-50).
  private redirect(session: Session, result: Result): Response {
    session.putFlash({ values: new Map(result.flashValues), changed: [...result.changedTopics] });
    return new Response(303, { Location: this.basePath + result.location }, '');
  }

  // Stores a kept value of a `server` path in the session (HY-40).
  private keep(request: Request, session: Session): Response {
    if (request.method !== 'POST') return Response.text(405, 'Method Not Allowed');
    if (!this.formTypes.includes(request.mediaType())) return Response.text(415, 'Unsupported Media Type');
    if (!tokensEqual(session.csrfToken(), request.formString('_csrf'))) return Response.text(403, 'Forbidden');
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

// Compares two tokens in constant time for strings of the same length.
function tokensEqual(known: string, given: string): boolean {
  const a = Buffer.from(known);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
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
