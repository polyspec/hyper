// Renders the route page as a document or as JSON (HY-12 to HY-19, HY-26, HY-30, HY-31, HY-38, HY-44, HY-52,
// HY-53, HY-69). The document is the browser rendering of the document JSON value, with the browser code. The app
// creates one page when it opens.
import { createHash } from 'node:crypto';
import { decodeResponse, keepRead, keptPaths, renderDocument, type Application, type RouteDeclaration, type RouteReads } from '@polyspec/hyper-client';
import type { Handlers, RouteHandlers } from '../app/app.js';
import { Context, type ContextHandler } from '../app/context.js';
import { JsonCodec, type DecodedValue } from '../data/json-codec.js';
import { JsonDecodeError } from '../data/json-decode-error.js';
import { Kept } from '../data/kept.js';
import { RegionPlanner } from './region-planner.js';
import type { Reply } from '../http/reply.js';
import { HYPER_JSON, type Request } from '../http/request.js';
import { Response } from '../http/response.js';
import type { Container } from '../app/container.js';
import type { Flash } from '../session/flash.js';
import type { Session } from '../session/session.js';
import { replaced, toValue, type Data, type MapValue, type Value } from '../data/values.js';

// The state of the application that the page reads, the one argument of the constructor.
/** @internal */
export interface PageParts<S extends object> {
  application: Application;
  handlers: Handlers<S>;
  services: Container<S>;
  timezone: string;
  https: boolean;
  // The read paths of every route, by the route name (HY-73).
  reads: Record<string, RouteReads>;
  // The build id of the asset output (HY-125), which every JSON response holds after its params (HY-128).
  build: string;
  // The context handler of the application (HY-124), or null for an application without a context.
  context: ContextHandler | null;
  // The Vary of the application's html and JSON responses (HY-117).
  vary: string;
}

/** @internal */
export class Page<S extends object> {
  private readonly parts: PageParts<S>;

  constructor(parts: PageParts<S>) {
    this.parts = parts;
  }

