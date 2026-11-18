<!-- doc-id: plan-statement-audit -->
# Statement audit

[한국어](statement-audit.ko.md).

This document records row H35.43 of the [execution checklist](checklist.md). It compares each live statement of HY-60, HY-100, HY-104, HY-113, HY-114, HY-115, HY-131 and HY-133 of `contracts/protocol.json` with the server code. It gives each statement a verdict of true, false or partly true, and names the place in the code that decides it. The browser rules HYC are compared after the first release.

## Summary

| Group | Statements | True | Partly true | False |
| --- | --- | --- | --- | --- |
| HY-60 | 32 | 32 | 0 | 0 |
| HY-100 | 36 | 35 | 1 | 0 |
| HY-104 | 30 | 20 | 8 | 2 |
| HY-113 | 6 | 3 | 2 | 1 |
| HY-114 | 8 | 8 | 0 | 0 |
| HY-115 | 21 | 17 | 4 | 0 |
| HY-131 | 13 | 10 | 1 | 2 |
| HY-133 | 13 | 13 | 0 | 0 |
| Total | 159 | 138 | 16 | 5 |

## Open statements

The following statements are not true and carry no `unimplemented` mark. Each one still needs a mark with a row that makes it true, or the code must be corrected. Until then H35.43 stays open.

- HY-100.2: no host passes its store to `App.handle`. Node calls `app.respond`, Python calls `App._respond`, and PHP calls the private `through`.
- HY-104.14: `read_node` (`packages/rust/src/session.rs:157`) reads every object as a map and checks no class. The php-serialization library decides whether an object of another class fails, and this audit did not open that library.
- HY-104.31: PHP accepts identifiers of 22 to 128 characters, not 22 to 256 (`packages/php/src/Session/NativeSession.php:39`).
- HY-104.33: Python names the method `_collect`, which is not public. PHP has no `collect`, and its options do not set `gc_probability` to 0.
- HY-104.37: the Node interface returns `undefined`, not null, for a key that holds no value (`packages/ts/src/session/session-store.ts:5`).
- HY-115.11: the PHP renewal calls `session_regenerate_id(true)`, so PHP decides the order of the write and the delete, not code of this repository.
- HY-115.23: the PHP server calls no `session_write_close`, so PHP writes the session after the response, and a lost lock cannot change the status.

## Limits

For Node and Python, the evidence for the store statements is the call into the session-store library. This audit did not open that library. For PHP, the evidence for the lock order is the session handler of PHP and phpredis.

## HY-60

HY-60 states the response hook, the notes of the reply, the elapsed time on a monotonic clock, and the plain 500 that hyper writes for an error that escapes the answer of a request. Statement 28 is retired. No statement of the group has an `unimplemented` mark.

