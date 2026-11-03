<!-- doc-id: deployment -->
# Deployment

[한국어](deployment.ko.md).

One application deploys in two forms. Both use the same manifest, templates, client bundle and handlers, on the PHP, Node.js and Python server alike.

| Form | First document | Later navigation | Use |
|---|---|---|---|
| Server and CDN (recommended) | The server renders it (SSR) | JSON, rendered by the browser | Every application whose server can render HTML |
| Static shell | The browser renders it from `/api` JSON (CSR) | JSON, rendered by the browser | A backend that serves JSON only |

## Server and CDN (recommended)

The server tells the two kinds of requests apart by their headers (HY-15). A direct request (the address bar, a reload, a bookmark, a search crawler or a link preview bot) has no `HX-Request` and receives the complete document. A request from htmx inside a page carries `Accept: application/json` and `HX-Request` and receives JSON, which the browser renders. Search engines and link previews therefore always receive complete documents with their titles.

| Path pattern | Origin | Behavior |
|---|---|---|
| `/assets/*` | S3 bucket with `public/assets` | `GET` and `HEAD`. The client script and the template files carry content hashes in their names: `Cache-Control: public, max-age=31536000, immutable`. |
| default (`*`) | PHP server | All methods, no caching, forward the `Cookie` (the session cookie and `__Host-hy-keep`), `Accept`, `HX-Request`, `HX-Current-URL` and `Content-Type` headers and the query string. |

PHP runs without a base path. Responses carry `Vary: Accept, HX-Request, HX-Current-URL`.

Deploy `build/server`, which `make server` writes, next to the PHP code; the application opens it with `App::open(program: ...)`. For the fastest rendering, build the native template extension with `make ext` for the PHP version of the server and load it with the `extension` setting of `php.ini`. Without the extension, PHP renders with the generated program in `build/server/php/`, whose namespace the application maps to that directory in `autoload.psr-4` of its `composer.json`, so that the autoload of Composer loads it (HY-48).

## Static shell

`make assets` writes `examples/board/build/csr/`: `index.html` with the client entry inlined and no stylesheet (HYC-16), `assets/templates/` with one file per template, and the stylesheets `assets/app.css` and `assets/reader.css`, which `make assets` names with `--static` from `public/assets/`, and which the rendered layout links and the browser applies before it shows a page (HYC-15).

1. Upload `index.html` to an S3 bucket with `Content-Type: text/html; charset=utf-8` and `Cache-Control: no-cache`, `assets/templates/*` with `Content-Type: application/json` and `Cache-Control: public, max-age=31536000, immutable`, and `assets/*.css` with `Content-Type: text/css; charset=utf-8` and `Cache-Control: no-cache`, because their names carry no hash.
2. Run PHP with the environment variable `BOARD_BASE_PATH=/api` (HY-8).
3. Route `/api/*` to PHP as in the table above, `/assets/*` to S3, and every other path to `/index.html` with a CloudFront Function on viewer request.
4. Send a Content Security Policy that allows the inline entry by hash and the chunk files and linked stylesheets by `'self'`; `make assets` prints the policy. Upload chunk files `assets/hyper-chunk-*.js` with `Content-Type: text/javascript; charset=utf-8` and `Cache-Control: public, max-age=31536000, immutable`, because their names carry a hash.

Every page path returns the same empty shell, so search crawlers that do not run JavaScript and link preview bots see no content and no title. Use this form only for screens that do not need them.

## One server for both forms

One server of either implementation can answer the server-rendered pages and the client-rendered pages of one manifest with the same handlers (HY-62). The application declares client rendering when it opens: `App::open(clientRendering: new ClientRendering(shell: '/srv/app/build/csr/index.html', basePath: '/_props', selects: fn (Request $request): Choice => new Choice(chosen: ..., value: ...)))` in PHP, the `clientRendering` option `{ shell, basePath, selects }` of `App.open` in Node, and `client_rendering=ClientRendering(shell='/srv/app/build/csr/index.html', base_path='/_props', selects=...)` in Python. The selection chooses the client-rendered requests, for example by the `Host` header, and its value, such as the stored service of the host, reaches every loader and action of the request through `$request->selection()` in PHP, `request.selection()` in Node and Python, so that the handlers do not read it again. Build the shell with `hyper-build-assets --api /_props` of `@polyspec/hyper-build`, so that it declares the data base path; the application fails to open otherwise.

| Request of a chosen page | Response |
|---|---|
| HTML `GET` of a page path | The shell, `Cache-Control: no-cache`, without a session or a loader |
| JSON request or action under `/_props` | JSON and actions as in the server form, with `Location` under `/_props` |
| HTML request under `/_props`, JSON request outside it | 406 |

