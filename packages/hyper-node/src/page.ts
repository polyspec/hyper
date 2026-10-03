// Renders the route page as a document or as JSON (HY-12 to HY-19, HY-26, HY-30, HY-31, HY-38, HY-44, HY-52,
// HY-53, HY-69). The document is the browser rendering of the document JSON value, with the browser code.
import { createHash } from 'node:crypto';
import { decodeResponse, keepRead, renderDocument, type Application, type RouteDeclaration, type RouteReads } from '@polyspec/hyper';
import type { Handlers, RouteHandlers } from './app.js';
import { encodeJson } from './json.js';
import { keptValues } from './kept.js';
import { changedTopics, selectRegions } from './planner.js';
import type { Reply } from './reply.js';
import type { Request } from './request.js';
import { Response, type Headers } from './response.js';
import type { Services } from './services.js';
import type { Flash, Session } from './session.js';
import { replaced, toMap, type Data, type MapValue, type Value } from './values.js';

export interface PageInput<S extends object> {
  request: Request;
  route: RouteDeclaration;
  handler: RouteHandlers<S>;
  session: Session;
  flash: Flash;
  reply: Reply;
  status: number;
  invalid: Data;
  // The base path of the request: the data base path for a client-rendered request (HY-8, HY-62).
  basePath: string;
  // Aborted when the client closed the connection (HY-67).
  signal?: AbortSignal | undefined;
}

// Stops a request whose client closed the connection (HY-67).
export class Disconnected extends Error {}

// Throws Disconnected when the client of a request closed the connection, so that no further loader, action or
// rendering runs (HY-67).
export function stopClosed(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new Disconnected('hyper: the client closed the connection');
}

export interface PageEnvironment<S extends object> {
  application: Application;
  handlers: Handlers<S>;
  services: Services<S>;
  timezone: string;
  https: boolean;
  // The read paths of the route (HY-73).
  reads: RouteReads;
}

const VARY = 'Accept, HX-Request, HX-Current-URL';

export async function renderPage<S extends object>(input: PageInput<S>, environment: PageEnvironment<S>): Promise<Response> {
  const { request, route, handler, reply, status } = input;
  const { application, handlers } = environment;
  const context = { request, reply, services: environment.services };
  let shared: MapValue = new Map<string, Value>([['title', route.title], ['csrf', request.csrfToken()]]);
  if (handlers.shared !== undefined) shared = replaced(shared, toMap(await handlers.shared(context), 'shared data'));
  stopClosed(input.signal);

  const changed = changedTopics(request, input.flash, input.basePath);
  const data = new Map<string, MapValue>();
  for (const selected of selectRegions(application.manifest, !request.isRegionRequest(), changed)) {
    if (selected.page === true) {
      const loaded = handler.load === undefined ? new Map() : toMap(await handler.load(context), `data of route ${route.name}`);
      stopClosed(input.signal);
      data.set(selected.name, replaced(loaded, toMap(input.invalid, `invalid data of route ${route.name}`)));
      for (const region of route.regions ?? []) {
        const loader = handler.regions?.[region.name];
        const loaded = loader === undefined ? {} : await loader(context);
        stopClosed(input.signal);
        // HY-75: a route region loader that returns null makes the region absent from this response.
        if (loaded === null) continue;
        data.set(region.name, toMap(loaded, `data of region ${region.name}`));
      }
    } else {
      const loader = handlers.regions?.[selected.name];
      data.set(selected.name, loader === undefined ? new Map() : toMap(await loader(context), `data of region ${selected.name}`));
      stopClosed(input.signal);
    }
  }

  // HY-44: every value that the handlers returned belongs to the data model, also a value that no template reads.
  encodeJson(new Map<string, Value>([['shared', shared], ['regions', new Map(data)]]));
  // HY-73: the page keeps only the paths that the templates of the route read.
  shared = keepRead(shared, environment.reads.shared) as MapValue;
  for (const [name, regionData] of data) data.set(name, keepRead(regionData, environment.reads.regions[name]!) as MapValue);

  const value: MapValue = new Map<string, Value>([
    ['env', new Map([['timezone', environment.timezone]])],
    ['route', route.name],
    ['params', new Map(Object.entries(request.params()))],
    ['shared', shared],
    ['regions', new Map(data)],
    ['kept', keptValues(request, input.session, data, application, environment.https)],
  ]);
  // HY-69: the reply gives a page with status 200 the status 403.
  const pageStatus = status === 200 ? (reply.statusValue() ?? status) : status;
  const cacheControl = pageStatus === 200 ? (reply.cacheControlValue() ?? 'no-store') : 'no-store';
  if (request.wantsJson()) {
    const body = encodeJson(value);
    const headers: Headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cacheControl, Vary: VARY };
    if (pageStatus !== 200) return new Response(pageStatus, headers, body);
    // HY-53: a weak tag of the body with the masked token replaced by the session token, so the mask does not change
    // it; a matching GET request receives 304 without a body and without `Content-Type`, because a 304 carries no
    // representation.
    const tag = `W/"${createHash('sha256').update(body.replaceAll(request.csrfToken(), input.session.csrfToken())).digest('hex').slice(0, 32)}"`;
    headers.ETag = tag;
    if (request.method !== 'GET' || request.header('If-None-Match') !== tag) return new Response(200, headers, body);
    const { 'Content-Type': _, ...notModified } = headers;
    return new Response(304, notModified, '');
  }
  const document = renderDocument(application, decodeResponse(application, value, request.path()));
  return new Response(pageStatus, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': cacheControl, Vary: VARY }, document);
}
