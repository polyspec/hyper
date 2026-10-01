# @polyspec/hyper-server

[한국어](README.ko.md).

The Node.js server of the region protocol. It implements the same rules as the PHP server `polyspec/hyper` (see [Region protocol](../../docs/spec/protocol.md), HY-54 lists the differences): routes with a base path, shared, region and route loaders, `POST` actions with CSRF, redirect and invalid results, `Redirect`, `Forbidden` and `NotFound`, reply cookies and cache control, JSON tags and 304, flash values and changed topics, kept values with `/_hyper/keep`, request checks, plain error responses, the data model check and sessions in files. It renders documents with the browser code of `@polyspec/hyper` and the template files of the asset build, so its documents are the browser renders of the same JSON.

Node.js 26 or later. The package exports TypeScript source, as `@polyspec/hyper` does; a server bundles it, for example with esbuild (`make node-server` builds the board example this way).

## Open an application

```ts
import { App, FileSessions, NotFound, Result } from '@polyspec/hyper-server';

interface Services {
  posts: Posts;
}

const app = await App.open<Services>({
  manifest: '/srv/board/app/app.json',
  templates: { index: '/srv/board/build/templates.index.json', root: '/srv/board/public' },
  handlers: {
    shared: () => ({ site: 'Board' }),
    regions: { left: ({ request, services }) => ({ path: request.path(), count: services.get('posts').count() }) },
    routes: {
      'board.show': {
        load: ({ request, services }) => {
          const post = services.get('posts').find(request.param('id') ?? '');
          if (post === null) throw new NotFound();
          return { post };
        },
      },
      'board.create': {
        post: ({ request, services }) => {
          const title = request.formString('title');
          if (title === '') return Result.invalid({ errors: { title: 'Enter a title.' } });
          const id = services.get('posts').create(title);
          return Result.redirect('/board').flash('created', id).changed('posts');
        },
      },
    },
  },
  timezone: '+09:00',
});
app.bind('posts', () => new Posts('/srv/board/var/board.db'));
```

`App.open(options)` returns a promise of the application and fails when the manifest, the handlers or the templates do not match:

| Option | Meaning |
|---|---|
| `manifest` | Absolute path of `app.json` (HY-1). |
| `templates` | `index`: absolute path of the template index that the asset build writes; `root`: the absolute directory that the file URLs of the index are relative to (HY-34). |
| `handlers` | `shared`, `regions` (non-page regions) and `routes` (`load`, `post`, `regions` for route regions). A route has `post` exactly when the manifest declares `"post": true`. |
| `timezone` | The time zone of the rendering environment (HY-14). |
| `basePath` | A base path such as `/api` (HY-8); the default is none. |
| `https` | Declares HTTPS, for example behind a TLS-terminating proxy; cookies are then `Secure` (HY-45). |
| `frameAncestors` | The sources of `frame-ancestors`; the default is `'self'` (HY-45). |
| `log` | Receives the log line of an unhandled error (HY-43); the default writes to the standard error. |

`app.bind(key, factory)` registers an application service. A service is created once, on first use; `services.get(key)` of a key without a factory fails the request with 500.

## Loaders and actions

Every loader and action receives one context object:

| Field | Type | Meaning |
|---|---|---|
| `request` | `Request` | `method`, `path()`, `params()`, `param(name)`, `query()`, `rawQuery()`, `queryInt(name, fallback)`, `formString(name)`, `flash(name)`, `cookie(name)`, `header(name)`, `csrfToken()`, `currentPath()`, `wantsJson()`, `isRegionRequest()`, `https` |
| `reply` | `Reply` | `cookie(name, value, maxAge?)`, `removeCookie(name)`, `cacheControl(value)` (HY-52) |
| `services` | `Services<S>` | `get(key)` returns the service that `app.bind` registered |

A loader returns data: a plain object or a `Map` with string keys, synchronously or as a promise. Values are null, booleans, numbers and bigints within ±(2^53 − 1), strings, arrays, maps and plain objects (HY-44, HY-54). A plain object puts integer-like keys first, as JavaScript does; a `Map` keeps insertion order.

An action returns a `Result`:

- `Result.redirect(location)` answers 303 with `Location`; the location is an application path (HY-46). `.flash(name, value)` stores a value for the next request and `.changed(...topics)` records changed topics (HY-25).
- `Result.invalid(data)` renders the route page with status 422 and the data merged into the page data (HY-26).

A loader or an action stops the request by throwing `new NotFound()` (404, HY-27), `new Redirect(Result.redirect(location))` (303, HY-50) or `new Forbidden()` (403, HY-51). Any other error answers a plain 500 and is logged (HY-43).

## Serve over HTTP

```ts
const sessions = new FileSessions({ directory: '/srv/board/var/sessions', name: 'hyper_session' });
app.server(sessions, { files: '/srv/board/public' }).listen(8080, '127.0.0.1');
```

`app.server(sessions, options)` returns a `node:http` server. `options.bodyLimit` is the largest request body (8 MiB by default; a larger body receives 413), and `options.files` is an absolute directory whose files are served for `GET` and `HEAD` requests that name them, as the PHP built-in server serves its document root. A request that `node:http` cannot parse, such as a request target with a byte outside ASCII, receives a plain 400 (HY-42).

`FileSessions({ directory, name, lifetime })` keeps each session in a file of an existing absolute directory that only this server process writes. `name` is the session cookie name and `lifetime` the seconds after the last request of a session until it ends (1440 by default, as PHP's `session.gc_maxlifetime`). The store accepts only identifiers that it created, starts a session only when a request reads or writes session data, and runs the requests of one session one after another (HY-45). `sessions.collect()` removes the files of ended sessions; a server calls it on a schedule of its choice.

## Answer requests without HTTP

```ts
import { MemorySessionStore, Request } from '@polyspec/hyper-server';

const session = new MemorySessionStore();
const response = await app.handle(Request.from({ method: 'GET', target: '/board', headers: { Accept: 'application/json' } }), session);
// response.status, response.headers, response.body
```

`Request.from({ method, target, headers, body, https })` takes the parts of an HTTP request as `node:http` gives them: the target and header values are text whose characters are bytes, and the body is bytes. `SessionStore` is the interface of one session (`get`, `set`, `remove`); `MemorySessionStore` keeps one session in memory for tests.

## JSON

`encodeJson(value)` writes the bytes of PHP `json_encode` with `JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES`, and `decodeJson(text)` reads as PHP `json_decode` does, with `OutsideNumber` for numbers outside the data model (HY-54). Both pass `conformance/json.json`, as the PHP server does.
