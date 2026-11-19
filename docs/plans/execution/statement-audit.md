<!-- doc-id: plan-statement-audit -->
# Statement audit

[한국어](statement-audit.ko.md).

This document records row H35.43 of the [execution checklist](checklist.md). It compares each live statement of HY-60, HY-100, HY-104, HY-113, HY-114, HY-115, HY-131 and HY-133 of `contracts/protocol.json` with the server code. It gives each statement a verdict of true, false or partly true, and names the place in the code that decides it. The browser rules HYC are compared after the first release.

## Summary

| Group | Statements | True | Partly true | False |
| --- | --- | --- | --- | --- |
| HY-60 | 32 | 32 | 0 | 0 |
| HY-100 | 36 | 36 | 0 | 0 |
| HY-104 | 30 | 22 | 6 | 2 |
| HY-113 | 6 | 3 | 2 | 1 |
| HY-114 | 8 | 8 | 0 | 0 |
| HY-115 | 21 | 19 | 2 | 0 |
| HY-131 | 13 | 10 | 1 | 2 |
| HY-133 | 13 | 13 | 0 | 0 |
| Total | 159 | 143 | 11 | 5 |

## Open statements

Seven statements were found not true without an `unimplemented` mark. Each one names its row, its new statement, or the ruling it waits for:

- HY-100.2: true. `App.handle` wraps the one method that each host calls with its store (see its row).
- HY-104.33: the code is corrected by H35.87: the PHP server sets `gc_probability` to 0, the Python store has a public `collect`, and the PHP server gets a public `collect`. H35.37, which holds the PHP file store, is withdrawn until after the first release, so the PHP `collect` is written in H35.87 and does not wait for that store. The verdict stays partly true until the runs of H35.87 pass.
- HY-115.11: retired. HY-115.30 states the order of each store, and it is true (see its row).
- HY-104.14: true on this tree, made true by H35.84: the PHP server refuses an object of another class (`packages/php/src/Session/NativeSession.php:177`), as Node and Python do (see its row).
- HY-104.31: true on this tree, made true by H35.85: every server accepts 22 to 256 characters (see its row).
- HY-104.37 is corrected by H35.82 and HY-115.23 by H35.83, rows of the checklist on the line of the session id limits. Each verdict stays as below until the runs of its row pass.

The statements that these rows correct:

- HY-104.37: the Node interface returns `undefined`, not null, for a key that holds no value (`packages/ts/src/session/session-store.ts:5`).

## Limits

A place in a library is written `<repository>@<tag>:<path>:<line>`, at the tag that hyper pins: session-store v0.0.7 (`Cargo.lock`, `packages/ts/package.json`, `packages/python/uv.lock`) and php-serialization v0.0.16 (`Cargo.lock`). The Rust and TypeScript sources of session-store v0.0.8 are the same as those of v0.0.7, so each session-store place holds for both tags. A place in PHP is written `php-src@php-8.4.27:<path>:<line>`. For PHP, the Redis lock order is compared with HY-115 in the section H35.86, which reads the `RedisClusterSessions` handler and the library; the phpredis session handler is not read there (see that section).

## HY-60

HY-60 states the response hook, the notes of the reply, the elapsed time on a monotonic clock, and the plain 500 that hyper writes for an error that escapes the answer of a request. Statement 28 is retired. No statement of the group has an `unimplemented` mark.