| Statement | Verdict | Code that decides it | Tests that cite it | Note |
| --- | --- | --- | --- | --- |
| HY-60.1 | true | `packages/ts/src/app/app.ts:110`, `packages/php/src/App/App.php:108`, `packages/python/src/polyspec/hyper/app/app.py:249` | none by this id | |
| HY-60.2 | true | `packages/ts/src/app/app.ts:471-496` and `:508-510`, `packages/php/src/App/App.php:405-434` and `:461-472`, `packages/python/src/polyspec/hyper/app/app.py:458-488` and `:498-514`; Node 400 and 431 at `packages/ts/src/host/http-host.ts:77-89` | `tests/scripts/upload-servers.test.mts` | Every answer of the application, including the answers before routing, passes the one report call at the end of `respond`; the answers before routing were not traced one by one. |
| HY-60.3 | true | `packages/ts/src/app/app.ts:509`, `packages/php/src/App/App.php:469`, `packages/python/src/polyspec/hyper/app/app.py:508-514` | none by this id | The hook receives the request that `respond` received. |
| HY-60.4 | true | `packages/ts/src/app/app.ts:494-495` and the cookie after it at `packages/ts/src/host/http-host.ts:153`; `packages/python/src/polyspec/hyper/host/_pipeline.py:220-240`; `packages/php/src/App/App.php:436-437` | none by this id | The report takes the framed response; the session cookie is added after `respond` returns. |
| HY-60.5 | true | `packages/php/src/Host/functions.php:14-17`, `packages/php/src/App/App.php:356-359` and `:1053`; `packages/ts/src/host/http-host.ts:101-102` | `packages/ts/tests/steps/app.ts`, `packages/python/tests/steps/app_steps.py` | |
| HY-60.6 | true | no `REQUEST_TIME_FLOAT`, `microtime` or wall clock in `packages/{ts,php,python}/src`; the clocks are `hrtime(true)`, `performance.now()` and `time.perf_counter_ns()` (`packages/php/src/App/App.php:469`, `packages/ts/src/app/app.ts:509`, `packages/python/src/polyspec/hyper/app/app.py:511`) | none by this id | |
| HY-60.7 | true | `packages/ts/src/host/http-host.ts:77-89`, `requestLine` at `:218-222` | `packages/ts/tests/http.test.ts`, `tests/scripts/upload-servers.test.mts` | |
| HY-60.8 | true | `packages/ts/src/app/app.ts:471-496`, `packages/php/src/App/App.php:401-406`, `packages/python/src/polyspec/hyper/app/app.py:464-487`; new empty reply in the Node client error at `packages/ts/src/host/http-host.ts:86` | `tests/scripts/upload-servers.test.mts` | The reply is created before dispatch and reported also after a failure. |
| HY-60.9 | true | `packages/ts/src/http/reply.ts:18-23`, `packages/php/src/Http/Reply.php:33-43`, `packages/python/src/polyspec/hyper/http/reply.py:30-38` | none by this id | A map or dict keeps the position of the first note of a name. |
| HY-60.10 | true | the notes are read only by `notes()` (`packages/ts/src/http/reply.ts:27-29`); no write path of the response reads them | none by this id | |
| HY-60.11 | true | `packages/ts/src/app/app.ts:476-492`, `packages/php/src/App/App.php:420-434`, `packages/python/src/polyspec/hyper/app/app.py:467-484` | `tests/scripts/upload-servers.test.mts` | |
| HY-60.12 | true | `packages/ts/src/host/http-host.ts:132-136` | `tests/scripts/upload-servers.test.mts` | A public file returns before `respond`. |
| HY-60.13 | true | the report call is outside the `try` of `respond`: `packages/ts/src/app/app.ts:495`, `packages/php/src/App/App.php:437`, `packages/python/src/polyspec/hyper/app/app.py:487` | `tests/scripts/upload-servers.test.mts` | |
| HY-60.14 | true | `packages/ts/src/host/http-host.ts:180-195`, `packages/php/src/App/App.php:1084-1092` and `:515-533`, `packages/python/src/polyspec/hyper/host/_pipeline.py:186-199`, `packages/python/src/polyspec/hyper/host/asgi.py:64-108`, session open at `packages/ts/src/app/app.ts:481` | `packages/php/tests/RunTest.php`, `packages/python/tests/test_asgi.py`, `packages/python/tests/test_wsgi.py`, `packages/ts/tests/http.test.ts`, `tests/scripts/upload-servers.test.mts` | |
| HY-60.15 | true | `packages/ts/src/host/http-host.ts:183-195`, `packages/php/src/App/App.php:525-532`, `packages/python/src/polyspec/hyper/host/_pipeline.py:186-199` | `tests/scripts/upload-servers.test.mts` | `frame` adds the frame policy and `no-store`. |
| HY-60.16 | true | the escape paths call no `report`: `packages/ts/src/host/http-host.ts:180-195`, `packages/php/src/App/App.php:515-533`, `packages/python/src/polyspec/hyper/host/_pipeline.py:186-199` | `tests/scripts/upload-servers.test.mts` | |
| HY-60.17 | true | `packages/ts/src/host/http-host.ts:197-202`, `packages/php/src/App/App.php:1110-1117`, `packages/python/src/polyspec/hyper/host/_exchange.py:30-50` | `packages/php/tests/RunTest.php`, `packages/python/tests/test_asgi.py`, `packages/python/tests/test_wsgi.py`, `packages/ts/tests/http.test.ts`, `tests/scripts/upload-servers.test.mts` | `Exchange.report` and the single `finally` call each write hook once. |
| HY-60.18 | true | `packages/ts/src/host/http-host.ts:131` with `bodySize` at `packages/ts/src/http/request.ts:303-306`; `packages/python/src/polyspec/hyper/host/_pipeline.py:160-182`; `packages/php/src/App/App.php:1097-1108` | `packages/php/tests/RunTest.php` | |
| HY-60.19 | true | `packages/python/src/polyspec/hyper/host/wsgi.py:198-206`, `packages/python/src/polyspec/hyper/host/asgi.py:230-238`, `packages/python/src/polyspec/hyper/host/_exchange.py:40`; Node at `packages/ts/src/host/http-host.ts:128-129` and `:196` | none by this id | |
| HY-60.20 | true | `packages/ts/src/host/http-host.ts:183-186`, `packages/php/src/App/App.php:518-523`, `packages/python/src/polyspec/hyper/host/server.py:183-204` | none by this id | |
| HY-60.21 | true | `packages/ts/src/host/http-host.ts:183-195`, `packages/python/src/polyspec/hyper/host/server.py:183-204`, `packages/python/src/polyspec/hyper/host/asgi.py:101-106` | `packages/python/tests/test_asgi.py` | PHP does not close the connection, as HY-60.33 states. |
| HY-60.22 | true | `packages/python/src/polyspec/hyper/host/wsgi.py:61-66` and `:114-135`, `packages/python/src/polyspec/hyper/host/asgi.py:62-66` and `:83-87` | none by this id | |
| HY-60.23 | true | `packages/php/src/App/App.php:29`, `:1084-1092` and `:518-523` | none by this id | |
| HY-60.24 | true | `packages/php/src/App/App.php:1052` and `:532`, `packages/ts/src/host/http-host.ts:318-322` | `tests/scripts/upload-servers.test.mts` | |
| HY-60.25 | true | `packages/php/src/App/App.php:1052`, `packages/php/src/Http/Response.php:71-80` | `tests/scripts/upload-servers.test.mts` | |
| HY-60.26 | true | `packages/ts/src/host/http-host.ts:318-322` | none by this id | `writeHead` merges the headers that `setHeader` set before. |
| HY-60.27 | true | `packages/python/src/polyspec/hyper/host/wsgi.py:114-135`, `packages/python/src/polyspec/hyper/host/asgi.py:83-98` | `tests/scripts/upload-servers.test.mts` | |
| HY-60.29 | true | `packages/ts/src/http/reply.ts:27-29`, `packages/php/src/Http/Reply.php:51-60`, `packages/python/src/polyspec/hyper/http/reply.py:40-42` | none by this id | PHP casts an integer key back to a string. |
| HY-60.30 | true | `packages/python/src/polyspec/hyper/host/server.py:183-204` with `packages/python/src/polyspec/hyper/host/_pipeline.py:197-199` | none by this id | |
| HY-60.31 | true | `packages/ts/src/app/app.ts:462`, `packages/php/src/App/App.php:356-359`, `packages/python/src/polyspec/hyper/app/app.py:449-464` | none by this id | |
| HY-60.32 | true | `packages/ts/src/http/reply.ts:21`, `packages/php/src/Http/Reply.php:37-39`, `packages/python/src/polyspec/hyper/http/reply.py:33-36` | `packages/rust/interface.json` names it; no test | |
| HY-60.33 | true | `packages/php/src/App/App.php:518-522` and `:1114-1115` | none by this id | |