A request that the selection does not choose is answered as in the server form. The shell response carries `frame-ancestors` (HY-45) and is reported to the response hook (HY-60). The browser gives the `html` element the attributes of the rendered layout, such as its `lang` (HYC-6).

## Server settings

- Set `display_errors=Off` in the PHP configuration (`php.ini`, PHP-FPM pool, or `php -d display_errors=0`). PHP writes startup warnings, such as an exceeded `max_input_vars`, before the application runs. An exception inside the application answers 500 without details and is logged (HY-43).
- Set `post_max_size` to the body limit of the application or more (8 MiB, PHP's default `8M`, by default), and set `enable_post_data_reading=Off` when the application accepts `multipart/form-data`; `App::run` fails otherwise (HY-59).
- The session cookie is `__Host-hy-session` on HTTPS and `hy-session` otherwise, with `Path=/`, no `Domain`, `HttpOnly`, `SameSite=Lax`, and `Secure` on HTTPS (HY-45). Behind a CDN that terminates TLS, PHP receives plain HTTP: open the application with `https: true` (the example reads `BOARD_HTTPS=1`) so that the cookie keeps its `__Host-` name and stays `Secure`.
- A page carries a masked CSRF token of its visitor (HY-24), so `Cache-Control` of a page must keep it out of shared caches (HY-52), and a sign-in or sign-out action calls `renewSession()` of its reply (HY-72).
- Every response carries `Content-Security-Policy: frame-ancestors 'self'` (HY-45). `App::open(frameAncestors: ...)` changes the sources; the example reads `BOARD_FRAME_ANCESTORS`. A static shell on S3 needs the same header from a CloudFront response headers policy, because `frame-ancestors` has no effect in a `<meta>` policy.

## Local reproduction

`make serve-demo` runs both forms on one database. Its ports are fixed so that the addresses stay the same, so one demo runs at a time on a machine: the demo holds the lock file `/tmp/hyper-serve-demo.lock`, which names the checkout, the process ID and the start time of the demo, and a second demo fails with that holder. The demo releases the lock when it stops (Ctrl+C or SIGTERM). A lock whose demo process has ended is reported with that holder and stays; `make serve-demo-unlock` removes it and fails while the demo runs.

| URL | Role |
|---|---|
| `http://127.0.0.1:8080/board` | Server form: PHP at the root |
| `http://127.0.0.1:8082/api/board` | PHP with `BOARD_BASE_PATH=/api` |
| `http://127.0.0.1:8081/board` | Static shell: `scripts/serve-edge.mts` returns files of `build/csr/`, the shell for every other path, and forwards `/api/*` to port 8082 |
| `http://127.0.0.1:8081/compare?ssr=http://127.0.0.1:8080` | The comparison page: both forms in two frames and the result of comparing their bodies. It is a development tool and is not part of a deployment. |

## Sessions shared by the servers

The PHP, Node and Python servers share sessions in one directory (HY-104) or in one Redis server (HY-115); every server of a deployment uses the same one.

For a directory, the PHP server sets `session.save_path` to the directory, on a file system whose `flock` reaches every server that shares it. The Node and Python servers take the directory in `FileSessions`. The Node server calls `flock` through `node:ffi`, an experimental module of Node that prints one warning; a process started with `--permission` needs `--allow-ffi`.

For Redis, the PHP server loads phpredis 6.3.0 and sets:

```ini
session.save_handler = redis
session.save_path = "tcp://redis:6379?persistent=1"
redis.session.locking_enabled = 1
redis.session.lock_expire = 30
redis.session.lock_retries = 100
redis.session.lock_wait_time = 20000
```

`persistent=1` keeps one connection in each PHP process. Without it each request opens a TCP connection, and the closed connections hold the ports of the client in TIME_WAIT: at a sustained rate the machine runs out of them and requests fail with `Redis connection not available`.

The Node and Python servers give `RedisSessions` the command function of a client (Python `redis.Redis(...).execute_command` with `decode_responses=False`) and the same values: `lockExpire` 30, `lockRetries` 100 and `lockWait` 20 milliseconds (Python `lock_expire`, `lock_retries`, `lock_wait` 0.02 seconds). `lock_expire` must be longer than any request, and without it a process that ended holds its lock until `max_execution_time`, or for ever when that is 0. A request that waits longer than the retries allow fails, so raise them for requests of one session that hold the lock long. A client that queues commands while its connection is down holds requests until it reconnects, so a Node server creates node-redis with `disableOfflineQueue: true` and an `error` listener, and a Python server sets `socket_timeout` on `redis.Redis`; the request then answers status 500 until the Redis server is back. Keep the sessions with the append-only file when a restart must not end them. The values of a shared session are values of the template data model; a record that holds an object of a class other than `stdClass` fails the request in the Node and Python servers.

### A primary with replicas and Sentinel

Redis Sentinel names the primary and promotes a replica when the primary fails. The session handler of phpredis does not know Sentinel, so the PHP server passes `RedisSentinelSessions` as `sessionSetup` of `App::open`: just before a request starts its session it asks the Sentinels one after another and sets `session.save_path` to the primary, and phpredis keeps its locks. A request without a session asks nothing. Do not wrap phpredis with `session_set_save_handler` and `SessionHandler`: PHP then has no `validate_sid` and `session.use_strict_mode` accepts an identifier that nobody created. The `session.save_handler` and `redis.session.*` settings above stay.

```php
App::open(
    // ...
    sessionSetup: (new RedisSentinelSessions(
        [['host' => 'sentinel-1', 'port' => 26379], ['host' => 'sentinel-2', 'port' => 26379], ['host' => 'sentinel-3', 'port' => 26379]],
        'hyper',
        '?persistent=1',
    ))(...),
);
```

The Node and Python servers give `RedisSessions` the command function of a Sentinel client:

```ts
const sentinel = await createSentinel({
  name: 'hyper',
  sentinelRootNodes: [{ host: 'sentinel-1', port: 26379 }, { host: 'sentinel-2', port: 26379 }, { host: 'sentinel-3', port: 26379 }],
  nodeClientOptions: { disableOfflineQueue: true },
}).on('error', report).connect();
const bytes = sentinel.withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer });
new RedisSessions({ command: (words) => bytes.sendCommand(false, words.map((word) => Buffer.from(word))) });
```

```python
sentinel = Sentinel(
    [("sentinel-1", 26379), ("sentinel-2", 26379), ("sentinel-3", 26379)],
    socket_timeout=1,
    socket_connect_timeout=1,
)
RedisSessions(sentinel.master_for("hyper").execute_command)
```

A request answers status 500 from the failure of the primary until the Sentinels have promoted a replica, and the session goes on after it. A request fails when no Sentinel names the primary. Use at least three Sentinels on separate failure domains.

Replication is asynchronous, so a failover loses what the primary acknowledged and the replica had not received: such a session returns to an earlier record or, when it was new, is gone and the next request starts a new one. A lock can be lost the same way: the next request can then start while the holder still runs, and the holder writes nothing, because its lock no longer matches. `min-replicas-to-write` and `min-replicas-max-lag` of Redis make the primary refuse writes while no replica is current, which narrows the loss and answers status 500 instead; hyper does not test them. `tests/scripts/session-redis-failover.test.mts` kills the primary under the three servers and checks that what the replica acknowledged with `WAIT` survives.

### TLS and an ACL user

A connection that takes TLS and an ACL user sets these parameters. The certificate authority verifies the server; the address that the certificate names must be the address the client connects to.

```ini
session.save_path = "tls://redis:6379?persistent=1&auth[]=hyper&auth[]=secret&stream[cafile]=/etc/redis/ca.pem"
```

```ts
createClient({ socket: { host: 'redis', port: 6379, tls: true, ca: readFileSync('/etc/redis/ca.pem') }, username: 'hyper', password: 'secret', disableOfflineQueue: true });
```

```python
redis.Redis(
    host="redis",
    port=6379,
    ssl=True,
    ssl_ca_certs="/etc/redis/ca.pem",
    username="hyper",
    password="secret",
    socket_timeout=1,
)
```

With Sentinel, each Sentinel takes the same security, so every client states it for both the Sentinels and the primary. The PHP server gives each entry `'auth' => ['hyper', 'secret'], 'ssl' => ['cafile' => '/etc/redis/ca.pem']`, and the parameters and scheme of the primary as the arguments of `RedisSentinelSessions` after the name: `'?persistent=1&auth[]=hyper&auth[]=secret&stream[cafile]=/etc/redis/ca.pem', 'tls'`. The Node server gives `{ socket: { tls: true, ca }, username, password }` as `sentinelClientOptions` and in `nodeClientOptions`. The Python server gives `ssl=True, ssl_ca_certs=..., username=..., password=...` to `Sentinel` and again in `sentinel_kwargs`. The capacity of one Redis server is in [the benchmark](benchmark.md).