| Statement | Verdict | Code that decides it | Tests that cite it | Note |
| --- | --- | --- | --- | --- |
| HY-60.1 | true | `packages/ts/src/app/app.ts:110`, `packages/php/src/App/App.php:108`, `packages/python/src/polyspec/hyper/app/app.py:249` | none by this id | |
| HY-60.2 | true | `packages/ts/src/app/app.ts:473-497` and `:508-510`, `packages/php/src/App/App.php:413-440` and `:461-471`, `packages/python/src/polyspec/hyper/app/app.py:458-488` and `:498-515`; Node 400 and 431 at `packages/ts/src/host/http-host.ts:77-89` | `tests/scripts/upload-servers.test.mts` | Every answer of the application, including the answers before routing, passes the one report call at the end of `respond`; the answers before routing were not traced one by one. |
| HY-60.3 | true | `packages/ts/src/app/app.ts:509`, `packages/php/src/App/App.php:469`, `packages/python/src/polyspec/hyper/app/app.py:508-515` | none by this id | The hook receives the request that `respond` received. |
| HY-60.4 | true | `packages/ts/src/app/app.ts:494-495` and the cookie after it at `packages/ts/src/host/http-host.ts:166`; `packages/python/src/polyspec/hyper/host/_pipeline.py:223-242`; `packages/php/src/App/App.php:436-437` | none by this id | The report takes the framed response; the session cookie is added after `respond` returns. |
| HY-60.5 | true | `packages/php/src/Host/functions.php:14-17`, `packages/php/src/App/App.php:356-359` and `:1053`; `packages/ts/src/host/http-host.ts:101-102` | `packages/ts/tests/steps/app.ts`, `packages/python/tests/steps/app_steps.py` | |
| HY-60.6 | true | no `REQUEST_TIME_FLOAT`, `microtime` or wall clock in `packages/{ts,php,python}/src`; the clocks are `hrtime(true)`, `performance.now()` and `time.perf_counter_ns()` (`packages/php/src/App/App.php:469`, `packages/ts/src/app/app.ts:509`, `packages/python/src/polyspec/hyper/app/app.py:512`) | none by this id | |
| HY-60.7 | true | `packages/ts/src/host/http-host.ts:77-89`, `requestLine` at `:218-222` | `packages/ts/tests/http.test.ts`, `tests/scripts/upload-servers.test.mts` | |
| HY-60.8 | true | `packages/ts/src/app/app.ts:473-497`, `packages/php/src/App/App.php:402-407`, `packages/python/src/polyspec/hyper/app/app.py:465-487`; new empty reply in the Node client error at `packages/ts/src/host/http-host.ts:85` | `tests/scripts/upload-servers.test.mts` | The reply is created before dispatch and reported also after a failure. |
| HY-60.9 | true | `packages/ts/src/http/reply.ts:18-23`, `packages/php/src/Http/Reply.php:33-43`, `packages/python/src/polyspec/hyper/http/reply.py:30-38` | none by this id | A map or dict keeps the position of the first note of a name. |
| HY-60.10 | true | the notes are read only by `notes()` (`packages/ts/src/http/reply.ts:27-29`); no write path of the response reads them | none by this id | |
| HY-60.11 | true | `packages/ts/src/app/app.ts:476-492`, `packages/php/src/App/App.php:420-434`, `packages/python/src/polyspec/hyper/app/app.py:467-484` | `tests/scripts/upload-servers.test.mts` | |
| HY-60.12 | true | `packages/ts/src/host/http-host.ts:135-139` | `tests/scripts/upload-servers.test.mts` | A public file returns before `respond`. |
| HY-60.13 | true | the report call is outside the `try` of `respond`: `packages/ts/src/app/app.ts:495`, `packages/php/src/App/App.php:437`, `packages/python/src/polyspec/hyper/app/app.py:487` | `tests/scripts/upload-servers.test.mts` | |
| HY-60.14 | true | `packages/ts/src/host/http-host.ts:180-195`, `packages/php/src/App/App.php:1084-1094` and `:517-534`, `packages/python/src/polyspec/hyper/host/_pipeline.py:189-199`, `packages/python/src/polyspec/hyper/host/asgi.py:61-107`, session open at `packages/ts/src/app/app.ts:484` | `packages/php/tests/RunTest.php`, `packages/python/tests/test_asgi.py`, `packages/python/tests/test_wsgi.py`, `packages/ts/tests/http.test.ts`, `tests/scripts/upload-servers.test.mts` | |
| HY-60.15 | true | `packages/ts/src/host/http-host.ts:183-195`, `packages/php/src/App/App.php:525-532`, `packages/python/src/polyspec/hyper/host/_pipeline.py:189-199` | `tests/scripts/upload-servers.test.mts` | `frame` adds the frame policy and `no-store`. |
| HY-60.16 | true | the escape paths call no `report`: `packages/ts/src/host/http-host.ts:180-195`, `packages/php/src/App/App.php:517-534`, `packages/python/src/polyspec/hyper/host/_pipeline.py:189-199` | `tests/scripts/upload-servers.test.mts` | |
| HY-60.17 | true | `packages/ts/src/host/http-host.ts:197-202`, `packages/php/src/App/App.php:1110-1117`, `packages/python/src/polyspec/hyper/host/_exchange.py:30-47` | `packages/php/tests/RunTest.php`, `packages/python/tests/test_asgi.py`, `packages/python/tests/test_wsgi.py`, `packages/ts/tests/http.test.ts`, `tests/scripts/upload-servers.test.mts` | `Exchange.report` and the single `finally` call each write hook once. |
| HY-60.18 | true | `packages/ts/src/host/http-host.ts:134` with `bodySize` at `packages/ts/src/http/request.ts:303-306`; `packages/python/src/polyspec/hyper/host/_pipeline.py:159-181`; `packages/php/src/App/App.php:1099-1107` | `packages/php/tests/RunTest.php` | |
| HY-60.19 | true | `packages/python/src/polyspec/hyper/host/wsgi.py:197-206`, `packages/python/src/polyspec/hyper/host/asgi.py:230-239`, `packages/python/src/polyspec/hyper/host/_exchange.py:40`; Node at `packages/ts/src/host/http-host.ts:128-129` and `:197` | none by this id | |
| HY-60.20 | true | `packages/ts/src/host/http-host.ts:183-186`, `packages/php/src/App/App.php:519-524`, `packages/python/src/polyspec/hyper/host/server.py:187-204` | none by this id | |
| HY-60.21 | true | `packages/ts/src/host/http-host.ts:183-195`, `packages/python/src/polyspec/hyper/host/server.py:187-204`, `packages/python/src/polyspec/hyper/host/asgi.py:102-107` | `packages/python/tests/test_asgi.py` | PHP does not close the connection, as HY-60.33 states. |
| HY-60.22 | true | `packages/python/src/polyspec/hyper/host/wsgi.py:61-66` and `:110-132`, `packages/python/src/polyspec/hyper/host/asgi.py:61-67` and `:85-90` | none by this id | |
| HY-60.23 | true | `packages/php/src/App/App.php:29`, `:1084-1094` and `:519-524` | none by this id | |
| HY-60.24 | true | `packages/php/src/App/App.php:1052` and `:532`, `packages/ts/src/host/http-host.ts:318-322` | `tests/scripts/upload-servers.test.mts` | |
| HY-60.25 | true | `packages/php/src/App/App.php:1052`, `packages/php/src/Http/Response.php:71-80` | `tests/scripts/upload-servers.test.mts` | |
| HY-60.26 | true | `packages/ts/src/host/http-host.ts:318-322` | none by this id | `writeHead` merges the headers that `setHeader` set before. |
| HY-60.27 | true | `packages/python/src/polyspec/hyper/host/wsgi.py:110-132`, `packages/python/src/polyspec/hyper/host/asgi.py:85-98` | `tests/scripts/upload-servers.test.mts` | |
| HY-60.29 | true | `packages/ts/src/http/reply.ts:27-29`, `packages/php/src/Http/Reply.php:51-60`, `packages/python/src/polyspec/hyper/http/reply.py:40-42` | none by this id | PHP casts an integer key back to a string. |
| HY-60.30 | true | `packages/python/src/polyspec/hyper/host/server.py:187-204` with `packages/python/src/polyspec/hyper/host/_pipeline.py:197-199` | none by this id | |
| HY-60.31 | true | `packages/ts/src/app/app.ts:462`, `packages/php/src/App/App.php:356-359`, `packages/python/src/polyspec/hyper/app/app.py:449-464` | none by this id | |
| HY-60.32 | true | `packages/ts/src/http/reply.ts:21`, `packages/php/src/Http/Reply.php:37-39`, `packages/python/src/polyspec/hyper/http/reply.py:33-36` | `packages/rust/interface.json` names it; no test | |
| HY-60.33 | true | `packages/php/src/App/App.php:520-524` and `:1114-1115` | none by this id | |

## HY-100

HY-100 states how each server is served through the standard host interface of its runtime: the PHP front controller `run`, the Python callables `create_wsgi` and `create_asgi` and the server `create_server`, and the Node listener `listener`. No statement of the group has an `unimplemented` mark.