## HY-100

HY-100 states how each server is served through the standard host interface of its runtime: the PHP front controller `run`, the Python callables `create_wsgi` and `create_asgi` and the server `create_server`, and the Node listener `listener`. No statement of the group has an `unimplemented` mark.

| Statement | Verdict | Code that decides it | Tests that cite it | Note |
| --- | --- | --- | --- | --- |
| HY-100.1 | true | `packages/php/src/Host/functions.php:14`, `packages/python/src/polyspec/hyper/host/wsgi.py:38`, `packages/python/src/polyspec/hyper/host/asgi.py:36`, `packages/ts/src/host/http-host.ts:60`, `packages/ts/src/host/http-host.ts:67` | none by the exact id; `packages/php/tests/RunTest.php:17`, `packages/ts/tests/http.test.ts:17` cite HY-100 | |
| HY-100.2 | partly true | `packages/ts/src/host/http-host.ts:128`, `packages/ts/src/host/http-host.ts:143`, `packages/ts/src/host/http-host.ts:158`, `packages/python/src/polyspec/hyper/host/_pipeline.py:223`, `packages/php/src/App/App.php:1133`, `packages/php/src/Http/Request.php:532` | `packages/php/tests/RequestTest.php:51`, `packages/ts/tests/http.test.ts:190`, `tests/scripts/upload-servers.test.mts:578`, `tests/scripts/upload-servers.test.mts:744`, `tests/scripts/upload-servers.test.mts:755` | No host passes its store to `App.handle`: Node calls `app.respond` with an `open` function, Python calls `App._respond` with `open_session`, and PHP calls the private `through` with a `NativeSession`. The other clauses (body limit, cookie of a new session first, hooks, plain 500 for a missing target) hold. The statement needs the name of the entry that the hosts call, or the hosts call `App.handle`. |
| HY-100.3 | true | `packages/python/src/polyspec/hyper/host/wsgi.py:38` | none by the exact id; `packages/python/tests/test_wsgi.py:1` cites HY-100 | |
| HY-100.4 | true | `packages/python/src/polyspec/hyper/host/wsgi.py:160`, `packages/python/src/polyspec/hyper/host/wsgi.py:173`, `packages/python/src/polyspec/hyper/host/_pipeline.py:114`, `packages/python/src/polyspec/hyper/host/_pipeline.py:231` | `tests/scripts/upload-servers.test.mts:784` | A body over the limit by its Content-Length is not read; bytes past the limit of a read body are read and discarded, not held (`_pipeline.py:114`). |
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
| HY-100.30 | true | `packages/php/src/Host/functions.php:14`, `packages/php/src/App/App.php:1080`, `packages/php/src/App/App.php:1084`, `packages/php/src/App/App.php:1087`, `packages/php/src/App/App.php:1112`, `packages/php/src/App/App.php:1119` | `tests/scripts/upload-servers.test.mts:653` | |
| HY-100.31 | true | `packages/ts/src/host/http-host.ts:248`, `packages/ts/src/host/http-host.ts:83`, `packages/python/src/polyspec/hyper/host/wsgi.py:146`, `packages/python/src/polyspec/hyper/host/asgi.py:152` | `packages/php/tests/RequestTest.php:14`, `packages/python/tests/test_wsgi.py:172`, `packages/python/tests/test_asgi.py:167`, `tests/scripts/upload-servers.test.mts:809` | The 400 of a method that `node:http` refuses is written by the `clientError` handler. |
| HY-100.32 | true | `packages/ts/src/host/http-host.ts:87` | none | The 400 or 431 of a request that `node:http` cannot parse is written by hyper with `HTTP/1.1`, because no version was parsed. |
| HY-100.33 | true | no hyper code: the PHP built-in server decides it | none | A fact of the SAPI; no test of this repository cites it. |

