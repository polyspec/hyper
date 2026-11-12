// The steps of contracts/arguments.json (HY-106.8, HY-106.9, HY-106.14 to HY-106.16): a public member that is called
// with another number of arguments than its parameters, or with an option that is no parameter, fails with the count
// error before it runs.
import { mkdtempSync, rmSync } from 'node:fs';
import { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArgumentCountError } from '../../src/argument-count-error.js';
import { Container } from '../../src/container.js';
import { App, ArraySession, BadRequest, Choice, ClientRendering, FileSessions, Forbidden, MediaType, NotFound, RedisSessions, Redirect, Reply, Representation, Request, Response, Result, UploadedFile } from '../../src/index.js';
import type { CaseReader } from '../case-reader.js';
import { client, Fixture, FIXTURES, handlers, TEMPLATES, type Services } from '../support.js';
import { textOf } from '../inputs.js';

// A member of the table: the number of its required parameters, read from the function, and its written call.
interface Member {
  required: number;
  call: (receiver: unknown, args: unknown[]) => unknown;
}

// Returns the receiver of a method as the class of its unit, and fails for another value.
function isApp(value: unknown): value is App<Services> {
  return value instanceof App;
}
function app(value: unknown): App<Services> {
  if (!isApp(value)) throw new Error('the receiver is no App');
  return value;
}
function mediaType(value: unknown): MediaType {
  if (!(value instanceof MediaType)) throw new Error('the receiver is no MediaType');
  return value;
}
function asRequest(value: unknown): Request {
  if (!(value instanceof Request)) throw new Error('the receiver is no Request');
  return value;
}
function reply(value: unknown): Reply {
  if (!(value instanceof Reply)) throw new Error('the receiver is no Reply');
  return value;
}
function response(value: unknown): Response {
  if (!(value instanceof Response)) throw new Error('the receiver is no Response');
  return value;
}
function result(value: unknown): Result {
  if (!(value instanceof Result)) throw new Error('the receiver is no Result');
  return value;
}
function uploadedFile(value: unknown): UploadedFile {
  if (!(value instanceof UploadedFile)) throw new Error('the receiver is no UploadedFile');
  return value;
}
function isContainer(value: unknown): value is Container<{ a: number }> {
  return value instanceof Container;
}
function container(value: unknown): Container<{ a: number }> {
  if (!isContainer(value)) throw new Error('the receiver is no Container');
  return value;
}
function arraySession(value: unknown): ArraySession {
  if (!(value instanceof ArraySession)) throw new Error('the receiver is no ArraySession');
  return value;
}