| Statement | Verdict | Code that decides it | Tests that cite it | Note |
| --- | --- | --- | --- | --- |
| HY-100.1 | true | `packages/php/src/Host/functions.php:14`, `packages/python/src/polyspec/hyper/host/wsgi.py:38`, `packages/python/src/polyspec/hyper/host/asgi.py:36`, `packages/ts/src/host/http-host.ts:60`, `packages/ts/src/host/http-host.ts:67` | none by the exact id; `packages/php/tests/RunTest.php:17`, `packages/ts/tests/http.test.ts:17` cite HY-100 | |
| HY-100.2 | true | `packages/ts/src/app/app.ts:462`, `packages/ts/src/app/app.ts:464`, `packages/ts/src/host/http-host.ts:128`, `packages/ts/src/host/http-host.ts:143`, `packages/ts/src/host/http-host.ts:158`, `packages/python/src/polyspec/hyper/app/app.py:449`, `packages/python/src/polyspec/hyper/app/app.py:457`, `packages/python/src/polyspec/hyper/host/_pipeline.py:223`, `packages/php/src/App/App.php:356`, `packages/php/src/App/App.php:359`, `packages/php/src/App/App.php:1133`, `packages/php/src/Http/Request.php:532` | `packages/php/tests/RequestTest.php:55`, `packages/ts/tests/http.test.ts:190`, `tests/scripts/upload-servers.test.mts:580`, `tests/scripts/upload-servers.test.mts:746`, `tests/scripts/upload-servers.test.mts:757` | `App.handle` is a wrapper over the one method that answers a request: Node `handle` calls `respond`, Python `handle` returns `_respond`, and PHP `handle` calls `through`. Each host calls that same method with its store, so the session is opened and the hooks are run in one place that `App.handle` also reaches. The other clauses (body limit, cookie of a new session first, hooks, plain 500 for a missing target) hold. |
| HY-100.3 | true | `packages/python/src/polyspec/hyper/host/wsgi.py:38` | none by the exact id; `packages/python/tests/test_wsgi.py:1` cites HY-100 | |
| HY-100.4 | true | `packages/python/src/polyspec/hyper/host/wsgi.py:160`, `packages/python/src/polyspec/hyper/host/wsgi.py:173`, `packages/python/src/polyspec/hyper/host/_pipeline.py:114`, `packages/python/src/polyspec/hyper/host/_pipeline.py:231` | `tests/scripts/upload-servers.test.mts:786` | A body over the limit by its Content-Length is not read; bytes past the limit of a read body are read and discarded, not held (`_pipeline.py:114`). |
| HY-100.5 | true | `packages/python/src/polyspec/hyper/host/wsgi.py:105` | none | A 204 or 304 response gets no Content-Length (`wsgi.py:100`). |
| HY-100.37 | true | `packages/python/src/polyspec/hyper/host/_wsgi_body.py:35`, `packages/python/src/polyspec/hyper/host/_wsgi_body.py:44`, `packages/python/src/polyspec/hyper/host/_exchange.py:59` | none by the exact id | The write counts as ended only when the iterator is advanced past its last chunk (`_wsgi_body.py:37`). |
| HY-100.34 | true | `packages/python/src/polyspec/hyper/host/_wsgi_body.py:39` | `packages/python/tests/test_wsgi.py:528`, `packages/python/tests/test_wsgi.py:600`, `packages/python/tests/test_wsgi.py:615` | |
| HY-100.35 | true | `packages/python/src/polyspec/hyper/host/_wsgi_body.py:40` | `packages/python/tests/test_wsgi.py:600`, `packages/python/tests/test_wsgi.py:615` | |
| HY-100.36 | true | `packages/python/src/polyspec/hyper/host/wsgi.py:124` | `packages/python/tests/test_wsgi.py:552` | |
| HY-100.7 | true | `packages/python/src/polyspec/hyper/host/wsgi.py:67`, `packages/python/src/polyspec/hyper/host/wsgi.py:80` | none | A file response is a plain list, so no `close()` reports it. |
| HY-100.8 | true | `packages/python/src/polyspec/hyper/host/_pipeline.py:252`, `packages/python/src/polyspec/hyper/host/wsgi.py:65`, `packages/python/src/polyspec/hyper/host/wsgi.py:110` | none | |
| HY-100.9 | true | `packages/python/src/polyspec/hyper/host/wsgi.py:76`, `packages/python/src/polyspec/hyper/host/wsgi.py:83`, `packages/python/src/polyspec/hyper/host/wsgi.py:89`, `packages/python/src/polyspec/hyper/host/wsgi.py:125` | `packages/python/tests/test_wsgi.py:450` | |
| HY-100.10 | true | `packages/python/src/polyspec/hyper/host/wsgi.py:197` | none | |
| HY-100.11 | true | `packages/python/src/polyspec/hyper/host/wsgi.py:201` | none by the exact id; `packages/python/tests/test_request_target.py:1` cites HY-100 | |
| HY-100.12 | true | `packages/python/src/polyspec/hyper/host/wsgi.py:178`, `packages/python/src/polyspec/hyper/http/request.py:290`, `packages/python/src/polyspec/hyper/http/request.py:300`, `packages/python/src/polyspec/hyper/host/server.py:145` | none | The split is the one of `create_server`, which also ends the path at `#` and removes the authority of an absolute-form target (HY-42). |
| HY-100.13 | true | `packages/python/src/polyspec/hyper/host/wsgi.py:197` | none | No code of `wsgi.py` reads `PATH_INFO`. |
| HY-100.14 | true | `packages/python/src/polyspec/hyper/host/wsgi.py:204`, `packages/python/src/polyspec/hyper/host/wsgi.py:65`, `packages/python/src/polyspec/hyper/host/_pipeline.py:189` | none | The log line is the message of the RuntimeError, which names both keys. |
| HY-100.15 | true | `packages/python/src/polyspec/hyper/host/asgi.py:36` | none by the exact id; `packages/python/tests/test_asgi.py:1` cites HY-100 | |
| HY-100.16 | true | `packages/python/src/polyspec/hyper/host/asgi.py:169`, `packages/python/src/polyspec/hyper/host/asgi.py:210`, `packages/python/src/polyspec/hyper/host/_pipeline.py:231` | none | The receive events are read to their end; bytes past the limit are discarded, not held. |
| HY-100.17 | true | `packages/python/src/polyspec/hyper/host/asgi.py:204` | none | |
| HY-100.38 | true | `packages/python/src/polyspec/hyper/host/asgi.py:91`, `packages/python/src/polyspec/hyper/host/asgi.py:102`, `packages/python/src/polyspec/hyper/host/asgi.py:118` | none | A send that raises an error other than `OSError` reports the write as failed without the disconnect hook (`asgi.py:108`). |
| HY-100.19 | true | `packages/python/src/polyspec/hyper/host/asgi.py:68`, `packages/python/src/polyspec/hyper/host/asgi.py:114` | none | |
| HY-100.20 | true | `packages/python/src/polyspec/hyper/host/asgi.py:210` | none | `_read_body` stops at the first event that is not `http.request` and no code waits for `http.disconnect`. |
| HY-100.21 | true | `packages/python/src/polyspec/hyper/host/asgi.py:72` | none | |
| HY-100.22 | true | `packages/python/src/polyspec/hyper/host/asgi.py:1`, `packages/python/src/polyspec/hyper/host/wsgi.py:1` | none | Neither module imports a server. |
| HY-100.23 | true | `packages/python/src/polyspec/hyper/host/asgi.py:230`, `packages/python/src/polyspec/hyper/host/asgi.py:193` | none | |
| HY-100.24 | true | `packages/python/src/polyspec/hyper/host/asgi.py:159` | `packages/python/tests/test_asgi.py:401` | |
| HY-100.25 | true | `packages/python/src/polyspec/hyper/host/asgi.py:230` | none | No code of `asgi.py` reads `scope['path']`. |
| HY-100.26 | true | `packages/python/src/polyspec/hyper/host/asgi.py:235`, `packages/python/src/polyspec/hyper/host/asgi.py:65` | none | |
| HY-100.39 | true | `packages/python/src/polyspec/hyper/host/_exchange.py:40`, `packages/python/src/polyspec/hyper/host/_exchange.py:61` | none | `exchange.request` is None, so `report` calls no hook and `disconnect` has no answer. |
| HY-100.28 | true | `packages/ts/src/host/http-host.ts:67`, `packages/ts/src/host/http-host.ts:76` | `packages/ts/tests/http.test.ts:178` | |
| HY-100.29 | true | `packages/ts/src/host/http-host.ts:200` | none | |
| HY-100.30 | true | `packages/php/src/Host/functions.php:14`, `packages/php/src/App/App.php:1080`, `packages/php/src/App/App.php:1084`, `packages/php/src/App/App.php:1087`, `packages/php/src/App/App.php:1112`, `packages/php/src/App/App.php:1119` | `tests/scripts/upload-servers.test.mts:655` | |
| HY-100.31 | true | `packages/ts/src/host/http-host.ts:248`, `packages/ts/src/host/http-host.ts:83`, `packages/python/src/polyspec/hyper/host/wsgi.py:146`, `packages/python/src/polyspec/hyper/host/asgi.py:152` | `packages/php/tests/RequestTest.php:14`, `packages/python/tests/test_wsgi.py:172`, `packages/python/tests/test_asgi.py:167`, `tests/scripts/upload-servers.test.mts:811` | The 400 of a method that `node:http` refuses is written by the `clientError` handler. |
| HY-100.32 | true | `packages/ts/src/host/http-host.ts:87` | none | The 400 or 431 of a request that `node:http` cannot parse is written by hyper with `HTTP/1.1`, because no version was parsed. |
| HY-100.33 | true | no hyper code: the PHP built-in server decides it | none | A fact of the SAPI; no test of this repository cites it. |