## HY-104

HY-104 states how the three servers store, lock, share and convert a session, through the session-store library and the session rules of the core.

| Statement | Verdict | Code that decides it | Tests that cite it | Note |
| --- | --- | --- | --- | --- |
| HY-104.1 | true | `packages/ts/src/session/file-sessions.ts:18`, `packages/python/src/polyspec/hyper/session/file_sessions.py:1`, `packages/php/src/Session/NativeSession.php:127` | `tests/scripts/session-shared.test.mts` (by HY-104.28) | PHP shares the directory through its native files handler with `php_serialize`. |
| HY-104.2 | true | `packages/ts/src/session/file-sessions.ts:42` (library `FileSessions.inDirectory`), `packages/python/src/polyspec/hyper/session/file_sessions.py:29`, `packages/php/src/Session/NativeSession.php:127` | `tests/scripts/upload-servers.test.mts`, `tests/legacy/interfaces.json` | The file name, the mode and the record form are decided by the session-store library and by the PHP files handler, not by hyper code. |
| HY-104.3 | true | `packages/ts/src/host/http-host.ts:153`, `packages/ts/src/host/http-host.ts:160`, `packages/python/src/polyspec/hyper/host/_pipeline.py:219`, `packages/python/src/polyspec/hyper/host/_pipeline.py:226`, `packages/ts/src/app/app.ts:557` | none by exact id | The lock is held between `open` and `close` of the library; PHP holds the lock of its native handler. |
| HY-104.7 | true | session-store library through `packages/ts/src/session/file-session.ts:73`; PHP files handler | `tests/legacy/interfaces.json` | Decided by the library and by PHP. |
| HY-104.8 | true | `packages/ts/src/session/file-session.ts:23`, `packages/php/src/Session/NativeSession.php:53` | `tests/legacy/interfaces.json` | |
| HY-104.10 | true | session-store library through `packages/ts/src/session/file-sessions.ts:59` | none | Decided by the library. |
| HY-104.11 | true | `packages/ts/src/session/file-session.ts:65`, `packages/php/src/Session/NativeSession.php:159` | none | |
| HY-104.12 | true | `packages/ts/src/session/file-session.ts:71` | none | |
| HY-104.13 | true | `packages/rust/src/session.rs:91` | `packages/rust/tests/contracts.rs`, `packages/php/tests/Support/Steps/SessionSteps.php`, `packages/ts/tests/steps/session-requests.ts` | |
| HY-104.14 | partly true | `packages/rust/src/session.rs:242`, `packages/rust/src/session.rs:256` | `packages/rust/tests/contracts.rs`, `packages/rust/tests/rules.rs`, `tests/scripts/node-core.test.mts` | `read_node` (`packages/rust/src/session.rs:157`) reads every object as a map and checks no class; whether an object of another class fails is decided in the php-serialization library, which this audit did not open. |
| HY-104.34 | true | `packages/rust/src/session.rs:177`, `packages/rust/src/session.rs:192` | none by exact id | |
| HY-104.39 | true | `packages/rust/src/session.rs:194` (`value == 0.0` gives 0) | none | |
| HY-104.15 | true | `packages/ts/src/session/file-sessions.ts:63`, `packages/python/src/polyspec/hyper/session/file_sessions.py:37` | none | Decided by the library. |
| HY-104.33 | partly true | `packages/ts/src/session/file-sessions.ts:65`, `packages/python/src/polyspec/hyper/session/file_sessions.py:37`, `packages/php/src/Session/NativeSession.php:114` | none | Python names the method `_collect`, which is not public; PHP has no `collect`, and its options do not set `gc_probability` to 0, so the native handler can remove expired files during a request by chance. |
| HY-104.28 | true | `tests/scripts/session-shared.test.mts` | itself | |
| HY-104.29 | true | `packages/ts/src/session/file-sessions.ts:22`, `packages/python/src/polyspec/hyper/session/file_sessions.py:7` | none | The queue is the library's. |
| HY-104.31 | partly true | `packages/php/src/Session/NativeSession.php:39` | `tests/legacy/interfaces.json` | PHP accepts identifiers of 22 to 128 characters, not 22 to 256; Node and Python follow the library. |
| HY-104.32 | partly true | `packages/ts/src/session/file-sessions.ts:38`, `packages/python/src/polyspec/hyper/session/file_sessions.py:24` | `packages/ts/tests/steps/file-sessions.ts`, `packages/rust/tests/cases/faults.json` | PHP has no file store class (`packages/php/src/App/App.php:1132` uses `NativeSession`). Marked H35.37 for php. |
| HY-104.20 | true | `packages/rust/src/session.rs:311` | `tests/legacy/interfaces.json` | |
| HY-104.21 | true | session-store library; PHP `session.gc_maxlifetime` | none | Decided by the library and by PHP. |
| HY-104.22 | true | `packages/ts/src/session/session.ts:9`, `packages/php/src/Session/Session.php:14`, `packages/rust/src/session.rs:17` | `packages/php/tests/CoreRulesTest.php`, `packages/python/tests/test_core_rules.py`, `tests/scripts/node-core.test.mts` | |
| HY-104.23 | true | `packages/rust/src/session.rs:424`, `packages/rust/src/session.rs:444` | `packages/rust/tests/contracts.rs`, `packages/rust/tests/rules.rs`, `packages/rust/tests/cases/faults.json` | |
| HY-104.36 | true | `packages/rust/src/error.rs:180`, `packages/rust/src/session.rs:424` | none by exact id | |
| HY-104.35 | true | `packages/ts/src/session/session.ts:75`, `packages/rust/src/session.rs:484` | none | |
| HY-104.37 | partly true | `packages/ts/src/session/session-store.ts:5` | `tests/scripts/upload-servers.test.mts` | The Node interface returns `undefined`, not null, for a key that holds no value. |
| HY-104.25 | partly true | `packages/ts/src/session/file-sessions.ts:3`, `packages/python/src/polyspec/hyper/session/file_sessions.py:15`, `packages/rust/src/session.rs:1` | none | PHP stores through `NativeSession`, not the store interface of the library. Marked H35.37 for php. |
| HY-104.26 | false | `packages/php/src/App/App.php:1132`, `packages/php/src/Session/NativeSession.php:54` | `tests/legacy/file-store-sessions.json` | PHP uses the native session handler. Marked H35.37 for php. |
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