// The public members by their ids, each called by its written name.
const MEMBERS: Record<string, Member> = {
  'app.bind': {
    required: App.prototype.bind.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => app(receiver).bind(...args),
  },
  'app.handle': {
    required: App.prototype.handle.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => app(receiver).handle(...args),
  },
  'app.server': {
    required: App.prototype.server.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => app(receiver).server(...args),
  },
  'app.listener': {
    required: App.prototype.listener.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => app(receiver).listener(...args),
  },
  'media-type.parameters': {
    required: MediaType.prototype.parameters.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => mediaType(receiver).parameters(...args),
  },
  'media-type.etag': {
    required: MediaType.prototype.etag.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => mediaType(receiver).etag(...args),
  },
  'request.withHeader': {
    required: Request.prototype.withHeader.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => asRequest(receiver).withHeader(...args),
  },
  'request.json': {
    required: Request.prototype.json.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => asRequest(receiver).json(...args),
  },
  'request.selection': {
    required: Request.prototype.selection.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => asRequest(receiver).selection(...args),
  },
  'request.params': {
    required: Request.prototype.params.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => asRequest(receiver).params(...args),
  },
  'request.cookie': {
    required: Request.prototype.cookie.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => asRequest(receiver).cookie(...args),
  },
  'request.param': {
    required: Request.prototype.param.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => asRequest(receiver).param(...args),
  },
  'request.validInput': {
    required: Request.prototype.validInput.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => asRequest(receiver).validInput(...args),
  },
  'request.bodySize': {
    required: Request.prototype.bodySize.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => asRequest(receiver).bodySize(...args),
  },
  'request.mediaType': {
    required: Request.prototype.mediaType.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => asRequest(receiver).mediaType(...args),
  },
  'request.header': {
    required: Request.prototype.header.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => asRequest(receiver).header(...args),
  },
  'request.wantsJson': {
    required: Request.prototype.wantsJson.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => asRequest(receiver).wantsJson(...args),
  },
  'request.isRegionRequest': {
    required: Request.prototype.isRegionRequest.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => asRequest(receiver).isRegionRequest(...args),
  },
  'request.currentPath': {
    required: Request.prototype.currentPath.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => asRequest(receiver).currentPath(...args),
  },
  'request.path': {
    required: Request.prototype.path.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => asRequest(receiver).path(...args),
  },
  'request.rawQuery': {
    required: Request.prototype.rawQuery.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => asRequest(receiver).rawQuery(...args),
  },
  'request.query': {
    required: Request.prototype.query.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => asRequest(receiver).query(...args),
  },
  'request.queryInt': {
    required: Request.prototype.queryInt.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => asRequest(receiver).queryInt(...args),
  },
  'request.form': {
    required: Request.prototype.form.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => asRequest(receiver).form(...args),
  },
  'request.formString': {
    required: Request.prototype.formString.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => asRequest(receiver).formString(...args),
  },
  'request.files': {
    required: Request.prototype.files.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => asRequest(receiver).files(...args),
  },
  'request.file': {
    required: Request.prototype.file.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => asRequest(receiver).file(...args),
  },
  'request.fileOver': {
    required: Request.prototype.fileOver.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => asRequest(receiver).fileOver(...args),
  },
  'request.flash': {
    required: Request.prototype.flash.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => asRequest(receiver).flash(...args),
  },
  'request.browser': {
    required: Request.prototype.browser.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => asRequest(receiver).browser(...args),
  },
  'request.csrfToken': {
    required: Request.prototype.csrfToken.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => asRequest(receiver).csrfToken(...args),
  },
  'reply.note': {
    required: Reply.prototype.note.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => reply(receiver).note(...args),
  },
  'reply.notes': {
    required: Reply.prototype.notes.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => reply(receiver).notes(...args),
  },
  'reply.cookie': {
    required: Reply.prototype.cookie.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => reply(receiver).cookie(...args),
  },
  'reply.removeCookie': {
    required: Reply.prototype.removeCookie.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => reply(receiver).removeCookie(...args),
  },
  'reply.cacheControl': {
    required: Reply.prototype.cacheControl.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => reply(receiver).cacheControl(...args),
  },
  'reply.renewSession': {
    required: Reply.prototype.renewSession.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => reply(receiver).renewSession(...args),
  },
  'reply.referrerPolicy': {
    required: Reply.prototype.referrerPolicy.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => reply(receiver).referrerPolicy(...args),
  },
  'reply.status': {
    required: Reply.prototype.status.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => reply(receiver).status(...args),
  },
  'reply.embedData': {
    required: Reply.prototype.embedData.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => reply(receiver).embedData(...args),
  },
  'response.withHeader': {
    required: Response.prototype.withHeader.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => response(receiver).withHeader(...args),
  },
  'result.flash': {
    required: Result.prototype.flash.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => result(receiver).flash(...args),
  },
  'result.changed': {
    required: Result.prototype.changed.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => result(receiver).changed(...args),
  },
  'uploaded-file.name': {
    required: UploadedFile.prototype.name.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => uploadedFile(receiver).name(...args),
  },
  'uploaded-file.filename': {
    required: UploadedFile.prototype.filename.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => uploadedFile(receiver).filename(...args),
  },
  'uploaded-file.contentType': {
    required: UploadedFile.prototype.contentType.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => uploadedFile(receiver).contentType(...args),
  },
  'uploaded-file.size': {
    required: UploadedFile.prototype.size.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => uploadedFile(receiver).size(...args),
  },
  'uploaded-file.content': {
    required: UploadedFile.prototype.content.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => uploadedFile(receiver).content(...args),
  },
  'uploaded-file.moveTo': {
    required: UploadedFile.prototype.moveTo.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => uploadedFile(receiver).moveTo(...args),
  },
  'container.bind': {
    required: Container.prototype.bind.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => container(receiver).bind(...args),
  },
  'container.get': {
    required: Container.prototype.get.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => container(receiver).get(...args),
  },
  'array-session.get': {
    required: ArraySession.prototype.get.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => arraySession(receiver).get(...args),
  },
  'array-session.set': {
    required: ArraySession.prototype.set.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => arraySession(receiver).set(...args),
  },
  'array-session.remove': {
    required: ArraySession.prototype.remove.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => arraySession(receiver).remove(...args),
  },
  'array-session.renew': {
    required: ArraySession.prototype.renew.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (receiver, args) => arraySession(receiver).renew(...args),
  },
  'request.targetPath': {
    required: Request.targetPath.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (_receiver, args) => Request.targetPath(...args),
  },
  'request.targetQuery': {
    required: Request.targetQuery.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (_receiver, args) => Request.targetQuery(...args),
  },
  'response.text': {
    required: Response.text.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (_receiver, args) => Response.text(...args),
  },
  'result.redirect': {
    required: Result.redirect.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (_receiver, args) => Result.redirect(...args),
  },
  'result.page': {
    required: Result.page.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (_receiver, args) => Result.page(...args),
  },
  'result.invalid': {
    required: Result.invalid.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (_receiver, args) => Result.invalid(...args),
  },
  'app.open': {
    required: App.open.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (_receiver, args) => App.open(...args),
  },
  'media-type.constructor': {
    required: MediaType.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (_receiver, args) => new MediaType(...args),
  },
  'request.constructor': {
    required: Request.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (_receiver, args) => new Request(...args),
  },
  'response.constructor': {
    required: Response.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (_receiver, args) => new Response(...args),
  },
  'redirect.constructor': {
    required: Redirect.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (_receiver, args) => new Redirect(...args),
  },
  'not-found.constructor': {
    required: NotFound.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (_receiver, args) => new NotFound(...args),
  },
  'forbidden.constructor': {
    required: Forbidden.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (_receiver, args) => new Forbidden(...args),
  },
  'bad-request.constructor': {
    required: BadRequest.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (_receiver, args) => new BadRequest(...args),
  },
  'uploaded-file.constructor': {
    required: UploadedFile.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (_receiver, args) => new UploadedFile(...args),
  },
  'array-session.constructor': {
    required: ArraySession.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (_receiver, args) => new ArraySession(...args),
  },
  'file-sessions.constructor': {
    required: FileSessions.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (_receiver, args) => new FileSessions(...args),
  },
  'redis-sessions.constructor': {
    required: RedisSessions.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (_receiver, args) => new RedisSessions(...args),
  },
  'client-rendering.constructor': {
    required: ClientRendering.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (_receiver, args) => new ClientRendering(...args),
  },
  'choice.constructor': {
    required: Choice.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (_receiver, args) => new Choice(...args),
  },
  'representation.constructor': {
    required: Representation.length,
    // @ts-expect-error -- the case gives a number of arguments that the declaration does not take (HY-106.8)
    call: (_receiver, args) => new Representation(...args),
  },
};