## HY-104

HY-104 states how the three servers store, lock, share and convert a session, through the session-store library and the session rules of the core.

| Statement | Verdict | Code that decides it | Tests that cite it | Note |
| --- | --- | --- | --- | --- |
| HY-104.1 | true | `packages/ts/src/session/file-sessions.ts:18`, `packages/python/src/polyspec/hyper/session/file_sessions.py:1`, `packages/php/src/Session/NativeSession.php:128` | `tests/scripts/session-shared.test.mts` (by HY-104.28) | PHP shares the directory through its native files handler with `php_serialize`. |
| HY-104.2 | true | `packages/ts/src/session/file-sessions.ts:42` (library `FileSessions.inDirectory`), `packages/python/src/polyspec/hyper/session/file_sessions.py:29`, `packages/php/src/Session/NativeSession.php:128` | `tests/scripts/upload-servers.test.mts`, `tests/legacy/interfaces.json` | For Node and Python the library decides them: the prefix `sess_` (`session-store@v0.0.7:packages/file/rust/src/store.rs:25`), the mode 0600 (`:289`), the record read with php-serialization (`session-store@v0.0.7:packages/core/rust/src/record.rs:38`), and a record without bytes as an empty session (`record.rs:35`). For PHP the files handler of PHP decides them. |
| HY-104.3 | true | `packages/ts/src/host/http-host.ts:153`, `packages/ts/src/host/http-host.ts:160`, `packages/python/src/polyspec/hyper/host/_pipeline.py:219`, `packages/python/src/polyspec/hyper/host/_pipeline.py:226`, `packages/ts/src/app/app.ts:557` | none by exact id | The lock is held between `open` and `close` of the library; PHP holds the lock of its native handler. |
| HY-104.7 | true | `session-store@v0.0.7:packages/file/rust/src/store.rs:265`, `store.rs:268`, `store.rs:253`, called at `packages/ts/src/session/file-session.ts:73`; PHP files handler | `tests/legacy/interfaces.json` | The library writes the record at offset 0 and cuts the file to its length under the lock, and sets a new modification time for an unchanged session. PHP decides it for PHP. |
| HY-104.8 | true | `packages/ts/src/session/file-session.ts:23`, `packages/php/src/Session/NativeSession.php:54` | `tests/legacy/interfaces.json` | |
| HY-104.10 | true | `session-store@v0.0.7:packages/file/rust/src/store.rs:169`, called at `packages/ts/src/session/file-sessions.ts:59` | none | A missing file gives a request without a session; only a new identifier creates a file (`store.rs:259`). |
| HY-104.11 | true | `packages/ts/src/session/file-session.ts:65`, `packages/php/src/Session/NativeSession.php:256` | none | |
| HY-104.12 | true | `packages/ts/src/session/file-session.ts:71` | none | |
| HY-104.13 | true | `packages/rust/src/session.rs:91` | `packages/rust/tests/contracts.rs`, `packages/php/tests/Support/Steps/SessionSteps.php`, `packages/ts/tests/steps/session-requests.ts` | |
| HY-104.14 | true | `packages/rust/src/session.rs:242`, `packages/rust/src/session.rs:256` | `packages/rust/tests/contracts.rs`, `packages/rust/tests/rules.rs`, `tests/scripts/node-core.test.mts`, `packages/php/tests/NativeSessionTest.php::testAnObjectOfAnotherClassFailsWithKindRecord` | For Node and Python the write gives `O:8:"stdClass"` (`php-serialization@v0.0.16:packages/rust/src/write.rs:166`), and the read refuses any other class with the error `class` (`php-serialization@v0.0.16:packages/rust/src/read.rs:460`), which the library returns as a record error (`session-store@v0.0.7:packages/core/rust/src/record.rs:38`). The PHP server reads the stored value (`packages/php/src/Session/NativeSession.php:176`) and refuses an object of another class at any depth with `refuseClasses` (`:177`). |
| HY-104.34 | true | `packages/rust/src/session.rs:177`, `packages/rust/src/session.rs:192` | none by exact id | |
| HY-104.39 | true | `packages/rust/src/session.rs:194` (`value == 0.0` gives 0) | none | |
| HY-104.15 | true | `packages/ts/src/session/file-sessions.ts:63`, `packages/python/src/polyspec/hyper/session/file_sessions.py:37`, `session-store@v0.0.7:packages/file/rust/src/store.rs:218` | none | The removal takes the lock without waiting and skips the file when another holds it (`store.rs:220`). |
| HY-104.33 | partly true | `packages/ts/src/session/file-sessions.ts:65`, `packages/python/src/polyspec/hyper/session/file_sessions.py:37`, `packages/php/src/Session/NativeSession.php:115` | none | Node has a public `collect` (`file-sessions.ts:65`) and Python the public `collect` (`file_sessions.py:37`). The PHP options set `gc_probability` to 0 (`NativeSession.php:115`), and the PHP server has the public static `NativeSession::collect`; H35.87 holds that code, whose runs have not passed yet. |
| HY-104.28 | true | `tests/scripts/session-shared.test.mts` | itself | |
| HY-104.29 | true | `packages/ts/src/session/file-sessions.ts:22`, `packages/python/src/polyspec/hyper/session/file_sessions.py:7`, `session-store@v0.0.7:packages/file/rust/src/turns.rs:59`, `session-store@v0.0.7:packages/file/rust/src/store.rs:157`, `store.rs:172` | none | The library queues the request before the lock (`store.rs:157`), takes a cancelled request out of the queue (`turns.rs:58`), and drops the file, which releases the lock, when the request was cancelled while it waited for the lock (`store.rs:173`). |
| HY-104.31 | true | `packages/ts/src/session/record-session.ts:9`, `packages/ts/src/session/record-session.ts:80`, `packages/python/src/polyspec/hyper/session/_record_session.py:17`, `packages/python/src/polyspec/hyper/session/_record_session.py:76`, `packages/php/src/Session/NativeSession.php:40` | `tests/legacy/interfaces.json` | Every server accepts 22 to 256 characters before the store sees the cookie (`record-session.ts:9`, `_record_session.py:17`, `NativeSession.php:40`), as the library accepts 22 to 256 (`session-store@v0.0.7:packages/core/rust/src/identifier.rs:7`, `:8`, `:14`), and so does PHP (`php-src@php-8.4.27:ext/session/session.c:75`, `:791`, `:380`). The core of hyper has no identifier check. |
| HY-104.32 | partly true | `packages/ts/src/session/file-sessions.ts:38`, `packages/python/src/polyspec/hyper/session/file_sessions.py:24` | `packages/ts/tests/steps/file-sessions.ts`, `packages/rust/tests/cases/faults.json` | PHP has no file store class (`packages/php/src/App/App.php:1132` uses `NativeSession`). Marked H35.37 for php. |
| HY-104.20 | true | `packages/rust/src/session.rs:311` | `tests/legacy/interfaces.json` | |
| HY-104.21 | true | `session-store@v0.0.7:packages/file/rust/src/store.rs:43`, `store.rs:181`, `store.rs:224`; PHP `session.gc_maxlifetime` | none | An open of an ended file gives no session, and the removal removes only an ended file. PHP decides it for PHP. |
| HY-104.22 | true | `packages/ts/src/session/session.ts:9`, `packages/php/src/Session/Session.php:14`, `packages/rust/src/session.rs:17` | `packages/php/tests/CoreRulesTest.php`, `packages/python/tests/test_core_rules.py`, `tests/scripts/node-core.test.mts` | |
| HY-104.23 | true | `packages/rust/src/session.rs:424`, `packages/rust/src/session.rs:444` | `packages/rust/tests/contracts.rs`, `packages/rust/tests/rules.rs`, `packages/rust/tests/cases/faults.json` | |
| HY-104.36 | true | `packages/rust/src/error.rs:180`, `packages/rust/src/session.rs:424` | none by exact id | |
| HY-104.35 | true | `packages/ts/src/session/session.ts:75`, `packages/rust/src/session.rs:484` | none | |
| HY-104.37 | partly true | `packages/ts/src/session/session-store.ts:5` | `tests/scripts/upload-servers.test.mts` | The Node interface returns `undefined`, not null, for a key that holds no value. |
| HY-104.25 | partly true | `packages/ts/src/session/file-sessions.ts:3`, `packages/python/src/polyspec/hyper/session/file_sessions.py:15`, `packages/rust/src/session.rs:1` | none | PHP stores through `NativeSession`, not the store interface of the library. Marked H35.37 for php. |
| HY-104.26 | false | `packages/php/src/App/App.php:1132`, `packages/php/src/Session/NativeSession.php:55` | `tests/legacy/file-store-sessions.json` | PHP uses the native session handler. Marked H35.37 for php. |
| HY-104.27 | partly true | `packages/ts/src/session/file-sessions.ts:22`, `packages/python/src/polyspec/hyper/session/file_sessions.py:7` | none | PHP waits in `session_start`. Marked H35.37 for php. |
| HY-104.38 | partly true | `packages/ts/src/app/app.ts:572`, `packages/python/src/polyspec/hyper/app/app.py:610` | `packages/ts/tests/session-routes.test.ts`, `packages/python/tests/test_session_routes.py` | PHP reads no `session` member of a route. Marked H35.37 for php. |
| HY-104.40 | false | `packages/ts/src/host/http-host.ts:153`, `packages/python/src/polyspec/hyper/host/_pipeline.py:219` | none | The hosts open and close the session with the library themselves, not through members of the core. Marked H35.38-1. |

