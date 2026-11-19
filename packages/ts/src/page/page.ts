// Answers the route page as a document or as JSON (HY-12 to HY-19, HY-26, HY-30, HY-31, HY-38, HY-44, HY-52, HY-53,
// HY-69) with the steps of a page of the core: `PageRequest.next` names each handler, the server calls it and gives its
// result to the next step, and the last step holds the document or the JSON text. The core selects the regions, checks
// every value (HY-44), keeps the read paths (HY-73) and renders; the server holds no rule of them. The app creates one
// page when it opens.
import type { Manifest, RouteDeclaration } from '@polyspec/hyper-client';
import type { Handlers, RouteHandlers } from '../app/app.js';
import { Context, type ContextHandler } from '../app/context.js';
import { RegionPlanner } from './region-planner.js';
import type { Reply } from '../http/reply.js';
import type { Request } from '../http/request.js';
import { Response } from '../http/response.js';
import { rules, type Answer, type CorePagesInstance, type PageStepInput } from '../app/core-rules.js';
import type { Container } from '../app/container.js';
import type { Flash } from '../session/flash.js';
import type { Session } from '../session/session.js';
import type { Data } from '../data/values.js';

// The state of the application that the page reads, the one argument of the constructor.
/** @internal */
export interface PageParts<S extends object> {
  // The pages of the application that the core opened (HY-48.19).
  pages: CorePagesInstance;
  manifest: Manifest;
  handlers: Handlers<S>;
  services: Container<S>;
  https: boolean;
  // The context handler of the application (HY-124), or null for an application without a context.
  context: ContextHandler | null;
}

// The action of a request that answers its route page: the status and the data of its result, or null for an action
// that let `REVISION_CHANGED` escape (HY-107.4), and the masked value of the token that the request held before the
// action, which differs from that of the request of the page after a renewal (HY-72.3).
/** @internal */
export interface PageAction {
  readonly result: { readonly status: number; readonly data: Data } | null;
  readonly masked: string;
}

/** @internal */
export class Page<S extends object> {
  private readonly parts: PageParts<S>;
  // The name of the page region of the manifest, whose data the loader of the route gives.
  private readonly pageRegion: string;

  constructor(parts: PageParts<S>) {
    this.parts = parts;
    const page = parts.manifest.regions.find((region) => region.page === true);
    if (page === undefined) throw new Error('hyper: the manifest has no page region');
    this.pageRegion = page.name;
  }