The Node and Python servers pass the Redis store to the session-store library (`packages/ts/src/session/redis-sessions.ts:50`, `packages/python/src/polyspec/hyper/session/redis_sessions.py:47`), which decides the key, the lock, the expiry and the release. That library is not part of this repository and was not opened for this audit, so for those two servers the place is the delegation. The PHP server keeps the session handler of phpredis (`packages/php/src/Session/NativeSession.php:53`) and its own handler for Redis Cluster (`packages/php/src/Session/RedisClusterSessions.php`).

| Statement | Verdict | Code that decides it | Tests that cite it | Note |
| --- | --- | --- | --- | --- |
| HY-115.1 | true | `packages/ts/src/session/redis-sessions.ts:50`, `packages/python/src/polyspec/hyper/session/redis_sessions.py:47`, `packages/php/src/Session/NativeSession.php:127` | `tests/scripts/session-shared-redis.test.mts` (cites HY-115) | |
| HY-115.2 | true | `packages/python/src/polyspec/hyper/session/redis_sessions.py:43`, `packages/php/src/Session/RedisClusterSessions.php:101`, `packages/php/src/Session/RedisClusterSessions.php:33` | none | |
| HY-115.3 | true | `packages/php/src/Session/RedisClusterSessions.php:63`, `packages/php/src/Session/NativeSession.php:53`, `packages/php/src/App/App.php:420` | none | |
| HY-115.4 | true | `packages/php/src/Session/RedisClusterSessions.php:12`, `packages/php/src/Session/RedisClusterSessions.php:17` | `packages/ts/tests/steps/session-requests.ts:72` | |
| HY-115.5 | true | `packages/php/src/Session/RedisClusterSessions.php:26`, `packages/php/src/Session/RedisClusterSessions.php:33` | none | |
| HY-115.23 | partly true | `packages/ts/src/host/http-host.ts:160`, `packages/python/src/polyspec/hyper/host/_pipeline.py:226` | none | The Node and Python servers close the session before they write the response. The PHP server calls no `session_write_close` in `packages/php/src`, so PHP writes the session at the end of the script, after the response, and a lost lock cannot change the status. |
| HY-115.7 | true | `packages/php/src/Session/RedisClusterSessions.php:80` | none | |
| HY-115.8 | true | `packages/php/src/Session/RedisClusterSessions.php:14`, `packages/php/src/Session/RedisClusterSessions.php:84` | none | |
| HY-115.24 | true | `packages/php/src/Session/NativeSession.php:127` | none | A condition on a phpredis peer. `tests/scripts/fixtures/session-worker/worker.php:52` runs the PHP worker with `redis.session.lock_retries` -1 unless `HYPER_SESSION_RETRIES` is set, a setting that this statement excludes. |
| HY-115.29 | partly true | `packages/ts/src/session/redis-sessions.ts:16`, `packages/python/src/polyspec/hyper/session/redis_sessions.py:37` | none | Marked `unimplemented` H35.37 for PHP. The PHP server takes the settings from ini values of phpredis and from `RedisClusterSessions`, not as options of a store. |
| HY-115.11 | partly true | `packages/php/src/Session/NativeSession.php:159` | none | The Node and Python renewal is in the library. The PHP renewal calls `session_regenerate_id(true)`, whose order of write and delete PHP decides, not code of this repository. |
| HY-115.12 | true | `packages/php/src/Session/NativeSession.php:48`, `packages/php/src/Session/NativeSession.php:53` | `tests/scripts/session-redis-failure.test.mts` (cites HY-115) | |
| HY-115.13 | true | `tests/scripts/session-shared-redis.test.mts`, `tests/scripts/session-redis-failure.test.mts:59` | itself | The failure test kills a process with SIGKILL (`tests/scripts/session-redis-failure.test.mts:62`). |
| HY-115.26 | true | `packages/php/src/Session/RedisSentinelSessions.php:34`, `packages/ts/src/session/redis-sessions.ts:8` | `tests/scripts/session-redis-failover.test.mts` (cites HY-115) | |
| HY-115.16 | true | `packages/php/src/Session/RedisSentinelSessions.php:45` | `tests/scripts/session-redis-failover.test.mts` (cites HY-115) | |
| HY-115.17 | true | `packages/ts/src/session/redis-sessions.ts:8`, `packages/python/src/polyspec/hyper/session/redis_sessions.py:18`, `packages/php/src/Session/RedisSentinelSessions.php:19`, `packages/php/src/Session/RedisClusterSessions.php:36` | `tests/scripts/session-redis-failover.test.mts:1` (cites HY-115) | |
| HY-115.18 | true | `tests/scripts/session-redis-failover.test.mts:53` | itself | |
| HY-115.27 | true | `packages/php/src/Session/RedisClusterSessions.php:8`, `packages/php/src/Session/RedisClusterSessions.php:52` | `tests/scripts/session-redis-cluster.test.mts:169` (cites HY-115) | |
| HY-115.20 | true | `tests/scripts/session-redis-cluster.test.mts:188` | itself | |
| HY-115.28 | partly true | `packages/ts/src/session/redis-sessions.ts:21`, `packages/python/src/polyspec/hyper/session/redis_sessions.py:41` | none | Marked `unimplemented` H35.37 for PHP. `RedisClusterSessions` gives `lockExpire` the default 30 (`packages/php/src/Session/RedisClusterSessions.php:32`). |
| HY-115.22 | true | `packages/php/src/Session/RedisClusterSessions.php:63` | none | |

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