## HY-113

HY-113 states which parts of a `multipart/form-data` body are files and how the request gives them.

| Statement | Verdict | Code that decides it | Tests that cite it | Note |
| --- | --- | --- | --- | --- |
| HY-113.21 | true | `packages/ts/src/form/multipart.ts:106`, `packages/php/src/Form/Multipart.php:152`, `packages/python/src/polyspec/hyper/form/_multipart.py:101` | `tests/legacy/interfaces.json` | Only the parameter `filename` is read. |
| HY-113.23 | partly true | `packages/ts/src/form/multipart.ts:106`, `packages/php/src/Form/Multipart.php:152`, `packages/python/src/polyspec/hyper/form/_multipart.py:101` | none | The servers read parts with their own readers, not by F-23, F-6 and F-16 of http-form. Marked H35.11. |
| HY-113.24 | partly true | `packages/ts/src/form/request-body.ts:25`, `packages/ts/src/app/app.ts:778`, `packages/php/src/App/App.php:978`, `packages/python/src/polyspec/hyper/app/app.py:922` | none | A missing boundary starts no reader, but the server code treats `malformed_content_type` as no refusal (`app.ts:778` returns null). Marked H35.11. |
| HY-113.25 | false | none | none | No server code names the kinds `invalid` or `header_limit` of http-form. Marked H35.11. |
| HY-113.2 | true | `packages/ts/src/http/request.ts:284`, `packages/php/src/Http/Request.php:427`, `packages/python/src/polyspec/hyper/http/request.py:260` | `packages/ts/tests/steps/request.ts`, `packages/php/tests/Support/Steps/RequestSteps.php`, `packages/python/tests/steps/request_steps.py` | |
| HY-113.8 | true | `packages/ts/src/form/uploaded-file.ts:41`, `packages/php/src/Form/UploadedFile.php:48`, `packages/python/src/polyspec/hyper/form/uploaded_file.py:34`, `packages/ts/src/index.ts:10`, `packages/python/src/polyspec/hyper/__init__.py:25` | none by exact id | |

## HY-114

HY-114 bounds the bytes of one uploaded file with a file limit of the application.