  // Renders the page of a routed request with the status and the invalid data of its action. `basePath` is the base
  // path of the request: the data base path for a client-rendered request (HY-8, HY-62). A request whose client closed
  // the connection stops (HY-67).
  async respond(request: Request, route: RouteDeclaration, handler: RouteHandlers<S>, session: Session, flash: Flash, status: number, invalid: Data, reply: Reply, basePath: string): Promise<Response> {
    const environment = this.parts;
    const { application, handlers } = environment;
    // The read paths of a route, which the open computes for every route of the manifest (HY-73).
    const routeReads = environment.reads[route.name];
    if (routeReads === undefined) throw new Error(`hyper: route ${route.name} has no read paths`);
    const argument = { request, reply, services: environment.services };
    // HY-124: the context handler runs after the action of the request and before the shared handler and any loader.
    const held = environment.context === null ? null : await Context.held(environment.context, request.selection());
    let shared: MapValue = new Map<string, Value>([['title', route.title], ['csrf', request.csrfToken()]]);
    if (handlers.shared !== undefined) {
      const returned = Page.loaderMap(await handlers.shared(argument), 'shared data');
      // HY-124: a shared handler that returns the key context fails.
      if (returned.has('context')) throw new Error('hyper: the shared handler returned the key context (HY-124)');
      shared = replaced(shared, returned);
    }
    request.stopClosed();

    const changed = RegionPlanner.changedTopics(request, flash, basePath);
    const data = new Map<string, MapValue>();
    for (const selected of RegionPlanner.select(application.manifest, !request.isRegionRequest(), changed)) {
      if (selected.page === true) {
        const loaded = handler.load === undefined ? new Map() : Page.loaderMap(await handler.load(argument), `data of route ${route.name}`);
        request.stopClosed();
        data.set(selected.name, replaced(loaded, Page.loaderMap(invalid, `invalid data of route ${route.name}`)));
        for (const region of route.regions ?? []) {
          const loader = handler.regions?.[region.name];
          const loaded = loader === undefined ? {} : await loader(argument);
          request.stopClosed();
          // HY-75: a route region loader that returns null makes the region absent from this response.
          if (loaded === null) continue;
          data.set(region.name, Page.loaderMap(loaded, `data of region ${region.name}`));
        }
      } else {
        const loader = handlers.regions?.[selected.name];
        data.set(selected.name, loader === undefined ? new Map() : Page.loaderMap(await loader(argument), `data of region ${selected.name}`));
        request.stopClosed();
      }
    }

    // HY-44: every value that the handlers returned belongs to the data model, also a value that no template reads.
    JsonCodec.encode(new Map<string, Value>([['shared', shared], ['regions', new Map(data)]]));
    // HY-73: the page keeps only the paths that the templates of the route read.
    const readShared = keepRead(shared, routeReads.shared);
    if (!(readShared instanceof Map)) throw new TypeError('hyper: the shared data is not a map');
    shared = readShared;
    for (const [name, regionData] of data) {
      const reads = routeReads.regions[name];
      if (reads === undefined) throw new Error(`hyper: region ${name} has no read paths`);
      const read = keepRead(regionData, reads);
      if (!(read instanceof Map)) throw new TypeError(`hyper: data of region ${name} is not a map`);
      data.set(name, read);
    }

    // HY-31, HY-92: a document embeds its data when its reply asks for it and a route region is present (HY-75).
    const embeds = reply.embedsData() && (route.regions ?? []).some((region) => data.has(region.name));
    // HY-128: a JSON response, and a document that embeds its data, hold the member context after build. Only the
    // document always holds the value (HY-128.4); a JSON response omits it for the current hash (HY-128.2).
    const contextValue = held !== null && (request.wantsJson() || embeds) ? Context.member(environment.build, held, request.wantsJson() ? request.header('Hyper-Context') : null) : null;
    const value = JsonCodec.value(
      environment.timezone,
      route.name,
      new Map(Object.entries(request.params())),
      environment.build,
      contextValue,
      shared,
      new Map(data),
      this.kept(request, session, data),
    );
    // HY-69: the reply gives a page with status 200 the status 403.
    const pageStatus = status === 200 ? (reply.statusValue() ?? status) : status;
    const cacheControl = pageStatus === 200 ? (reply.cacheControlValue() ?? 'no-store') : 'no-store';
    if (request.wantsJson()) {
      const body = JsonCodec.encode(value);
      const headers: Response['headers'] = { 'Content-Type': HYPER_JSON, 'Cache-Control': cacheControl, Vary: environment.vary, ...reply.referrerPolicyHeaders() };
      if (pageStatus !== 200) return new Response(pageStatus, headers, body);
      // HY-53: a weak tag of the body with the masked token replaced by the session token, so the mask does not change
      // it; a matching GET request receives 304 without a body and without `Content-Type`, because a 304 carries no
      // representation.
      const tag = `W/"${createHash('sha256').update(body.replaceAll(request.csrfToken(), session.csrfToken())).digest('hex').slice(0, 32)}"`;
      headers.ETag = tag;
      if (request.method !== 'GET' || request.header('If-None-Match') !== tag) return new Response(200, headers, body);
      const { 'Content-Type': _, ...notModified } = headers;
      return new Response(304, notModified, '');
    }
    // HY-92: the document embeds its data only when the reply asks for it.
    // HY-124, HY-10: the templates read the context in the shared data (HY-126: the read paths do not reduce it).
    const decoded = decodeResponse(application, value, request.path());
    const document = renderDocument(application, held === null ? decoded : { ...decoded, shared: Context.withContext(decoded.shared, held) }, { embed: reply.embedsData() });
    return new Response(pageStatus, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': cacheControl, Vary: environment.vary, ...reply.referrerPolicyHeaders() }, document);
  }

  // Converts the data that a loader returned into a map of the data model; another value fails. `source` names the
  // data in the message.
  private static loaderMap(value: unknown, source: string): MapValue {
    const map = toValue(value);
    if (!(map instanceof Map)) throw new TypeError(`hyper: ${source} is not a map`);
    return map;
  }

  // Returns the conforming `server` and `cookie` kept values of the regions, by region and path (HY-17, HY-38).
  private kept(request: Request, session: Session, data: Map<string, MapValue>): MapValue {
    // On HTTPS only the host-only cookie counts, which another host cannot set (HY-38).
    const cookie = Page.decodedCookie(request.cookie(this.parts.https || request.https ? '__Host-hy-keep' : 'hy-keep'));
    const values: MapValue = new Map();
    for (const [name, regionData] of data) {
      const stored = session.kept(name);
      const cookieValues = cookie instanceof Map ? cookie.get(name) : undefined;
      const pairs: [string, Value | DecodedValue][] = [];
      for (const [path, kind] of Object.entries(keptPaths(this.parts.application.manifest, name))) {
        const value = kind === 'server' ? stored.get(path) : kind === 'cookie' && cookieValues instanceof Map ? cookieValues.get(path) : undefined;
        if (value !== undefined) pairs.push([path, value]);
      }
      const selected = Kept.select(regionData, pairs);
      if (selected.size > 0) values.set(name, selected);
    }
    return values;
  }

  // Returns the decoded hy-keep cookie, or null for a cookie that is absent or not JSON (HY-42).
  private static decodedCookie(text: string | null): DecodedValue {
    if (text === null) return null;
    try {
      return JsonCodec.decode(text);
    } catch (error) {
      if (error instanceof JsonDecodeError) return null;
      throw error;
    }
  }
}