// The members that take one options record (HY-106.9).
const RECORDS = ['app.open', 'request.constructor', 'file-sessions.constructor', 'redis-sessions.constructor'];

// The request of the cases: its selected media type lets `wantsJson` and `isRegionRequest` run (HY-116.16).
function request(): Request {
  return new Request({ method: 'GET', path: '/', media: 'text/html' });
}

// A command function of a Redis store that no case calls.
const command = (): Promise<unknown> => Promise.reject(new Error('a store of a case sent a command'));

// Returns the receiver of a method of a unit, a new object for each case, or null for a unit without one.
async function receiverOf(unit: string): Promise<unknown> {
  switch (unit) {
    case 'app':
      return new Fixture().app();
    case 'media-type':
      return new MediaType(new Map(), 'application/json');
    case 'request':
      return request();
    case 'reply':
      return new Reply();
    case 'response':
      return new Response(200, {}, '');
    case 'result':
      return Result.page(200, {});
    case 'uploaded-file':
      return new UploadedFile('f', 'a.txt', 'text/plain', Buffer.from('x'));
    case 'container': {
      const bound = new Container<{ a: number }>();
      bound.bind('a', () => 1);
      return bound;
    }
    case 'array-session':
      return new ArraySession();
    default:
      return null;
  }
}