| Statement | Verdict | Code that decides it | Tests that cite it | Note |
| --- | --- | --- | --- | --- |
| HY-114.1 | true | `packages/ts/src/app/app.ts:92`, `packages/php/src/App/App.php:140`, `packages/python/src/polyspec/hyper/app/app.py:245` | none | |
| HY-114.2 | true | `packages/ts/src/app/app.ts:262`, `packages/ts/src/app/app.ts:264`, `packages/php/src/App/App.php:138`, `packages/php/src/App/App.php:160`, `packages/python/src/polyspec/hyper/app/app.py:272` | none | |
| HY-114.3 | true | `packages/ts/src/app/app.ts:264`, `packages/php/src/App/App.php:160`, `packages/python/src/polyspec/hyper/app/app.py:271` | none | |
| HY-114.4 | true | `packages/ts/src/app/app.ts:264`, `packages/php/src/App/App.php:160`, `packages/python/src/polyspec/hyper/app/app.py:271` | none | The default is at most the body limit, so the check of HY-114.6 cannot fail for it. |
| HY-114.11 | true | `packages/ts/src/form/multipart.ts:140`, `packages/php/src/Form/Multipart.php:198`, `packages/python/src/polyspec/hyper/form/_multipart.py:142` | none | A file over the limit ends the read of the body; no part of it is passed. |
| HY-114.6 | true | `packages/ts/src/app/app.ts:265`, `packages/php/src/App/App.php:161`, `packages/python/src/polyspec/hyper/app/app.py:273` | none | |
| HY-114.7 | true | `packages/ts/src/app/app.ts:533`, `packages/ts/src/app/app.ts:700`, `packages/ts/src/app/app.ts:808`, `packages/ts/src/http/request.ts:148`, `packages/php/src/App/App.php:544`, `packages/php/src/App/App.php:847`, `packages/php/src/App/App.php:1014` | none | |
| HY-114.12 | true | `packages/ts/src/http/request.ts:297`, `packages/ts/src/app/core-rules.ts:537`, `packages/php/src/App/CoreRules.php:240` | `packages/rust/tests/rules.rs:390`, `packages/ts/tests/steps/request.ts:119`, `packages/php/tests/CoreRulesTest.php:65`, `packages/php/tests/Support/Steps/RequestSteps.php:50`, `packages/python/tests/test_core_rules.py:137`, `packages/python/tests/steps/request_steps.py:29`, `tests/scripts/node-core.test.mts:126` | |

## HY-115

HY-115 shares the sessions of one Redis server, Sentinel group or cluster between the three servers in the protocol of phpredis 6.3.0.

The Node and Python servers pass the Redis store to the session-store library (`packages/ts/src/session/redis-sessions.ts:50`, `packages/python/src/polyspec/hyper/session/redis_sessions.py:47`), which decides the key, the lock, the expiry and the release in `session-store@v0.0.7:packages/redis/rust/src/protocol.rs` and the connections in `session-store@v0.0.7:packages/redis/rust/src/connection.rs`. Those places are named in the rows. The PHP server keeps the session handler of phpredis (`packages/php/src/Session/NativeSession.php:54`) and its own handler for Redis Cluster (`packages/php/src/Session/RedisClusterSessions.php`).

| Statement | Verdict | Code that decides it | Tests that cite it | Note |
| --- | --- | --- | --- | --- |
| HY-115.1 | true | `packages/ts/src/session/redis-sessions.ts:50`, `packages/python/src/polyspec/hyper/session/redis_sessions.py:47`, `packages/php/src/Session/NativeSession.php:128`, `session-store@v0.0.7:packages/redis/rust/src/protocol.rs:2` | `tests/scripts/session-shared-redis.test.mts` (cites HY-115) | The library states the order of its commands as the interface with phpredis. |
| HY-115.2 | true | `packages/python/src/polyspec/hyper/session/redis_sessions.py:43`, `packages/php/src/Session/RedisClusterSessions.php:101`, `packages/php/src/Session/RedisClusterSessions.php:33`, `session-store@v0.0.7:packages/redis/rust/src/protocol.rs:41`, `protocol.rs:402` | none | The library writes the key `PHPREDIS_SESSION:<id>` with `SETEX` and the lifetime. |
| HY-115.3 | true | `packages/php/src/Session/RedisClusterSessions.php:63`, `packages/php/src/Session/NativeSession.php:54`, `packages/php/src/App/App.php:420`, `session-store@v0.0.7:packages/redis/rust/src/protocol.rs:286`, `protocol.rs:300`, `protocol.rs:328` | none | The library takes `<key>_LOCK` with `SET NX PX`, waits `lock_wait` after a refusal, and fails with `LockTimeout` when its tries end (`protocol.rs:330`). |
| HY-115.4 | true | `packages/php/src/Session/RedisClusterSessions.php:12`, `packages/php/src/Session/RedisClusterSessions.php:17`, `session-store@v0.0.7:packages/redis/rust/src/protocol.rs:342` | `packages/ts/tests/steps/session-requests.ts:72` | The library reads the key after the lock, and a key that is gone gives no session. |
| HY-115.5 | true | `packages/php/src/Session/RedisClusterSessions.php:26`, `packages/php/src/Session/RedisClusterSessions.php:33`, `session-store@v0.0.7:packages/redis/rust/src/protocol.rs:419`, `protocol.rs:434`, `protocol.rs:437` | none | The library compares the lock value with its secret before `SETEX` and fails with `LockLost` without a write. |
| HY-115.23 | true | `packages/ts/src/host/http-host.ts:160`, `packages/python/src/polyspec/hyper/host/_pipeline.py:226`, `session-store@v0.0.7:packages/redis/rust/src/protocol.rs:437`, `packages/php/src/Session/NativeSession.php:243`, `packages/php/src/App/App.php:1135` | none | The Node and Python servers close the session before they write the response, and the close fails with `LockLost` for a lost lock. The PHP server closes it the same way: `NativeSession::close` calls `session_write_close` (`NativeSession.php:243`) before `App.php:1137` sends the response, and a failed write throws (`NativeSession.php:247`). See H35.86 below. |
| HY-115.7 | true | `packages/php/src/Session/RedisClusterSessions.php:80`, `session-store@v0.0.7:packages/redis/rust/src/protocol.rs:412` | none | The library sends `EXPIRE` for an unchanged session and compares no lock. |
| HY-115.8 | true | `packages/php/src/Session/RedisClusterSessions.php:14`, `packages/php/src/Session/RedisClusterSessions.php:84`, `session-store@v0.0.7:packages/redis/rust/src/protocol.rs:12`, `protocol.rs:180` | none | The library releases with the script that deletes the key only when it holds the secret. |
| HY-115.24 | true | `packages/php/src/Session/NativeSession.php:128` | none | A condition on a phpredis peer. |
| HY-115.29 | partly true | `packages/ts/src/session/redis-sessions.ts:16`, `packages/python/src/polyspec/hyper/session/redis_sessions.py:37`, `session-store@v0.0.7:packages/redis/rust/src/protocol.rs:22`, `protocol.rs:86` | none | The library takes `lock_retries` and `lock_wait` as options of the store. Marked `unimplemented` H35.37 for PHP. The PHP server takes the settings from ini values of phpredis and from `RedisClusterSessions`, not as options of a store. |
| HY-115.30 | true | `packages/php/src/Session/NativeSession.php:256`, `session-store@v0.0.7:packages/redis/rust/src/protocol.rs:402`, `protocol.rs:447` | none | Retires HY-115.11, which said that every server writes the new key first. Node and Python write the new key with `SETEX` and then delete the old key with `DEL`. The PHP renewal calls `session_regenerate_id(true)`, which destroys the old session first (`php-src@php-8.4.27:ext/session/session.c:2415`) and writes the new one at the end of the request. |
| HY-115.12 | true | `packages/php/src/Session/NativeSession.php:49`, `packages/php/src/Session/NativeSession.php:54` | `tests/scripts/session-redis-failure.test.mts` (cites HY-115) | |
| HY-115.13 | true | `tests/scripts/session-shared-redis.test.mts`, `tests/scripts/session-redis-failure.test.mts:59` | itself | The failure test kills a process with SIGKILL (`tests/scripts/session-redis-failure.test.mts:62`). |
| HY-115.26 | true | `packages/php/src/Session/RedisSentinelSessions.php:34`, `packages/ts/src/session/redis-sessions.ts:8`, `session-store@v0.0.7:packages/redis/rust/src/connection.rs:258`, `connection.rs:264` | `tests/scripts/session-redis-failover.test.mts` (cites HY-115) | The library asks Sentinel for the primary at the start of each request. |
| HY-115.16 | true | `packages/php/src/Session/RedisSentinelSessions.php:45` | `tests/scripts/session-redis-failover.test.mts` (cites HY-115) | |
| HY-115.17 | true | `packages/ts/src/session/redis-sessions.ts:8`, `packages/python/src/polyspec/hyper/session/redis_sessions.py:18`, `packages/php/src/Session/RedisSentinelSessions.php:19`, `packages/php/src/Session/RedisClusterSessions.php:36`, `session-store@v0.0.7:packages/redis/rust/src/connection.rs:20`, `connection.rs:197`, `connection.rs:209` | `tests/scripts/session-redis-failover.test.mts:1` (cites HY-115) | The library takes TLS by the scheme `rediss://` and the ACL user from the address, and for Sentinel from its user and certificates. |
| HY-115.18 | true | `tests/scripts/session-redis-failover.test.mts:53` | itself | |
| HY-115.27 | true | `packages/php/src/Session/RedisClusterSessions.php:8`, `packages/php/src/Session/RedisClusterSessions.php:52`, `session-store@v0.0.7:packages/redis/rust/src/connection.rs:37`, `connection.rs:44` | `tests/scripts/session-redis-cluster.test.mts:169` (cites HY-115) | The library speaks the protocol through a cluster connection. |
| HY-115.20 | true | `tests/scripts/session-redis-cluster.test.mts:188` | itself | |
| HY-115.28 | partly true | `packages/ts/src/session/redis-sessions.ts:21`, `packages/python/src/polyspec/hyper/session/redis_sessions.py:41`, `session-store@v0.0.7:packages/redis/rust/src/protocol.rs:58`, `protocol.rs:62` | none | The library fails a lifetime of 0 with `InvalidLifetime` and a lock expiry of 0 with `InvalidLockExpire`, and gives the lock expiry no default. Marked `unimplemented` H35.37 for PHP. `RedisClusterSessions` gives `lockExpire` the default 30 (`packages/php/src/Session/RedisClusterSessions.php:32`). |
| HY-115.22 | true | `packages/php/src/Session/RedisClusterSessions.php:63`, `session-store@v0.0.7:packages/redis/rust/src/protocol.rs:328` | none | The library tries once and then `lock_retries` more times. |

