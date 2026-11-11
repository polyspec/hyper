<!-- doc-id: deployment -->
# Deployment

[한국어](deployment.ko.md).

One application deploys in two forms. Both use the same manifest, templates, client bundle and handlers, on the PHP, Node.js and Python server alike.

| Form | First document | Later navigation | Use |
|---|---|---|---|
| Server and CDN (recommended) | The server renders it (SSR) | JSON, rendered by the browser | Every application whose server can render HTML |
| Static shell | The browser renders it from `/api` JSON (CSR) | JSON, rendered by the browser | A backend that serves JSON only |

## Server and CDN (recommended)

The server tells the two kinds of requests apart by their headers (HY-15). A direct request (the address bar, a reload, a bookmark, a search crawler or a link preview bot) has no `HX-Request` and receives the complete document. A request from htmx inside a page carries `Accept: application/vnd.hyper+json` and `HX-Request` and receives JSON, which the browser renders. Search engines and link previews therefore always receive complete documents with their titles.

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
- Set `post_max_size` to the body limit of the application or more (8 MiB, PHP's default `8M`, by default), and set `enable_post_data_reading=Off` when the application accepts `multipart/form-data`; `App::run` fails otherwise (HY-59). [Uploads](#uploads) states the limits and the settings of a body with files.
- The session cookie is `__Host-hy-session` on HTTPS and `hy-session` otherwise, with `Path=/`, no `Domain`, `HttpOnly`, `SameSite=Lax`, and `Secure` on HTTPS (HY-45). Behind a CDN that terminates TLS, PHP receives plain HTTP: open the application with `https: true` (the example reads `BOARD_HTTPS=1`) so that the cookie keeps its `__Host-` name and stays `Secure`.
- A page carries a masked CSRF token of its visitor (HY-24), so `Cache-Control` of a page must keep it out of shared caches (HY-52), and a sign-in or sign-out action calls `renewSession()` of its reply (HY-72).
- Every response carries `Content-Security-Policy: frame-ancestors 'self'` (HY-45). `App::open(frameAncestors: ...)` changes the sources; the example reads `BOARD_FRAME_ANCESTORS`. A static shell on S3 needs the same header from a CloudFront response headers policy, because `frame-ancestors` has no effect in a `<meta>` policy.

## Uploads

A server reads a `multipart/form-data` body in chunks into files of the request and holds neither the body nor a file as one value (HY-131). This section states what an operator sets for it.

- **Limits.** An application declares four limits, and a body that passes one receives status 413 while it is read:

  | Limit | Option (PHP and Node, Python) | Default | Bounds |
  |---|---|---|---|
  | body limit | `bodyLimit`, `body_limit` | 8 MiB | every byte of a request body (HY-59) |
  | file limit | `fileLimit`, `file_limit` | the smaller of 8 MiB and the body limit | the bytes of one file (HY-114) |
  | value limit | `valueLimit`, `value_limit` | the smaller of 8 MiB and the body limit | a body that is one value, and the names and contents of the text values of a multipart body together (HY-131) |
  | part limit | `partLimit`, `part_limit` | 1000 | the parts of a multipart body, also those that are neither a value nor a file (HY-131) |

  The header lines of one part are at most 8192 bytes (HY-113.16); this limit is fixed. An application that accepts large files raises the body limit and the file limit; the memory of a request does not grow with them. An application whose forms hold more than 1000 parts raises the part limit: a form of 2701 parts receives 413 with the default.
- **The server in front.** hyper sets no time limit (HY-131.19). The server in front of the application bounds a slow client and the size of a request before the application reads it: `client_max_body_size`, `client_body_timeout` and the connection limits of nginx, `request_terminate_timeout` of PHP-FPM, `requestTimeout` and `headersTimeout` of the Node HTTP server, and the timeouts of the WSGI or ASGI server. Set the size limit of the server in front to the body limit of the application or more, or that server answers before the application does.
- **PHP settings.** With `enable_post_data_reading=Off` PHP does not read the body itself, so `upload_max_filesize`, `max_file_uploads`, `max_input_vars`, `max_multipart_body_parts` and `upload_tmp_dir` of its own reader bound nothing, and `$_POST`, `$_FILES`, `is_uploaded_file()` and `move_uploaded_file()` hold nothing: the four limits above and `moveTo()` of `UploadedFile` take their place. `post_max_size` still applies. PHP keeps what `php://input` gave in a temporary file of its own in `sys_temp_dir`, so a request uses about twice its body on that disk until it ends.
- **The temporary directory.** Each request with a multipart body has a directory `hyper-…` below the temporary directory of the system (`sys_temp_dir` of PHP, `TMPDIR` of Node and Python), which only the user of the server reads. The server removes it after the response hook, the write hook and the disconnect hook of the request returned, also when the request failed. A file that the application moved with `moveTo()` is not removed; `moveTo()` renames the file, or copies it to another file system, so a target on the file system of the temporary directory costs no copy. A server that is killed while it answers leaves the directory of that request: remove the `hyper-*` directories of the temporary directory when the server starts.
- **What a request uses.** `make bench-uploads` measures it, and [Benchmark](benchmark.md#uploads) holds the method and the numbers of one run: a body of 1 GiB used 13 MiB in a PHP-FPM worker, 36 MiB in the Python `http.server` server and 152 MiB in the Node server, and a body of 98 MiB used the same; the reader of PHP itself used 6 MiB and less processor time than the PHP server of hyper. A PHP script cannot reach that, because PHP writes the body to its temporary file before a script reads it.

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

A persistent connection lasts as long as its PHP process, and phpredis 6.3.0 reuses it by scheme, host and port. It sends AUTH again on each reuse, so a wrong password fails, but it verifies the TLS certificate only when the connection opens. A changed CA or another stream option therefore applies only to new connections, so reload php-fpm after such a change, as a Node or Python server restarts for its configuration. A running worker does not detect a wrong CA: the failure appears when it opens a new connection. Check a change of CA after the reload.

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
primary = sentinel.master_for("hyper")
RedisSessions(primary.execute_command, setup=primary.connection_pool.get_master_address)
```

A connection of redis-py asks Sentinel only when it connects, so a pooled connection stays on the former primary, which accepts writes for some seconds after a promotion. `setup` asks Sentinel before the first command of each request that has a session and closes the idle connections when the answer changes, as `RedisSentinelSessions` does for the PHP server, and a request without a session asks nothing. Without `setup`, processes that use the former primary and processes that use the new one split a session until the former primary becomes a replica.

A request answers status 500 from the failure of the primary until the Sentinels have promoted a replica, and the session goes on after it. A request fails when no Sentinel names the primary. Use at least three Sentinels on separate failure domains.

Replication is asynchronous, so a failover loses what the primary acknowledged and the replica had not received: such a session returns to an earlier record or, when it was new, is gone and the next request starts a new one. A request that started on the former primary before the promotion can write there, and that write is lost in the same way. A lock can be lost the same way: the next request can then start while the holder still runs, and the holder writes nothing, because its lock no longer matches. `min-replicas-to-write` and `min-replicas-max-lag` of Redis make the primary refuse writes while no replica is current, which narrows the loss and answers status 500 instead; hyper does not test them. `tests/scripts/session-redis-failover.test.mts` kills the primary under the three servers and checks that what the replica acknowledged with `WAIT` survives, and promotes the replica while the primary runs and checks that the servers share a new session while the former primary still accepts writes.

### Redis Cluster

The `rediscluster` session handler of phpredis 6.3.0 takes no lock, so concurrent requests of one session lose updates. The PHP server does not use it: it passes `RedisClusterSessions` as `sessionSetup` of `App::open`, which speaks the protocol of HY-115 through `RedisCluster` of phpredis, and sets no `session.save_handler`, `session.save_path` or `redis.session.*`.

```php
App::open(
    // ...
    sessionSetup: (new RedisClusterSessions(['redis-1:6379', 'redis-2:6379', 'redis-3:6379']))(...),
);
```

The arguments after the seeds are `lockExpire` 30, `lockRetries` 100, `lockWait` 20000 microseconds, `timeout` 1.0 and, with TLS and an ACL user, `auth` and `context`: seeds such as `tls://redis-1:6379`, `['hyper', 'secret']` and `['cafile' => '/etc/redis/ca.pem']`. Connections are persistent.

The Node and Python servers give `RedisSessions` the command function of a cluster client. Every command of the protocol has one key, so no hash tag is needed, and the session and its lock can live on different primaries. node-redis routes by the key that its first argument names:

```ts
const cluster = await createCluster({
  rootNodes: [{ url: 'redis://redis-1:6379' }, { url: 'redis://redis-2:6379' }, { url: 'redis://redis-3:6379' }],
  defaults: { disableOfflineQueue: true },
}).on('error', report).connect();
const bytes = cluster.withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer });
new RedisSessions({
  command: (words) => {
    const args = words.map((word) => Buffer.from(word));
    return bytes.sendCommand(args[words[0] === 'EVAL' ? 3 : 1], false, args);
  },
});
```

```python
cluster = RedisCluster(
    startup_nodes=[
        ClusterNode("redis-1", 6379),
        ClusterNode("redis-2", 6379),
        ClusterNode("redis-3", 6379),
    ],
    socket_timeout=1,
    socket_connect_timeout=1,
)
RedisSessions(cluster.execute_command)
```

With TLS and an ACL user the Node server gives `{ socket: { tls: true, ca }, username, password }` in `defaults`, and the Python server `ssl=True, ssl_ca_certs=..., username=..., password=...`. A slot that moves keeps the requests working through the redirections of the clients. A replica that takes over keeps what it had received, and what it had not received is lost, as with Sentinel. `tests/scripts/session-redis-cluster.test.mts` checks them on a real cluster of three primaries.

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