// Returns the full list of valid arguments of a member in the order of its parameters. `directory` is the temporary
// directory of the case.
function argumentsOf(member: string, directory: string): unknown[] {
  switch (member) {
    case 'app.bind':
      return ['counter', () => ({ count: 0, actions: 0 })];
    case 'app.handle':
      return [request(), new ArraySession(), 0];
    case 'app.server':
    case 'app.listener':
      return [new FileSessions({ directory }), {}];
    case 'media-type.constructor':
      return [new Map(), 'application/json'];
    case 'media-type.etag':
      return ['x'];
    case 'request.withHeader':
    case 'response.withHeader':
      return ['X-A', 'b'];
    case 'request.queryInt':
      return ['a', 0];
    case 'request.fileOver':
      return [1];
    case 'request.targetPath':
    case 'request.targetQuery':
      return ['/a?b'];
    case 'request.cookie':
    case 'request.param':
    case 'request.header':
    case 'request.formString':
    case 'request.file':
    case 'request.flash':
    case 'reply.removeCookie':
    case 'container.get':
    case 'array-session.get':
    case 'array-session.remove':
      return ['a'];
    case 'reply.note':
    case 'result.flash':
    case 'array-session.set':
      return ['a', 1];
    case 'reply.cookie':
      return ['a', 'b', 60];
    case 'reply.cacheControl':
      return ['no-store'];
    case 'reply.referrerPolicy':
      return ['no-referrer'];
    case 'reply.status':
      return [403];
    case 'response.constructor':
      return [200, {}, ''];
    case 'response.text':
      return [200, 'x'];
    case 'result.redirect':
      return ['/a'];
    case 'result.page':
      return [200, {}];
    case 'result.invalid':
      return [{}];
    case 'result.changed':
      return ['a', 'b'];
    case 'redirect.constructor':
      return [Result.redirect('/a')];
    case 'uploaded-file.constructor':
      return ['f', 'a.txt', 'text/plain', Buffer.from('x')];
    case 'uploaded-file.moveTo':
      return [join(directory, 'moved.txt')];
    case 'container.bind':
      return ['a', () => 1];
    case 'client-rendering.constructor':
      return ['shell', '', () => new Choice(false, null)];
    case 'choice.constructor':
      return [true, null];
    case 'representation.constructor':
      return [200, null, {}];
    default:
      return [];
  }
}