## H35.86: the Redis lock order of the PHP server

The PHP server has two Redis session handlers: the session handler of phpredis, which `NativeSession` starts for a standalone or Sentinel store (`packages/php/src/Session/NativeSession.php:55`), and `RedisClusterSessions` (`packages/php/src/Session/RedisClusterSessions.php`) for Redis Cluster. Both are compared with the library that the Node and Python servers use, session-store v0.0.8, the release that the root `composer.json` pins for `ext-polyspec_session_store` and `docs/operations/dependencies.md` pins for the other servers. The library is read at its tag `session-store@v0.0.8` in the local checkout `~/Projects/polyspec/session-store`; the tag names the release.

The phpredis 6.3.0 session source was not read verbatim. The only text obtained was a summary from a fetch tool, which gave line numbers that it marked as uncertain, so this section cites no phpredis line. The helper `make hyper-install-redis` (`Makefile:331`) extracts phpredis 6.3.0 into `var/pie/phpredis` (`Makefile:329`), but its `pie_run` trap removes that work tree on exit (`Makefile:269`), so no source file remains to read. The phpredis column of the table is therefore unverified, and no verdict is given for phpredis.

| Step | Statements | session-store v0.0.8 (Node, Python) | PHP `RedisClusterSessions` | Verdict for PHP Cluster | phpredis (standalone, Sentinel) |
| --- | --- | --- | --- | --- | --- |
| Takes the lock | HY-115.3 | `protocol.rs:296-302` builds `SET <key>_LOCK <secret> NX PX`, sent at `:321` after `EXISTS` at `:316` | `RedisClusterSessions.php:143` in `acquire` (`:135`), called from `read` at `:91` for every request | true for the command; the library takes the lock only when the key exists (`:318`), PHP takes it for every id | not read |
| Retries and waits | HY-115.3, HY-115.22 | `protocol.rs:328-334`: a refusal waits `lock_wait` and retries while `tries < lock_retries`; `LockTimeout` at `:330` | `RedisClusterSessions.php:142` loops `try <= lockRetries`, one try and then `lockRetries` more (HY-115.22 holds); `usleep` at `:149` after every refusal, the last one included | true for both; PHP waits once more after its last try, which the library does not, and returns false at `:152` | not read |
| Writes | HY-115.23, HY-115.5 | `protocol.rs:418-423` reads the lock, `:434-437` refuses a lock that is not its secret (`LockLost`), `:398-402` writes with `SETEX`; `:412-416` sends `EXPIRE` for an unchanged session | `RedisClusterSessions.php:105` reads the lock and `:112` writes with `SETEX`, in `write` (`:101`); `write` runs in `session_write_close` at `NativeSession.php:243`, inside `NativeSession::close` (`:226`), before `App.php:1135` closes the store and `App.php:1137` sends the response | true; the earlier audit text that PHP calls no `session_write_close` was wrong | not read |
| Frees the lock | HY-115.8 | `protocol.rs:12-13` is the `RELEASE` script, run at `:386-396` after the write or after the `LockLost` error | `RedisClusterSessions.php:14-15` is the script; `close` (`:65`) calls `release` (`:67`), which runs the script at `:163`; `destroy` (`:120`) releases at `:122` | true | not read |

No statement that the PHP Cluster handler does not follow was found in these rows, so no statement gets the H35.40 mark here. The rows of phpredis stay unverified: HY-115.3 and HY-115.22 for phpredis, and the phpredis side of HY-115.24, need the phpredis source read before a verdict. Places cited in the table: 31. Statements compared: HY-115.3, HY-115.5, HY-115.8, HY-115.22 and HY-115.23.

## HY-131

HY-131 states how a server reads a `multipart/form-data` body in chunks, its value, part and file limits, its temporary files and the order of its checks. Tests cite only the group id or retired ids (HY-131.1, HY-131.5, HY-131.7 to HY-131.13, HY-131.15, HY-131.16, HY-131.21), except HY-131.14 (`packages/ts/tests/http.test.ts`, `packages/php/tests/RunTest.php`, `packages/python/tests/transport.py`); group tests: `tests/scripts/upload-servers.test.mts`, `tests/scripts/multipart-compare.test.mts`, `packages/ts/tests/steps/fields.ts`, `packages/php/tests/Support/Steps/FieldsSteps.php`, `packages/python/tests/steps/fields_steps.py`.

