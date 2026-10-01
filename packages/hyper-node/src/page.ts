// Renders the route page as a document or as JSON (HY-12 to HY-19, HY-26, HY-30, HY-31, HY-38, HY-44, HY-52,
// HY-53). The document is the browser rendering of the document JSON value, with the browser code.
import { createHash } from 'node:crypto';
import { decodeResponse, renderDocument, type Application, type RouteDeclaration } from '@polyspec/hyper';
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
}

export interface PageEnvironment<S extends object> {
  application: Application;
  handlers: Handlers<S>;
  services: Services<S>;
  timezone: string;
  basePath: string;
  https: boolean;
}

const VARY = 'Accept, HX-Request, HX-Current-URL';

export async function renderPage<S extends object>(input: PageInput<S>, environment: PageEnvironment<S>): Promise<Response> {
  const { request, route, handler, reply, status } = input;
  const { application, handlers } = environment;
  const context = { request, reply, services: environment.services };
  let shared: MapValue = new Map<string, Value>([['title', route.title], ['csrf', request.csrfToken()]]);
  if (handlers.shared !== undefined) shared = replaced(shared, toMap(await handlers.shared(context), 'shared data'));

  const changed = changedTopics(request, input.flash, environment.basePath);
  const data = new Map<string, MapValue>();
  for (const selected of selectRegions(application.manifest, !request.isRegionRequest(), changed)) {
    if (selected.page === true) {
      const loaded = handler.load === undefined ? new Map() : toMap(await handler.load(context), `data of route ${route.name}`);
      data.set(selected.name, replaced(loaded, toMap(input.invalid, `invalid data of route ${route.name}`)));
      for (const region of route.regions ?? []) {
        const loader = handler.regions?.[region.name];
        data.set(region.name, loader === undefined ? new Map() : toMap(await loader(context), `data of region ${region.name}`));
      }
    } else {
      const loader = handlers.regions?.[selected.name];
      data.set(selected.name, loader === undefined ? new Map() : toMap(await loader(context), `data of region ${selected.name}`));
    }
  }

  const value: MapValue = new Map<string, Value>([
    ['env', new Map([['timezone', environment.timezone]])],
    ['route', route.name],
    ['params', new Map(Object.entries(request.params()))],
    ['shared', shared],
    ['regions', new Map(data)],
    ['kept', keptValues(request, input.session, data, application, environment.https)],
  ]);
  const cacheControl = status === 200 ? (reply.cacheControlValue() ?? 'no-store') : 'no-store';
  if (request.wantsJson()) {
    const body = encodeJson(value);
    const headers: Headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cacheControl, Vary: VARY };
    if (status !== 200) return new Response(status, headers, body);
    // HY-53: a strong tag of the body; a matching request receives 304 without a body.
    const tag = `"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"`;
    headers.ETag = tag;
    return request.header('If-None-Match') === tag ? new Response(304, headers, '') : new Response(200, headers, body);
  }
  const document = renderDocument(application, decodeResponse(application, value, request.path()));
  return new Response(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': cacheControl, Vary: VARY }, document);
}