  // Answers the page of a routed request. `action` is the action of a POST request that answers its page, or null for
  // a GET request. `basePath` is the base path of the request: the data base path for a client-rendered request (HY-8,
  // HY-62). A request whose client closed the connection stops (HY-67).
  async respond(request: Request, route: RouteDeclaration, handler: RouteHandlers<S>, session: Session, flash: Flash, action: PageAction | null, reply: Reply, basePath: string): Promise<Response> {
    const { handlers, context } = this.parts;
    const argument = { request, reply, services: this.parts.services };
    // The masked value of the page input is that of before the action; the action step gives the new one (HY-72.3).
    const masked = request.csrfToken();
    const page = rules().pageRequest(this.parts.pages, {
      route: route.name,
      params: new Map(Object.entries(request.params())),
      kind: request.wantsJson() ? (request.isRegionRequest() ? 'region_json' : 'document_json') : 'html',
      action: action !== null,
      csrf: action?.masked ?? masked,
      changed: RegionPlanner.changedTopics(request, flash, basePath),
      // HY-14.3: one whole number of seconds for every render of the response.
      now: Math.floor(Date.now() / 1000),
      // On HTTPS only the host-only cookie counts, which another host cannot set (HY-38).
      keepCookie: request.cookie(rules().keptCookieName(this.parts.https || request.https)),
      heldHash: request.header('Hyper-Context'),
    });
    // The regions whose loader gave data, in the order of their calls; the session is read for these (HY-38.20).
    const present: string[] = [];
    let step = page.next({ input: 'start' });
    while (step.step === 'call') {
      const call = step.call;
      let input: PageStepInput;
      switch (call.call) {
        case 'action': {
          if (action === null) throw new Error('hyper: a page without an action asked for its action');
          const csrf = masked === action.masked ? null : masked;
          input = action.result === null
            ? { input: 'action', outcome: { outcome: 'revision_changed' }, csrf }
            : { input: 'action', outcome: { outcome: 'page', status: action.result.status, data: Page.loaderMap(action.result.data, `invalid data of route ${route.name}`) }, csrf };
          break;
        }
        case 'context':
          // HY-124: the context handler runs after the action of the request and before the shared handler and any loader.
          if (context === null) throw new Error('hyper: a page without a context handler asked for its context');
          input = { input: 'context', context: await Context.held(context, request.selection()) };
          break;
        case 'shared':
          input = handlers.shared === undefined ? { input: 'no_handler' } : { input: 'shared', shared: Page.loaderMap(await handlers.shared(argument), 'shared data') };
          request.stopClosed();
          break;
        case 'route_loader':
          input = handler.load === undefined ? { input: 'no_handler' } : { input: 'loaded', data: Page.loaderMap(await handler.load(argument), `data of route ${route.name}`) };
          request.stopClosed();
          present.push(this.pageRegion);
          break;
        case 'route_region_loader': {
          const loader = handler.regions?.[call.region];
          const loaded = loader === undefined ? undefined : await loader(argument);
          request.stopClosed();
          // HY-75: a route region loader that returns null makes the region absent from this response.
          if (loaded === null) {
            input = { input: 'absent' };
            break;
          }
          input = loaded === undefined && loader === undefined ? { input: 'no_handler' } : { input: 'loaded', data: Page.loaderMap(loaded, `data of region ${call.region}`) };
          present.push(call.region);
          break;
        }
        case 'region_loader': {
          const loader = handlers.regions?.[call.region];
          input = loader === undefined ? { input: 'no_handler' } : { input: 'loaded', data: Page.loaderMap(await loader(argument), `data of region ${call.region}`) };
          request.stopClosed();
          present.push(call.region);
          break;
        }
        case 'reply':
          // HY-38.20: the stored kept values are read after every loader returned. HY-92, HY-69: the reply states
          // whether a document embeds its data and the status of a page with status 200.
          input = { input: 'reply', embeds: reply.embedsData(), stored: new Map(present.map((name) => [name, session.kept(name)])), status: reply.statusValue() };
          break;
      }
      step = page.next(input);
    }
    const answer = step.answer;
    if (answer.answer === 'no_page') throw new Error('hyper: the page of a request answered no page');
    const { json, body, maskedToken, token } = Page.json(answer, masked, session);
    const computed = rules().pageHeaders({
      status: answer.status,
      json,
      body,
      context: context !== null,
      maskedToken,
      token,
      method: request.method,
      cacheControl: reply.cacheControlValue(),
      ifNoneMatch: request.header('If-None-Match'),
      referrerPolicy: reply.referrerPolicyValue(),
    });
    return new Response(computed.status, computed.headers, computed.body ? body : '');
  }

  // The JSON part of an answer: whether it is JSON and its text. HY-53: only a JSON response with status 200 has a tag,
  // which the core computes from the body with the masked token replaced by the token of the session; the session is
  // read for no other response.
  private static json(answer: Exclude<Answer, { readonly answer: 'no_page' }>, masked: string, session: Session): { json: boolean; body: string; maskedToken: string; token: string } {
    const json = answer.answer === 'json';
    const body = answer.answer === 'json' ? answer.text : answer.html;
    const tagged = json && answer.status === 200;
    return { json, body, maskedToken: tagged ? masked : '', token: tagged ? session.csrfToken() : '' };
  }

  // Returns the result of a handler as the map that a step of the core takes (HY-44.4): a Map as it is, and a plain
  // object as the map of its own entries; another value fails. The binding converts the values of the map and the core
  // checks them (HY-44.12). `source` names the data in the message.
  private static loaderMap(value: unknown, source: string): ReadonlyMap<string, unknown> {
    if (value instanceof Map) return value;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const prototype: unknown = Object.getPrototypeOf(value);
      if (prototype === Object.prototype || prototype === null) return new Map(Object.entries(value));
    }
    throw new TypeError(`hyper: ${source} is not a map`);
  }
}