// Returns the options record of a member that takes one: its required members, and with `all` every member that the
// record declares, each with a value with which the member runs and none undefined.
function recordOf(member: string, directory: string, all: boolean): Record<string, unknown> {
  const nothing = (): void => {};
  switch (member) {
    case 'app.open':
      return {
        manifest: `${FIXTURES}app.json`,
        build: `${FIXTURES}build.json`,
        templates: TEMPLATES,
        handlers: handlers(),
        timezone: '+09:00',
        ...(all
          ? {
              basePath: '',
              https: false,
              frameAncestors: "'self'",
              bodyLimit: 8388608,
              formTypes: ['application/x-www-form-urlencoded'],
              fileLimit: 8388608,
              responseLimit: 8388608,
              valueLimit: 8388608,
              partLimit: 1000,
              onResponse: nothing,
              clientRendering: client(),
              onDisconnect: nothing,
              log: nothing,
              context: () => new Map(),
              functions: {},
            }
          : {}),
      };
    case 'request.constructor':
      return {
        method: 'GET',
        path: '/',
        ...(all
          ? { headers: {}, query: '', body: new Uint8Array(), flash: new Map(), csrfToken: '', params: {}, cookies: new Map(), https: false, selection: null, bodySize: 0, media: 'text/html', read: null, json: null, signal: new AbortController().signal }
          : {}),
      };
    case 'file-sessions.constructor':
      return { directory, ...(all ? { lifetime: 1440 } : {}) };
    case 'redis-sessions.constructor':
      return { command, ...(all ? { lifetime: 1440, prefix: 'PHPREDIS_SESSION:', lockExpire: 30, lockRetries: 100, lockWait: 20 } : {}) };
    default:
      throw new Error(`the member ${member} takes no options record`);
  }
}

// Returns the arguments of the call of a case: `missing`, `required`, `all` or `extra` of the parameters of the
// member, or of the members of its options record.
function given(member: string, entry: Member, call: string, parameter: string | null, directory: string): unknown[] {
  if (RECORDS.includes(member)) {
    if (call === 'all') return [recordOf(member, directory, true)];
    const record = recordOf(member, directory, false);
    if (call === 'required') return [record];
    if (call === 'extra') return [record, null];
    if (call !== 'missing' || parameter === null || !Object.hasOwn(record, parameter)) throw new Error(`the call ${call} of the case names no required parameter of ${member}`);
    return [Object.fromEntries(Object.entries(record).filter(([name]) => name !== parameter))];
  }
  const all = argumentsOf(member, directory);
  switch (call) {
    case 'missing':
      if (entry.required < 1) throw new Error(`the member ${member} has no required parameter`);
      return all.slice(0, entry.required - 1);
    case 'required':
      if (entry.required >= all.length) throw new Error(`the member ${member} has no optional parameter`);
      return all.slice(0, entry.required);
    case 'all':
      return all;
    case 'extra':
      return [...all, null];
    default:
      throw new Error(`the call ${call} of the case is unknown`);
  }
}

// Makes the call of a case once and compares whether it failed with the count error before the member ran. The
// receiver is built outside the place where the error of the call is read; every other error of the call is thrown.
async function refused(reader: CaseReader, args: (member: string, entry: Member, directory: string) => unknown[]): Promise<void> {
  const member = textOf(reader.input('member'), 'the case field member');
  const entry = Object.hasOwn(MEMBERS, member) ? MEMBERS[member] : undefined;
  if (entry === undefined) throw new Error(`the member ${member} of the case is unknown`);
  const directory = mkdtempSync(join(tmpdir(), 'hyper-arguments-'));
  try {
    const receiver = await receiverOf(member.slice(0, member.lastIndexOf('.')));
    const list = args(member, entry, directory);
    let failed = false;
    try {
      const returned: unknown = await entry.call(receiver, list);
      // A server that the call created never listened; closing it releases it.
      if (returned instanceof Server) returned.close();
    } catch (error) {
      if (!(error instanceof ArgumentCountError) || !(error instanceof TypeError)) throw error;
      failed = true;
    }
    reader.compare('refused', failed);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export const steps = {
  async counts(reader: CaseReader): Promise<void> {
    const call = textOf(reader.input('call'), 'the case field call');
    const parameter = reader.has('parameter') ? textOf(reader.input('parameter'), 'the case field parameter') : null;
    await refused(reader, (member, entry, directory) => given(member, entry, call, parameter, directory));
  },

  // Gives the required members of the options record and one more member under a name that is no parameter.
  async names(reader: CaseReader): Promise<void> {
    const parameter = textOf(reader.input('parameter'), 'the case field parameter');
    await refused(reader, (member, _entry, directory) => [{ ...recordOf(member, directory, false), [parameter]: null }]);
  },
};