| Statement | Verdict | Code that decides it | Tests that cite it | Note |
| --- | --- | --- | --- | --- |
| HY-131.26 | true | `packages/ts/src/form/request-body.ts:37`, `packages/ts/src/form/multipart.ts:74`, `packages/php/src/Form/RequestBody.php:50`, `packages/python/src/polyspec/hyper/form/_request_body.py:45` | group only | The servers hold their own reader, not the reader of F-24 of http-form; the order of the first failure follows from feeding byte order. |
| HY-131.27 | true | `packages/ts/src/app/app.ts:268`, `packages/ts/src/app/app.ts:533`, `packages/php/src/App/App.php:168` | none | |
| HY-131.8 | true | `packages/ts/src/app/app.ts:268`, `packages/php/src/App/App.php:168`, `packages/python/src/polyspec/hyper/app/app.py:278` | none | |
| HY-131.9 | true | `packages/ts/src/app/app.ts:272`, `packages/php/src/App/App.php:143`, `packages/python/src/polyspec/hyper/app/app.py:248` | none | |
| HY-131.10 | true | `packages/ts/src/app/app.ts:269`, `packages/ts/src/app/app.ts:273`, `packages/php/src/App/App.php:169`, `packages/php/src/App/App.php:176` | none | |
| HY-131.32 | true | `packages/ts/src/form/request-body.ts:40`, `packages/ts/src/host/http-host.ts:291`, `packages/ts/src/form/multipart.ts:100`, `packages/ts/src/form/multipart.ts:119` | group only | |
| HY-131.30 | false | `packages/ts/src/form/multipart.ts:85` | none | Marked `unimplemented` H35.11: no server fails with the kinds `body_limit`, `value_limit`, `part_limit` or `file_limit`; the reader returns a boolean. |
| HY-131.28 | partly true | `packages/ts/src/form/uploaded-file.ts:65`, `packages/ts/src/form/uploaded-file.ts:74`, `packages/php/src/Form/UploadedFile.php:99` | none (code cites retired HY-131.15, HY-131.16) | Marked `unimplemented` H35.11: files are written to a request directory and move and read work, but a failure is a `RangeError` without the kinds `exists` and `moved` of http-form. |
| HY-131.14 | true | `packages/ts/src/host/http-host.ts:207`, `packages/php/src/App/App.php:1126`, `packages/python/src/polyspec/hyper/host/asgi.py:120`, `packages/python/src/polyspec/hyper/host/server.py:88` | `packages/ts/tests/http.test.ts`, `packages/php/tests/RunTest.php`, `packages/python/tests/transport.py` | |
| HY-131.31 | true | `packages/rust/src/pipeline.rs:1`, `packages/ts/src/host/http-host.ts:305`, `packages/ts/src/app/app.ts:697` | none | The order is the `Step` enum of the core; the servers follow it in their own code. |
| HY-131.29 | false | `packages/ts/src/host/http-host.ts:305` | none | Marked `unimplemented` H35.36-2: `Number(content-length ?? 0)` makes a value that is no number `NaN`, which passes, and no server answers 400 `invalid_content_length`. |
| HY-131.19 | true | no code: the rule gives no time limit | none | A statement of scope; `docs/operations/deployment.md` names the server in front. |
| HY-131.33 | true | `packages/ts/src/host/http-host.ts:290`, `packages/php/src/Http/Request.php:600`, `packages/python/src/polyspec/hyper/host/_pipeline.py:125` | none | Node pauses the stream until `written()` resolves. |

## HY-133

HY-133 states the outside redirect: its grammar of a location, its responses, and the origin of a location. Tests cite only the group id, except `packages/rust/tests/contracts.rs` (HY-133.2, HY-133.5, HY-133.13); group tests: `packages/ts/tests/steps/result.ts`, `packages/ts/tests/steps/app.ts`, `packages/php/tests/Support/Steps/ResultSteps.php`, `packages/python/tests/steps/result_steps.py`, `tests/e2e/board.spec.ts`.

| Statement | Verdict | Code that decides it | Tests that cite it | Note |
| --- | --- | --- | --- | --- |
| HY-133.1 | true | `packages/ts/src/result/result.ts:35`, `packages/php/src/Result/Result.php:48`, `packages/python/src/polyspec/hyper/result/result.py:48`, `packages/ts/src/result/redirect.ts:10` | group only | |
| HY-133.2 | true | `packages/ts/src/result/result.ts:9`, `packages/php/src/Result/Result.php:17`, `packages/python/src/polyspec/hyper/result/result.py:13`, `packages/rust/src/location.rs:65` | `packages/rust/tests/contracts.rs` | Each server holds its own copy of the grammar; the core function is not called by them. |
| HY-133.3 | true | `packages/ts/src/result/result.ts:43`, `packages/php/src/Result/Result.php:65`, `packages/python/src/polyspec/hyper/result/result.py:58` | group only | A regular expression, no URL parser. |
| HY-133.4 | true | `packages/ts/src/result/result.ts:9` | none | A reason; the grammar admits only `http` and `https` with `//` and a host. |
| HY-133.5 | true | `packages/ts/src/result/result.ts:37`, `packages/php/src/Result/Result.php:51`, `packages/python/src/polyspec/hyper/result/result.py:50`, `packages/rust/src/error.rs:309` | `packages/rust/tests/contracts.rs` | |
| HY-133.6 | true | `packages/ts/src/app/app.ts:751`, `packages/php/src/App/App.php:938`, `packages/python/src/polyspec/hyper/app/app.py:891` | group only | A document request is `wantsJson()`. |
| HY-133.7 | true | `packages/ts/src/app/app.ts:755` | none | A reason for HY-133.6. |
| HY-133.8 | true | `packages/ts/src/app/app.ts:753`, `packages/php/src/App/App.php:941`, `packages/python/src/polyspec/hyper/app/app.py:897` | none | |
| HY-133.9 | true | `packages/ts/src/app/app.ts:754`, `packages/php/src/App/App.php:945`, `packages/python/src/polyspec/hyper/app/app.py:900` | none | |
| HY-133.10 | true | `packages/ts/src/result/result.ts:70`, `packages/ts/src/result/result.ts:97`, `packages/php/src/Result/Result.php:167`, `packages/rust/src/error.rs:310` | none | The refusal runs before the argument check. |
| HY-133.11 | true | `packages/ts/src/result/redirect.ts:13`, `packages/ts/src/app/app.ts:722` | none | |
| HY-133.12 | true | `packages/ts/src/app/app.ts:717`, `packages/ts/src/app/app.ts:722` | none | An outside redirect takes the path of every redirect result. |
| HY-133.13 | true | `packages/ts/src/result/result.ts:43`, `packages/php/src/Result/Result.php:65`, `packages/python/src/polyspec/hyper/result/result.py:58`, `packages/rust/src/location.rs:134` | `packages/rust/tests/contracts.rs` | |
