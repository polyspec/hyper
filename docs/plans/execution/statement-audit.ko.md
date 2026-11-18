<!-- doc-id: plan-statement-audit -->
<!-- source-sha256: 586386268f04d08627d156e9292df7772d98cb07027a6e44d79a81bfdd71387c -->
# 진술 감사

[English](statement-audit.md).

이 문서는 [실행 체크리스트](checklist.ko.md)의 H35.43 행을 기록한다. `contracts/protocol.json`의 HY-60, HY-100, HY-104, HY-113, HY-114, HY-115, HY-131, HY-133의 유효한 진술을 각각 서버 코드와 비교한다. 각 진술에 참, 거짓, 일부 참 중 하나의 판정을 주고, 그 판정을 정하는 코드의 위치를 적는다. 브라우저 규칙 HYC는 첫 릴리스 뒤에 비교한다.

## 요약

| 그룹 | 진술 | 참 | 일부 참 | 거짓 |
| --- | --- | --- | --- | --- |
| HY-60 | 32 | 32 | 0 | 0 |
| HY-100 | 36 | 35 | 1 | 0 |
| HY-104 | 30 | 20 | 7 | 3 |
| HY-113 | 6 | 3 | 2 | 1 |
| HY-114 | 8 | 8 | 0 | 0 |
| HY-115 | 21 | 17 | 4 | 0 |
| HY-131 | 13 | 10 | 1 | 2 |
| HY-133 | 13 | 13 | 0 | 0 |
| 합계 | 159 | 138 | 15 | 6 |

## 열린 진술

다음 진술은 참이 아니고 `unimplemented` 표시도 없다. 각 진술은 그것을 참으로 만드는 행과 함께 표시를 받거나, 코드를 고쳐야 한다. 그때까지 H35.43은 열린 상태로 남는다.

- HY-100.2: 어떤 host도 자기 store를 `App.handle`에 넘기지 않는다. Node는 `app.respond`를, Python은 `App._respond`를, PHP는 private `through`를 호출한다.
- HY-104.14: Node와 Python은 다른 class의 object에서 실패한다(`php-serialization@v0.0.16:packages/rust/src/read.rs:460`). PHP 서버는 PHP 자신의 session decoder로 기록을 읽고, 저장된 값을 class 검사 없이 돌려준다(`packages/php/src/Session/NativeSession.php:136`).
- HY-104.31: 모든 서버가 22자에서 128자의 식별자를 받는다(`packages/ts/src/session/record-session.ts:8`, `packages/python/src/polyspec/hyper/session/_record_session.py:16`, `packages/php/src/Session/NativeSession.php:39`). 그러나 진술, SE-5.1(`session-store@v0.0.7:packages/core/rust/src/identifier.rs:8`), PHP(`php-src@php-8.4.27:ext/session/session.c:791`)는 22자에서 256자를 준다.
- HY-104.33: Python은 메서드 이름을 public이 아닌 `_collect`로 둔다. PHP에는 `collect`가 없고, 그 옵션은 `gc_probability`를 0으로 두지 않는다.
- HY-104.37: Node 인터페이스는 값이 없는 key에 대해 null이 아니라 `undefined`를 돌려준다(`packages/ts/src/session/session-store.ts:5`).
- HY-115.11: PHP 갱신은 `session_regenerate_id(true)`를 호출한다(`packages/php/src/Session/NativeSession.php:159`). 이 함수는 옛 session을 먼저 삭제하고(`php-src@php-8.4.27:ext/session/session.c:2415`), 새 session은 요청 끝에 쓴다. Node와 Python은 새 key를 먼저 쓴다(`session-store@v0.0.7:packages/redis/rust/src/protocol.rs:402`, `:447`).
- HY-115.23: PHP 서버는 `session_write_close`를 호출하지 않으므로, PHP는 응답 뒤에 session을 쓰고, 잃은 lock이 상태 코드를 바꿀 수 없다.

## 한계

라이브러리의 위치는 hyper가 고정한 tag에서 `<repository>@<tag>:<path>:<line>`으로 쓴다. 그 tag는 session-store v0.0.7(`Cargo.lock`, `packages/ts/package.json`, `packages/python/uv.lock`)과 php-serialization v0.0.16(`Cargo.lock`)이다. session-store v0.0.8의 Rust와 TypeScript 소스는 v0.0.7과 같으므로, session-store의 각 위치는 두 tag 모두에 맞다. PHP의 위치는 `php-src@php-8.4.27:<path>:<line>`으로 쓴다. PHP에서 Redis lock 순서의 근거는 phpredis의 session handler이고, 이 감사는 그것을 열지 않았다.

## HY-60

HY-60은 응답 hook, reply의 note, monotonic clock으로 잰 경과 시간, 요청의 응답에서 빠져나온 오류에 hyper가 쓰는 평문 500을 정한다. 진술 28은 폐기되었다. 이 그룹의 어떤 진술에도 `unimplemented` 표시가 없다.

| 진술 | 판정 | 판정을 정하는 코드 | 인용하는 테스트 | 메모 |
| --- | --- | --- | --- | --- |
| HY-60.1 | 참 | `packages/ts/src/app/app.ts:110`, `packages/php/src/App/App.php:108`, `packages/python/src/polyspec/hyper/app/app.py:249` | 이 id로는 없음 | |
| HY-60.2 | 참 | `packages/ts/src/app/app.ts:473-497`와 `:508-510`, `packages/php/src/App/App.php:413-440`와 `:461-471`, `packages/python/src/polyspec/hyper/app/app.py:458-488`와 `:498-515`; Node 400과 431은 `packages/ts/src/host/http-host.ts:77-89` | `tests/scripts/upload-servers.test.mts` | 라우팅 전의 응답을 포함해 애플리케이션의 모든 응답이 `respond` 끝의 report 호출 하나를 지난다. 라우팅 전의 응답은 하나씩 추적하지 않았다. |
| HY-60.3 | 참 | `packages/ts/src/app/app.ts:509`, `packages/php/src/App/App.php:469`, `packages/python/src/polyspec/hyper/app/app.py:508-515` | 이 id로는 없음 | hook은 `respond`가 받은 요청을 받는다. |
| HY-60.4 | 참 | `packages/ts/src/app/app.ts:494-495`와 그 뒤의 cookie `packages/ts/src/host/http-host.ts:166`; `packages/python/src/polyspec/hyper/host/_pipeline.py:223-242`; `packages/php/src/App/App.php:436-437` | 이 id로는 없음 | report는 frame을 붙인 응답을 받는다. session cookie는 `respond`가 돌아온 뒤에 붙는다. |
| HY-60.5 | 참 | `packages/php/src/Host/functions.php:14-17`, `packages/php/src/App/App.php:356-359`와 `:1053`; `packages/ts/src/host/http-host.ts:101-102` | `packages/ts/tests/steps/app.ts`, `packages/python/tests/steps/app_steps.py` | |
| HY-60.6 | 참 | `packages/{ts,php,python}/src`에 `REQUEST_TIME_FLOAT`, `microtime`, wall clock이 없다. clock은 `hrtime(true)`, `performance.now()`, `time.perf_counter_ns()`다(`packages/php/src/App/App.php:469`, `packages/ts/src/app/app.ts:509`, `packages/python/src/polyspec/hyper/app/app.py:512`) | 이 id로는 없음 | |
| HY-60.7 | 참 | `packages/ts/src/host/http-host.ts:77-89`, `requestLine`은 `:218-222` | `packages/ts/tests/http.test.ts`, `tests/scripts/upload-servers.test.mts` | |
| HY-60.8 | 참 | `packages/ts/src/app/app.ts:473-497`, `packages/php/src/App/App.php:402-407`, `packages/python/src/polyspec/hyper/app/app.py:465-487`; Node client error의 새 빈 reply는 `packages/ts/src/host/http-host.ts:85` | `tests/scripts/upload-servers.test.mts` | reply는 dispatch 전에 만들어지고 실패 뒤에도 보고된다. |
| HY-60.9 | 참 | `packages/ts/src/http/reply.ts:18-23`, `packages/php/src/Http/Reply.php:33-43`, `packages/python/src/polyspec/hyper/http/reply.py:30-38` | 이 id로는 없음 | map이나 dict는 한 이름의 첫 note 위치를 지킨다. |
| HY-60.10 | 참 | note는 `notes()`만 읽는다(`packages/ts/src/http/reply.ts:27-29`). 응답을 쓰는 어떤 경로도 note를 읽지 않는다 | 이 id로는 없음 | |
| HY-60.11 | 참 | `packages/ts/src/app/app.ts:476-492`, `packages/php/src/App/App.php:420-434`, `packages/python/src/polyspec/hyper/app/app.py:467-484` | `tests/scripts/upload-servers.test.mts` | |
| HY-60.12 | 참 | `packages/ts/src/host/http-host.ts:135-139` | `tests/scripts/upload-servers.test.mts` | public 파일은 `respond` 전에 돌아온다. |
| HY-60.13 | 참 | report 호출은 `respond`의 `try` 밖에 있다: `packages/ts/src/app/app.ts:495`, `packages/php/src/App/App.php:437`, `packages/python/src/polyspec/hyper/app/app.py:487` | `tests/scripts/upload-servers.test.mts` | |
| HY-60.14 | 참 | `packages/ts/src/host/http-host.ts:180-195`, `packages/php/src/App/App.php:1084-1094`와 `:517-534`, `packages/python/src/polyspec/hyper/host/_pipeline.py:189-199`, `packages/python/src/polyspec/hyper/host/asgi.py:61-107`, session open은 `packages/ts/src/app/app.ts:484` | `packages/php/tests/RunTest.php`, `packages/python/tests/test_asgi.py`, `packages/python/tests/test_wsgi.py`, `packages/ts/tests/http.test.ts`, `tests/scripts/upload-servers.test.mts` | |
| HY-60.15 | 참 | `packages/ts/src/host/http-host.ts:183-195`, `packages/php/src/App/App.php:525-532`, `packages/python/src/polyspec/hyper/host/_pipeline.py:189-199` | `tests/scripts/upload-servers.test.mts` | `frame`이 frame 정책과 `no-store`를 붙인다. |
| HY-60.16 | 참 | 빠져나온 오류의 경로는 `report`를 호출하지 않는다: `packages/ts/src/host/http-host.ts:180-195`, `packages/php/src/App/App.php:517-534`, `packages/python/src/polyspec/hyper/host/_pipeline.py:189-199` | `tests/scripts/upload-servers.test.mts` | |
| HY-60.17 | 참 | `packages/ts/src/host/http-host.ts:197-202`, `packages/php/src/App/App.php:1110-1117`, `packages/python/src/polyspec/hyper/host/_exchange.py:30-47` | `packages/php/tests/RunTest.php`, `packages/python/tests/test_asgi.py`, `packages/python/tests/test_wsgi.py`, `packages/ts/tests/http.test.ts`, `tests/scripts/upload-servers.test.mts` | `Exchange.report`와 하나의 `finally`가 각 write hook을 한 번 호출한다. |
| HY-60.18 | 참 | `packages/ts/src/host/http-host.ts:134`와 `bodySize`의 `packages/ts/src/http/request.ts:303-306`; `packages/python/src/polyspec/hyper/host/_pipeline.py:159-181`; `packages/php/src/App/App.php:1099-1107` | `packages/php/tests/RunTest.php` | |
| HY-60.19 | 참 | `packages/python/src/polyspec/hyper/host/wsgi.py:197-206`, `packages/python/src/polyspec/hyper/host/asgi.py:230-239`, `packages/python/src/polyspec/hyper/host/_exchange.py:40`; Node는 `packages/ts/src/host/http-host.ts:128-129`와 `:197` | 이 id로는 없음 | |
| HY-60.20 | 참 | `packages/ts/src/host/http-host.ts:183-186`, `packages/php/src/App/App.php:519-524`, `packages/python/src/polyspec/hyper/host/server.py:187-204` | 이 id로는 없음 | |
| HY-60.21 | 참 | `packages/ts/src/host/http-host.ts:183-195`, `packages/python/src/polyspec/hyper/host/server.py:187-204`, `packages/python/src/polyspec/hyper/host/asgi.py:102-107` | `packages/python/tests/test_asgi.py` | HY-60.33이 정하듯 PHP는 연결을 닫지 않는다. |
| HY-60.22 | 참 | `packages/python/src/polyspec/hyper/host/wsgi.py:61-66`와 `:110-132`, `packages/python/src/polyspec/hyper/host/asgi.py:61-67`와 `:85-90` | 이 id로는 없음 | |
| HY-60.23 | 참 | `packages/php/src/App/App.php:29`, `:1084-1094`, `:519-524` | 이 id로는 없음 | |
| HY-60.24 | 참 | `packages/php/src/App/App.php:1052`와 `:532`, `packages/ts/src/host/http-host.ts:318-322` | `tests/scripts/upload-servers.test.mts` | |
| HY-60.25 | 참 | `packages/php/src/App/App.php:1052`, `packages/php/src/Http/Response.php:71-80` | `tests/scripts/upload-servers.test.mts` | |
| HY-60.26 | 참 | `packages/ts/src/host/http-host.ts:318-322` | 이 id로는 없음 | `writeHead`는 `setHeader`가 앞서 둔 header를 합친다. |
| HY-60.27 | 참 | `packages/python/src/polyspec/hyper/host/wsgi.py:110-132`, `packages/python/src/polyspec/hyper/host/asgi.py:85-98` | `tests/scripts/upload-servers.test.mts` | |
| HY-60.29 | 참 | `packages/ts/src/http/reply.ts:27-29`, `packages/php/src/Http/Reply.php:51-60`, `packages/python/src/polyspec/hyper/http/reply.py:40-42` | 이 id로는 없음 | PHP는 정수 key를 다시 문자열로 바꾼다. |
| HY-60.30 | 참 | `packages/python/src/polyspec/hyper/host/server.py:187-204`와 `packages/python/src/polyspec/hyper/host/_pipeline.py:197-199` | 이 id로는 없음 | |
| HY-60.31 | 참 | `packages/ts/src/app/app.ts:462`, `packages/php/src/App/App.php:356-359`, `packages/python/src/polyspec/hyper/app/app.py:449-464` | 이 id로는 없음 | |
| HY-60.32 | 참 | `packages/ts/src/http/reply.ts:21`, `packages/php/src/Http/Reply.php:37-39`, `packages/python/src/polyspec/hyper/http/reply.py:33-36` | `packages/rust/interface.json`이 이름을 적는다. 테스트는 없음 | |
| HY-60.33 | 참 | `packages/php/src/App/App.php:520-524`와 `:1114-1115` | 이 id로는 없음 | |

## HY-100

HY-100은 각 서버가 자기 런타임의 표준 host 인터페이스로 서비스되는 방법을 정한다: PHP front controller `run`, Python callable `create_wsgi`와 `create_asgi`, 서버 `create_server`, Node listener `listener`. 이 그룹의 어떤 진술에도 `unimplemented` 표시가 없다.

| 진술 | 판정 | 판정을 정하는 코드 | 인용하는 테스트 | 메모 |
| --- | --- | --- | --- | --- |
| HY-100.1 | 참 | `packages/php/src/Host/functions.php:14`, `packages/python/src/polyspec/hyper/host/wsgi.py:38`, `packages/python/src/polyspec/hyper/host/asgi.py:36`, `packages/ts/src/host/http-host.ts:60`, `packages/ts/src/host/http-host.ts:67` | 정확한 id로는 없음. `packages/php/tests/RunTest.php:17`, `packages/ts/tests/http.test.ts:17`이 HY-100을 인용한다 | |
| HY-100.2 | 일부 참 | `packages/ts/src/host/http-host.ts:128`, `packages/ts/src/host/http-host.ts:143`, `packages/ts/src/host/http-host.ts:158`, `packages/python/src/polyspec/hyper/host/_pipeline.py:223`, `packages/php/src/App/App.php:1133`, `packages/php/src/Http/Request.php:532` | `packages/php/tests/RequestTest.php:51`, `packages/ts/tests/http.test.ts:190`, `tests/scripts/upload-servers.test.mts:578`, `tests/scripts/upload-servers.test.mts:744`, `tests/scripts/upload-servers.test.mts:755` | 어떤 host도 자기 store를 `App.handle`에 넘기지 않는다. Node는 `open` 함수와 함께 `app.respond`를, Python은 `open_session`과 함께 `App._respond`를, PHP는 `NativeSession`과 함께 private `through`를 호출한다. 나머지 조항(body 한도, 새 session의 cookie를 먼저, hook, 없는 대상의 평문 500)은 성립한다. 진술이 host가 호출하는 진입점의 이름을 적거나, host가 `App.handle`을 호출해야 한다. |
| HY-100.3 | 참 | `packages/python/src/polyspec/hyper/host/wsgi.py:38` | 정확한 id로는 없음. `packages/python/tests/test_wsgi.py:1`이 HY-100을 인용한다 | |
| HY-100.4 | 참 | `packages/python/src/polyspec/hyper/host/wsgi.py:160`, `packages/python/src/polyspec/hyper/host/wsgi.py:173`, `packages/python/src/polyspec/hyper/host/_pipeline.py:114`, `packages/python/src/polyspec/hyper/host/_pipeline.py:231` | `tests/scripts/upload-servers.test.mts:784` | Content-Length로 한도를 넘는 body는 읽지 않는다. 읽은 body에서 한도를 넘는 byte는 읽고 버리며 보관하지 않는다(`_pipeline.py:114`). |
| HY-100.5 | 참 | `packages/python/src/polyspec/hyper/host/wsgi.py:105` | 없음 | 204나 304 응답에는 Content-Length가 붙지 않는다(`wsgi.py:100`). |
| HY-100.37 | 참 | `packages/python/src/polyspec/hyper/host/_wsgi_body.py:35`, `packages/python/src/polyspec/hyper/host/_wsgi_body.py:44`, `packages/python/src/polyspec/hyper/host/_exchange.py:59` | 정확한 id로는 없음 | iterator가 마지막 chunk를 지나 진행될 때만 쓰기가 끝난 것으로 센다(`_wsgi_body.py:37`). |
| HY-100.34 | 참 | `packages/python/src/polyspec/hyper/host/_wsgi_body.py:39` | `packages/python/tests/test_wsgi.py:528`, `packages/python/tests/test_wsgi.py:600`, `packages/python/tests/test_wsgi.py:615` | |
| HY-100.35 | 참 | `packages/python/src/polyspec/hyper/host/_wsgi_body.py:40` | `packages/python/tests/test_wsgi.py:600`, `packages/python/tests/test_wsgi.py:615` | |
| HY-100.36 | 참 | `packages/python/src/polyspec/hyper/host/wsgi.py:124` | `packages/python/tests/test_wsgi.py:552` | |
| HY-100.7 | 참 | `packages/python/src/polyspec/hyper/host/wsgi.py:67`, `packages/python/src/polyspec/hyper/host/wsgi.py:80` | 없음 | 파일 응답은 평범한 list이므로 어떤 `close()`도 그것을 보고하지 않는다. |
| HY-100.8 | 참 | `packages/python/src/polyspec/hyper/host/_pipeline.py:252`, `packages/python/src/polyspec/hyper/host/wsgi.py:65`, `packages/python/src/polyspec/hyper/host/wsgi.py:110` | 없음 | |
| HY-100.9 | 참 | `packages/python/src/polyspec/hyper/host/wsgi.py:76`, `packages/python/src/polyspec/hyper/host/wsgi.py:83`, `packages/python/src/polyspec/hyper/host/wsgi.py:89`, `packages/python/src/polyspec/hyper/host/wsgi.py:125` | `packages/python/tests/test_wsgi.py:450` | |
| HY-100.10 | 참 | `packages/python/src/polyspec/hyper/host/wsgi.py:197` | 없음 | |
| HY-100.11 | 참 | `packages/python/src/polyspec/hyper/host/wsgi.py:201` | 정확한 id로는 없음. `packages/python/tests/test_request_target.py:1`이 HY-100을 인용한다 | |
| HY-100.12 | 참 | `packages/python/src/polyspec/hyper/host/wsgi.py:178`, `packages/python/src/polyspec/hyper/http/request.py:290`, `packages/python/src/polyspec/hyper/http/request.py:300`, `packages/python/src/polyspec/hyper/host/server.py:145` | 없음 | 분리는 `create_server`의 분리이고, 그 분리는 path를 `#`에서 끝내고 absolute-form 대상의 authority를 없앤다(HY-42). |
| HY-100.13 | 참 | `packages/python/src/polyspec/hyper/host/wsgi.py:197` | 없음 | `wsgi.py`의 어떤 코드도 `PATH_INFO`를 읽지 않는다. |
| HY-100.14 | 참 | `packages/python/src/polyspec/hyper/host/wsgi.py:204`, `packages/python/src/polyspec/hyper/host/wsgi.py:65`, `packages/python/src/polyspec/hyper/host/_pipeline.py:189` | 없음 | log 줄은 RuntimeError의 메시지이고, 그 메시지는 두 key를 모두 적는다. |
| HY-100.15 | 참 | `packages/python/src/polyspec/hyper/host/asgi.py:36` | 정확한 id로는 없음. `packages/python/tests/test_asgi.py:1`이 HY-100을 인용한다 | |
| HY-100.16 | 참 | `packages/python/src/polyspec/hyper/host/asgi.py:169`, `packages/python/src/polyspec/hyper/host/asgi.py:210`, `packages/python/src/polyspec/hyper/host/_pipeline.py:231` | 없음 | receive event를 끝까지 읽는다. 한도를 넘는 byte는 버리며 보관하지 않는다. |
| HY-100.17 | 참 | `packages/python/src/polyspec/hyper/host/asgi.py:204` | 없음 | |
| HY-100.38 | 참 | `packages/python/src/polyspec/hyper/host/asgi.py:91`, `packages/python/src/polyspec/hyper/host/asgi.py:102`, `packages/python/src/polyspec/hyper/host/asgi.py:118` | 없음 | `OSError`가 아닌 오류를 던지는 send는 disconnect hook 없이 쓰기를 실패로 보고한다(`asgi.py:108`). |
| HY-100.19 | 참 | `packages/python/src/polyspec/hyper/host/asgi.py:68`, `packages/python/src/polyspec/hyper/host/asgi.py:114` | 없음 | |
| HY-100.20 | 참 | `packages/python/src/polyspec/hyper/host/asgi.py:210` | 없음 | `_read_body`는 `http.request`가 아닌 첫 event에서 멈추고, 어떤 코드도 `http.disconnect`를 기다리지 않는다. |
| HY-100.21 | 참 | `packages/python/src/polyspec/hyper/host/asgi.py:72` | 없음 | |
| HY-100.22 | 참 | `packages/python/src/polyspec/hyper/host/asgi.py:1`, `packages/python/src/polyspec/hyper/host/wsgi.py:1` | 없음 | 두 모듈 모두 서버를 import하지 않는다. |
| HY-100.23 | 참 | `packages/python/src/polyspec/hyper/host/asgi.py:230`, `packages/python/src/polyspec/hyper/host/asgi.py:193` | 없음 | |
| HY-100.24 | 참 | `packages/python/src/polyspec/hyper/host/asgi.py:159` | `packages/python/tests/test_asgi.py:401` | |
| HY-100.25 | 참 | `packages/python/src/polyspec/hyper/host/asgi.py:230` | 없음 | `asgi.py`의 어떤 코드도 `scope['path']`를 읽지 않는다. |
| HY-100.26 | 참 | `packages/python/src/polyspec/hyper/host/asgi.py:235`, `packages/python/src/polyspec/hyper/host/asgi.py:65` | 없음 | |
| HY-100.39 | 참 | `packages/python/src/polyspec/hyper/host/_exchange.py:40`, `packages/python/src/polyspec/hyper/host/_exchange.py:61` | 없음 | `exchange.request`가 None이므로 `report`는 hook을 호출하지 않고 `disconnect`에는 응답이 없다. |
| HY-100.28 | 참 | `packages/ts/src/host/http-host.ts:67`, `packages/ts/src/host/http-host.ts:76` | `packages/ts/tests/http.test.ts:178` | |
| HY-100.29 | 참 | `packages/ts/src/host/http-host.ts:200` | 없음 | |
| HY-100.30 | 참 | `packages/php/src/Host/functions.php:14`, `packages/php/src/App/App.php:1080`, `packages/php/src/App/App.php:1084`, `packages/php/src/App/App.php:1087`, `packages/php/src/App/App.php:1112`, `packages/php/src/App/App.php:1119` | `tests/scripts/upload-servers.test.mts:653` | |
| HY-100.31 | 참 | `packages/ts/src/host/http-host.ts:248`, `packages/ts/src/host/http-host.ts:83`, `packages/python/src/polyspec/hyper/host/wsgi.py:146`, `packages/python/src/polyspec/hyper/host/asgi.py:152` | `packages/php/tests/RequestTest.php:14`, `packages/python/tests/test_wsgi.py:172`, `packages/python/tests/test_asgi.py:167`, `tests/scripts/upload-servers.test.mts:809` | `node:http`가 거부하는 method의 400은 `clientError` handler가 쓴다. |
| HY-100.32 | 참 | `packages/ts/src/host/http-host.ts:87` | 없음 | `node:http`가 parse하지 못하는 요청의 400이나 431은 version을 parse하지 못했으므로 hyper가 `HTTP/1.1`로 쓴다. |
| HY-100.33 | 참 | hyper 코드 없음: PHP 내장 서버가 정한다 | 없음 | SAPI의 사실이다. 이 저장소의 어떤 테스트도 인용하지 않는다. |

## HY-104

HY-104는 세 서버가 session-store 라이브러리와 core의 session 규칙으로 session을 저장하고, lock하고, 공유하고, 변환하는 방법을 정한다.

| 진술 | 판정 | 판정을 정하는 코드 | 인용하는 테스트 | 메모 |
| --- | --- | --- | --- | --- |
| HY-104.1 | 참 | `packages/ts/src/session/file-sessions.ts:18`, `packages/python/src/polyspec/hyper/session/file_sessions.py:1`, `packages/php/src/Session/NativeSession.php:127` | `tests/scripts/session-shared.test.mts`(HY-104.28로) | PHP는 `php_serialize`를 쓰는 native files handler로 디렉터리를 공유한다. |
| HY-104.2 | 참 | `packages/ts/src/session/file-sessions.ts:42`(라이브러리 `FileSessions.inDirectory`), `packages/python/src/polyspec/hyper/session/file_sessions.py:29`, `packages/php/src/Session/NativeSession.php:127` | `tests/scripts/upload-servers.test.mts`, `tests/legacy/interfaces.json` | Node와 Python에서는 라이브러리가 정한다. prefix `sess_`(`session-store@v0.0.7:packages/file/rust/src/store.rs:25`), mode 0600(`:289`), php-serialization으로 읽는 기록(`session-store@v0.0.7:packages/core/rust/src/record.rs:38`), byte가 없는 기록을 빈 session으로 보는 것(`record.rs:35`)이 그것이다. PHP에서는 PHP의 files handler가 정한다. |
| HY-104.3 | 참 | `packages/ts/src/host/http-host.ts:153`, `packages/ts/src/host/http-host.ts:160`, `packages/python/src/polyspec/hyper/host/_pipeline.py:219`, `packages/python/src/polyspec/hyper/host/_pipeline.py:226`, `packages/ts/src/app/app.ts:557` | 정확한 id로는 없음 | lock은 라이브러리의 `open`과 `close` 사이에 잡힌다. PHP는 native handler의 lock을 잡는다. |
| HY-104.7 | 참 | `session-store@v0.0.7:packages/file/rust/src/store.rs:265`, `store.rs:268`, `store.rs:253`, 호출 위치 `packages/ts/src/session/file-session.ts:73`; PHP files handler | `tests/legacy/interfaces.json` | 라이브러리는 lock 아래에서 기록을 offset 0에 쓰고 파일을 그 길이로 자르며, 바뀌지 않은 session에는 새 수정 시각을 둔다. PHP에서는 PHP가 정한다. |
| HY-104.8 | 참 | `packages/ts/src/session/file-session.ts:23`, `packages/php/src/Session/NativeSession.php:53` | `tests/legacy/interfaces.json` | |
| HY-104.10 | 참 | `session-store@v0.0.7:packages/file/rust/src/store.rs:169`, 호출 위치 `packages/ts/src/session/file-sessions.ts:59` | 없음 | 파일이 없으면 요청은 session 없이 진행된다. 새 식별자만 파일을 만든다(`store.rs:259`). |
| HY-104.11 | 참 | `packages/ts/src/session/file-session.ts:65`, `packages/php/src/Session/NativeSession.php:159` | 없음 | |
| HY-104.12 | 참 | `packages/ts/src/session/file-session.ts:71` | 없음 | |
| HY-104.13 | 참 | `packages/rust/src/session.rs:91` | `packages/rust/tests/contracts.rs`, `packages/php/tests/Support/Steps/SessionSteps.php`, `packages/ts/tests/steps/session-requests.ts` | |
| HY-104.14 | 일부 참 | `packages/rust/src/session.rs:242`, `packages/rust/src/session.rs:256` | `packages/rust/tests/contracts.rs`, `packages/rust/tests/rules.rs`, `tests/scripts/node-core.test.mts` | Node와 Python에서 쓰기는 `O:8:"stdClass"`를 만들고(`php-serialization@v0.0.16:packages/rust/src/write.rs:166`), 읽기는 다른 class를 오류 `class`로 거부하며(`php-serialization@v0.0.16:packages/rust/src/read.rs:460`), 라이브러리는 그것을 기록 오류로 돌려준다(`session-store@v0.0.7:packages/core/rust/src/record.rs:38`). PHP 서버는 PHP 자신의 session decoder로 읽고 저장된 값을 class 검사 없이 돌려주므로(`packages/php/src/Session/NativeSession.php:136`), 거기서는 다른 class의 object가 실패하지 않는다. |
| HY-104.34 | 참 | `packages/rust/src/session.rs:177`, `packages/rust/src/session.rs:192` | 정확한 id로는 없음 | |
| HY-104.39 | 참 | `packages/rust/src/session.rs:194`(`value == 0.0`이 0을 준다) | 없음 | |
| HY-104.15 | 참 | `packages/ts/src/session/file-sessions.ts:63`, `packages/python/src/polyspec/hyper/session/file_sessions.py:37`, `session-store@v0.0.7:packages/file/rust/src/store.rs:218` | 없음 | 삭제는 기다리지 않고 lock을 잡으며, 다른 요청이 lock을 쥐고 있으면 그 파일을 건너뛴다(`store.rs:220`). |
| HY-104.33 | 일부 참 | `packages/ts/src/session/file-sessions.ts:65`, `packages/python/src/polyspec/hyper/session/file_sessions.py:37`, `packages/php/src/Session/NativeSession.php:114` | 없음 | Python은 메서드 이름을 public이 아닌 `_collect`로 둔다. PHP에는 `collect`가 없고 그 옵션은 `gc_probability`를 0으로 두지 않으므로, native handler가 요청 중에 우연히 만료된 파일을 지울 수 있다. |
| HY-104.28 | 참 | `tests/scripts/session-shared.test.mts` | 자기 자신 | |
| HY-104.29 | 참 | `packages/ts/src/session/file-sessions.ts:22`, `packages/python/src/polyspec/hyper/session/file_sessions.py:7`, `session-store@v0.0.7:packages/file/rust/src/turns.rs:59`, `session-store@v0.0.7:packages/file/rust/src/store.rs:157`, `store.rs:172` | 없음 | 라이브러리는 lock 전에 요청을 queue에 넣고(`store.rs:157`), 취소된 요청을 queue에서 뺀다(`turns.rs:58`). lock을 기다리는 동안 취소된 요청은 파일을 놓아 lock을 푼다(`store.rs:173`). |
| HY-104.31 | 거짓 | `packages/ts/src/session/record-session.ts:8`, `packages/ts/src/session/record-session.ts:77`, `packages/python/src/polyspec/hyper/session/_record_session.py:16`, `packages/python/src/polyspec/hyper/session/_record_session.py:75`, `packages/php/src/Session/NativeSession.php:39` | `tests/legacy/interfaces.json` | 모든 서버는 store가 cookie를 보기 전에 22자에서 128자만 받는다. 라이브러리는 22자에서 256자를 받고(`session-store@v0.0.7:packages/core/rust/src/identifier.rs:7`, `:8`, `:14`), PHP도 같다(`php-src@php-8.4.27:ext/session/session.c:75`, `:791`, `:380`). hyper의 core에는 식별자 검사가 없다. |
| HY-104.32 | 일부 참 | `packages/ts/src/session/file-sessions.ts:38`, `packages/python/src/polyspec/hyper/session/file_sessions.py:24` | `packages/ts/tests/steps/file-sessions.ts`, `packages/rust/tests/cases/faults.json` | PHP에는 파일 store class가 없다(`packages/php/src/App/App.php:1132`는 `NativeSession`을 쓴다). php에 대해 H35.37로 표시되었다. |
| HY-104.20 | 참 | `packages/rust/src/session.rs:311` | `tests/legacy/interfaces.json` | |
| HY-104.21 | 참 | `session-store@v0.0.7:packages/file/rust/src/store.rs:43`, `store.rs:181`, `store.rs:224`; PHP `session.gc_maxlifetime` | 없음 | 만료된 파일을 열면 session이 없고, 삭제는 만료된 파일만 지운다. PHP에서는 PHP가 정한다. |
| HY-104.22 | 참 | `packages/ts/src/session/session.ts:9`, `packages/php/src/Session/Session.php:14`, `packages/rust/src/session.rs:17` | `packages/php/tests/CoreRulesTest.php`, `packages/python/tests/test_core_rules.py`, `tests/scripts/node-core.test.mts` | |
| HY-104.23 | 참 | `packages/rust/src/session.rs:424`, `packages/rust/src/session.rs:444` | `packages/rust/tests/contracts.rs`, `packages/rust/tests/rules.rs`, `packages/rust/tests/cases/faults.json` | |
| HY-104.36 | 참 | `packages/rust/src/error.rs:180`, `packages/rust/src/session.rs:424` | 정확한 id로는 없음 | |
| HY-104.35 | 참 | `packages/ts/src/session/session.ts:75`, `packages/rust/src/session.rs:484` | 없음 | |
| HY-104.37 | 일부 참 | `packages/ts/src/session/session-store.ts:5` | `tests/scripts/upload-servers.test.mts` | Node 인터페이스는 값이 없는 key에 대해 null이 아니라 `undefined`를 돌려준다. |
| HY-104.25 | 일부 참 | `packages/ts/src/session/file-sessions.ts:3`, `packages/python/src/polyspec/hyper/session/file_sessions.py:15`, `packages/rust/src/session.rs:1` | 없음 | PHP는 라이브러리의 store 인터페이스가 아니라 `NativeSession`으로 저장한다. php에 대해 H35.37로 표시되었다. |
| HY-104.26 | 거짓 | `packages/php/src/App/App.php:1132`, `packages/php/src/Session/NativeSession.php:54` | `tests/legacy/file-store-sessions.json` | PHP는 native session handler를 쓴다. php에 대해 H35.37로 표시되었다. |
| HY-104.27 | 일부 참 | `packages/ts/src/session/file-sessions.ts:22`, `packages/python/src/polyspec/hyper/session/file_sessions.py:7` | 없음 | PHP는 `session_start`에서 기다린다. php에 대해 H35.37로 표시되었다. |
| HY-104.38 | 일부 참 | `packages/ts/src/app/app.ts:572`, `packages/python/src/polyspec/hyper/app/app.py:610` | `packages/ts/tests/session-routes.test.ts`, `packages/python/tests/test_session_routes.py` | PHP는 라우트의 `session` 멤버를 읽지 않는다. php에 대해 H35.37로 표시되었다. |
| HY-104.40 | 거짓 | `packages/ts/src/host/http-host.ts:153`, `packages/python/src/polyspec/hyper/host/_pipeline.py:219` | 없음 | host는 core의 멤버가 아니라 라이브러리로 session을 직접 열고 닫는다. H35.38-1로 표시되었다. |

## HY-113

HY-113은 `multipart/form-data` body의 어떤 part가 파일인지와 요청이 파일을 주는 방법을 정한다.

| 진술 | 판정 | 판정을 정하는 코드 | 인용하는 테스트 | 메모 |
| --- | --- | --- | --- | --- |
| HY-113.21 | 참 | `packages/ts/src/form/multipart.ts:106`, `packages/php/src/Form/Multipart.php:152`, `packages/python/src/polyspec/hyper/form/_multipart.py:101` | `tests/legacy/interfaces.json` | 매개변수 `filename`만 읽는다. |
| HY-113.23 | 일부 참 | `packages/ts/src/form/multipart.ts:106`, `packages/php/src/Form/Multipart.php:152`, `packages/python/src/polyspec/hyper/form/_multipart.py:101` | 없음 | 서버는 http-form의 F-23, F-6, F-16이 아니라 자기 reader로 part를 읽는다. H35.11로 표시되었다. |
| HY-113.24 | 일부 참 | `packages/ts/src/form/request-body.ts:25`, `packages/ts/src/app/app.ts:778`, `packages/php/src/App/App.php:978`, `packages/python/src/polyspec/hyper/app/app.py:922` | 없음 | boundary가 없으면 reader를 시작하지 않지만, 서버 코드는 `malformed_content_type`을 거부로 다루지 않는다(`app.ts:778`이 null을 돌려준다). H35.11로 표시되었다. |
| HY-113.25 | 거짓 | 없음 | 없음 | 어떤 서버 코드도 http-form의 kind `invalid`나 `header_limit`를 쓰지 않는다. H35.11로 표시되었다. |
| HY-113.2 | 참 | `packages/ts/src/http/request.ts:284`, `packages/php/src/Http/Request.php:427`, `packages/python/src/polyspec/hyper/http/request.py:260` | `packages/ts/tests/steps/request.ts`, `packages/php/tests/Support/Steps/RequestSteps.php`, `packages/python/tests/steps/request_steps.py` | |
| HY-113.8 | 참 | `packages/ts/src/form/uploaded-file.ts:41`, `packages/php/src/Form/UploadedFile.php:48`, `packages/python/src/polyspec/hyper/form/uploaded_file.py:34`, `packages/ts/src/index.ts:10`, `packages/python/src/polyspec/hyper/__init__.py:25` | 정확한 id로는 없음 | |

## HY-114

HY-114는 애플리케이션의 파일 한도로 업로드한 파일 하나의 byte를 제한한다.

| 진술 | 판정 | 판정을 정하는 코드 | 인용하는 테스트 | 메모 |
| --- | --- | --- | --- | --- |
| HY-114.1 | 참 | `packages/ts/src/app/app.ts:92`, `packages/php/src/App/App.php:140`, `packages/python/src/polyspec/hyper/app/app.py:245` | 없음 | |
| HY-114.2 | 참 | `packages/ts/src/app/app.ts:262`, `packages/ts/src/app/app.ts:264`, `packages/php/src/App/App.php:138`, `packages/php/src/App/App.php:160`, `packages/python/src/polyspec/hyper/app/app.py:272` | 없음 | |
| HY-114.3 | 참 | `packages/ts/src/app/app.ts:264`, `packages/php/src/App/App.php:160`, `packages/python/src/polyspec/hyper/app/app.py:271` | 없음 | |
| HY-114.4 | 참 | `packages/ts/src/app/app.ts:264`, `packages/php/src/App/App.php:160`, `packages/python/src/polyspec/hyper/app/app.py:271` | 없음 | 기본값은 최대 body 한도이므로 HY-114.6의 검사는 기본값에서 실패할 수 없다. |
| HY-114.11 | 참 | `packages/ts/src/form/multipart.ts:140`, `packages/php/src/Form/Multipart.php:198`, `packages/python/src/polyspec/hyper/form/_multipart.py:142` | 없음 | 한도를 넘는 파일은 body 읽기를 끝낸다. 그 파일의 어떤 부분도 넘기지 않는다. |
| HY-114.6 | 참 | `packages/ts/src/app/app.ts:265`, `packages/php/src/App/App.php:161`, `packages/python/src/polyspec/hyper/app/app.py:273` | 없음 | |
| HY-114.7 | 참 | `packages/ts/src/app/app.ts:533`, `packages/ts/src/app/app.ts:700`, `packages/ts/src/app/app.ts:808`, `packages/ts/src/http/request.ts:148`, `packages/php/src/App/App.php:544`, `packages/php/src/App/App.php:847`, `packages/php/src/App/App.php:1014` | 없음 | |
| HY-114.12 | 참 | `packages/ts/src/http/request.ts:297`, `packages/ts/src/app/core-rules.ts:537`, `packages/php/src/App/CoreRules.php:240` | `packages/rust/tests/rules.rs:390`, `packages/ts/tests/steps/request.ts:119`, `packages/php/tests/CoreRulesTest.php:65`, `packages/php/tests/Support/Steps/RequestSteps.php:50`, `packages/python/tests/test_core_rules.py:137`, `packages/python/tests/steps/request_steps.py:29`, `tests/scripts/node-core.test.mts:126` | |

## HY-115

HY-115는 Redis 서버 하나, Sentinel 그룹, cluster의 session을 phpredis 6.3.0의 프로토콜로 세 서버가 공유하게 한다.

Node와 Python 서버는 Redis store를 session-store 라이브러리에 넘기고(`packages/ts/src/session/redis-sessions.ts:50`, `packages/python/src/polyspec/hyper/session/redis_sessions.py:47`), 그 라이브러리가 `session-store@v0.0.7:packages/redis/rust/src/protocol.rs`에서 key, lock, 만료, 해제를 정하고, `session-store@v0.0.7:packages/redis/rust/src/connection.rs`에서 연결을 정한다. 그 위치는 각 행에 적는다. PHP 서버는 phpredis의 session handler(`packages/php/src/Session/NativeSession.php:53`)와 Redis Cluster를 위한 자기 handler(`packages/php/src/Session/RedisClusterSessions.php`)를 쓴다.

| 진술 | 판정 | 판정을 정하는 코드 | 인용하는 테스트 | 메모 |
| --- | --- | --- | --- | --- |
| HY-115.1 | 참 | `packages/ts/src/session/redis-sessions.ts:50`, `packages/python/src/polyspec/hyper/session/redis_sessions.py:47`, `packages/php/src/Session/NativeSession.php:127`, `session-store@v0.0.7:packages/redis/rust/src/protocol.rs:2` | `tests/scripts/session-shared-redis.test.mts`(HY-115를 인용) | 라이브러리는 자기 명령의 순서를 phpredis와의 인터페이스로 정한다. |
| HY-115.2 | 참 | `packages/python/src/polyspec/hyper/session/redis_sessions.py:43`, `packages/php/src/Session/RedisClusterSessions.php:101`, `packages/php/src/Session/RedisClusterSessions.php:33`, `session-store@v0.0.7:packages/redis/rust/src/protocol.rs:41`, `protocol.rs:402` | 없음 | 라이브러리는 key `PHPREDIS_SESSION:<id>`를 `SETEX`와 수명으로 쓴다. |
| HY-115.3 | 참 | `packages/php/src/Session/RedisClusterSessions.php:63`, `packages/php/src/Session/NativeSession.php:53`, `packages/php/src/App/App.php:420`, `session-store@v0.0.7:packages/redis/rust/src/protocol.rs:286`, `protocol.rs:300`, `protocol.rs:328` | 없음 | 라이브러리는 `<key>_LOCK`을 `SET NX PX`로 잡고, 거부되면 `lock_wait`만큼 기다리며, 시도가 끝나면 `LockTimeout`으로 실패한다(`protocol.rs:330`). |
| HY-115.4 | 참 | `packages/php/src/Session/RedisClusterSessions.php:12`, `packages/php/src/Session/RedisClusterSessions.php:17`, `session-store@v0.0.7:packages/redis/rust/src/protocol.rs:342` | `packages/ts/tests/steps/session-requests.ts:72` | 라이브러리는 lock 뒤에 key를 읽고, 사라진 key에는 session을 주지 않는다. |
| HY-115.5 | 참 | `packages/php/src/Session/RedisClusterSessions.php:26`, `packages/php/src/Session/RedisClusterSessions.php:33`, `session-store@v0.0.7:packages/redis/rust/src/protocol.rs:419`, `protocol.rs:434`, `protocol.rs:437` | 없음 | 라이브러리는 `SETEX` 전에 lock 값을 자기 secret과 비교하고, 쓰지 않고 `LockLost`로 실패한다. |
| HY-115.23 | 일부 참 | `packages/ts/src/host/http-host.ts:160`, `packages/python/src/polyspec/hyper/host/_pipeline.py:226`, `session-store@v0.0.7:packages/redis/rust/src/protocol.rs:437` | 없음 | Node와 Python 서버는 응답을 쓰기 전에 session을 닫고, lock을 잃었으면 닫기가 `LockLost`로 실패한다. PHP 서버는 `packages/php/src`에서 `session_write_close`를 호출하지 않으므로, PHP는 script 끝, 즉 응답 뒤에 session을 쓰고, 잃은 lock이 상태 코드를 바꿀 수 없다. |
| HY-115.7 | 참 | `packages/php/src/Session/RedisClusterSessions.php:80`, `session-store@v0.0.7:packages/redis/rust/src/protocol.rs:412` | 없음 | 라이브러리는 바뀌지 않은 session에 `EXPIRE`를 보내고 lock을 비교하지 않는다. |
| HY-115.8 | 참 | `packages/php/src/Session/RedisClusterSessions.php:14`, `packages/php/src/Session/RedisClusterSessions.php:84`, `session-store@v0.0.7:packages/redis/rust/src/protocol.rs:12`, `protocol.rs:180` | 없음 | 라이브러리는 secret을 가질 때만 key를 지우는 script로 lock을 푼다. |
| HY-115.24 | 참 | `packages/php/src/Session/NativeSession.php:127` | 없음 | phpredis 상대에 대한 조건이다. `tests/scripts/fixtures/session-worker/worker.php:52`는 `HYPER_SESSION_RETRIES`가 없으면 `redis.session.lock_retries` -1로 PHP worker를 실행하고, 이 진술은 그 설정을 제외한다. |
| HY-115.29 | 일부 참 | `packages/ts/src/session/redis-sessions.ts:16`, `packages/python/src/polyspec/hyper/session/redis_sessions.py:37`, `session-store@v0.0.7:packages/redis/rust/src/protocol.rs:22`, `protocol.rs:86` | 없음 | 라이브러리는 `lock_retries`와 `lock_wait`를 store의 옵션으로 받는다. PHP에 대해 `unimplemented` H35.37로 표시되었다. PHP 서버는 설정을 store의 옵션이 아니라 phpredis의 ini 값과 `RedisClusterSessions`에서 받는다. |
| HY-115.11 | 일부 참 | `packages/php/src/Session/NativeSession.php:159`, `session-store@v0.0.7:packages/redis/rust/src/protocol.rs:402`, `protocol.rs:447` | 없음 | Node와 Python은 새 key를 `SETEX`로 쓴 뒤 옛 key를 `DEL`로 지운다. PHP 갱신은 `session_regenerate_id(true)`를 호출하고, 이 함수는 옛 session을 먼저 없애고(`php-src@php-8.4.27:ext/session/session.c:2415`) 새 session은 요청 끝에 쓴다. |
| HY-115.12 | 참 | `packages/php/src/Session/NativeSession.php:48`, `packages/php/src/Session/NativeSession.php:53` | `tests/scripts/session-redis-failure.test.mts`(HY-115를 인용) | |
| HY-115.13 | 참 | `tests/scripts/session-shared-redis.test.mts`, `tests/scripts/session-redis-failure.test.mts:59` | 자기 자신 | 실패 테스트는 SIGKILL로 프로세스를 죽인다(`tests/scripts/session-redis-failure.test.mts:62`). |
| HY-115.26 | 참 | `packages/php/src/Session/RedisSentinelSessions.php:34`, `packages/ts/src/session/redis-sessions.ts:8`, `session-store@v0.0.7:packages/redis/rust/src/connection.rs:258`, `connection.rs:264` | `tests/scripts/session-redis-failover.test.mts`(HY-115를 인용) | 라이브러리는 각 요청의 시작에 Sentinel에게 primary를 묻는다. |
| HY-115.16 | 참 | `packages/php/src/Session/RedisSentinelSessions.php:45` | `tests/scripts/session-redis-failover.test.mts`(HY-115를 인용) | |
| HY-115.17 | 참 | `packages/ts/src/session/redis-sessions.ts:8`, `packages/python/src/polyspec/hyper/session/redis_sessions.py:18`, `packages/php/src/Session/RedisSentinelSessions.php:19`, `packages/php/src/Session/RedisClusterSessions.php:36`, `session-store@v0.0.7:packages/redis/rust/src/connection.rs:20`, `connection.rs:197`, `connection.rs:209` | `tests/scripts/session-redis-failover.test.mts:1`(HY-115를 인용) | 라이브러리는 scheme `rediss://`로 TLS를, 주소에서 ACL 사용자를 받고, Sentinel에는 그 사용자와 인증서를 준다. |
| HY-115.18 | 참 | `tests/scripts/session-redis-failover.test.mts:53` | 자기 자신 | |
| HY-115.27 | 참 | `packages/php/src/Session/RedisClusterSessions.php:8`, `packages/php/src/Session/RedisClusterSessions.php:52`, `session-store@v0.0.7:packages/redis/rust/src/connection.rs:37`, `connection.rs:44` | `tests/scripts/session-redis-cluster.test.mts:169`(HY-115를 인용) | 라이브러리는 cluster 연결로 프로토콜을 말한다. |
| HY-115.20 | 참 | `tests/scripts/session-redis-cluster.test.mts:188` | 자기 자신 | |
| HY-115.28 | 일부 참 | `packages/ts/src/session/redis-sessions.ts:21`, `packages/python/src/polyspec/hyper/session/redis_sessions.py:41`, `session-store@v0.0.7:packages/redis/rust/src/protocol.rs:58`, `protocol.rs:62` | 없음 | 라이브러리는 수명 0을 `InvalidLifetime`으로, lock 만료 0을 `InvalidLockExpire`로 실패시키고, lock 만료에 기본값을 두지 않는다. PHP에 대해 `unimplemented` H35.37로 표시되었다. `RedisClusterSessions`는 `lockExpire`에 기본값 30을 준다(`packages/php/src/Session/RedisClusterSessions.php:32`). |
| HY-115.22 | 참 | `packages/php/src/Session/RedisClusterSessions.php:63`, `session-store@v0.0.7:packages/redis/rust/src/protocol.rs:328` | 없음 | 라이브러리는 한 번 시도한 뒤 `lock_retries`번 더 시도한다. |

## HY-131

HY-131은 서버가 `multipart/form-data` body를 chunk 단위로 읽는 방법, 값·part·파일 한도, 임시 파일, 검사 순서를 정한다. 테스트는 HY-131.14(`packages/ts/tests/http.test.ts`, `packages/php/tests/RunTest.php`, `packages/python/tests/transport.py`)를 빼고 그룹 id나 폐기된 id(HY-131.1, HY-131.5, HY-131.7에서 HY-131.13, HY-131.15, HY-131.16, HY-131.21)만 인용한다. 그룹 테스트: `tests/scripts/upload-servers.test.mts`, `tests/scripts/multipart-compare.test.mts`, `packages/ts/tests/steps/fields.ts`, `packages/php/tests/Support/Steps/FieldsSteps.php`, `packages/python/tests/steps/fields_steps.py`.

| 진술 | 판정 | 판정을 정하는 코드 | 인용하는 테스트 | 메모 |
| --- | --- | --- | --- | --- |
| HY-131.26 | 참 | `packages/ts/src/form/request-body.ts:37`, `packages/ts/src/form/multipart.ts:74`, `packages/php/src/Form/RequestBody.php:50`, `packages/python/src/polyspec/hyper/form/_request_body.py:45` | 그룹만 | 서버는 http-form F-24의 reader가 아니라 자기 reader를 쓴다. 첫 실패의 순서는 byte를 넣는 순서에서 나온다. |
| HY-131.27 | 참 | `packages/ts/src/app/app.ts:268`, `packages/ts/src/app/app.ts:533`, `packages/php/src/App/App.php:168` | 없음 | |
| HY-131.8 | 참 | `packages/ts/src/app/app.ts:268`, `packages/php/src/App/App.php:168`, `packages/python/src/polyspec/hyper/app/app.py:278` | 없음 | |
| HY-131.9 | 참 | `packages/ts/src/app/app.ts:272`, `packages/php/src/App/App.php:143`, `packages/python/src/polyspec/hyper/app/app.py:248` | 없음 | |
| HY-131.10 | 참 | `packages/ts/src/app/app.ts:269`, `packages/ts/src/app/app.ts:273`, `packages/php/src/App/App.php:169`, `packages/php/src/App/App.php:176` | 없음 | |
| HY-131.32 | 참 | `packages/ts/src/form/request-body.ts:40`, `packages/ts/src/host/http-host.ts:291`, `packages/ts/src/form/multipart.ts:100`, `packages/ts/src/form/multipart.ts:119` | 그룹만 | |
| HY-131.30 | 거짓 | `packages/ts/src/form/multipart.ts:85` | 없음 | `unimplemented` H35.11로 표시되었다. 어떤 서버도 kind `body_limit`, `value_limit`, `part_limit`, `file_limit`로 실패하지 않는다. reader는 boolean을 돌려준다. |
| HY-131.28 | 일부 참 | `packages/ts/src/form/uploaded-file.ts:65`, `packages/ts/src/form/uploaded-file.ts:74`, `packages/php/src/Form/UploadedFile.php:99` | 없음(코드는 폐기된 HY-131.15, HY-131.16을 인용) | `unimplemented` H35.11로 표시되었다. 파일은 요청 디렉터리에 쓰이고 이동과 읽기는 동작하지만, 실패는 http-form의 kind `exists`와 `moved`가 없는 `RangeError`다. |
| HY-131.14 | 참 | `packages/ts/src/host/http-host.ts:207`, `packages/php/src/App/App.php:1126`, `packages/python/src/polyspec/hyper/host/asgi.py:120`, `packages/python/src/polyspec/hyper/host/server.py:88` | `packages/ts/tests/http.test.ts`, `packages/php/tests/RunTest.php`, `packages/python/tests/transport.py` | |
| HY-131.31 | 참 | `packages/rust/src/pipeline.rs:1`, `packages/ts/src/host/http-host.ts:305`, `packages/ts/src/app/app.ts:697` | 없음 | 순서는 core의 `Step` enum이다. 서버는 자기 코드로 그 순서를 따른다. |
| HY-131.29 | 거짓 | `packages/ts/src/host/http-host.ts:305` | 없음 | `unimplemented` H35.36-2로 표시되었다. `Number(content-length ?? 0)`은 숫자가 아닌 값을 `NaN`으로 만들어 통과시키고, 어떤 서버도 400 `invalid_content_length`로 응답하지 않는다. |
| HY-131.19 | 참 | 코드 없음: 규칙은 시간 한도를 주지 않는다 | 없음 | 범위의 진술이다. `docs/operations/deployment.md`가 앞단의 서버를 적는다. |
| HY-131.33 | 참 | `packages/ts/src/host/http-host.ts:290`, `packages/php/src/Http/Request.php:600`, `packages/python/src/polyspec/hyper/host/_pipeline.py:125` | 없음 | Node는 `written()`이 resolve될 때까지 stream을 멈춘다. |

## HY-133

HY-133은 외부 redirect를 정한다: location의 문법, 응답, location의 origin. 테스트는 `packages/rust/tests/contracts.rs`(HY-133.2, HY-133.5, HY-133.13)를 빼고 그룹 id만 인용한다. 그룹 테스트: `packages/ts/tests/steps/result.ts`, `packages/ts/tests/steps/app.ts`, `packages/php/tests/Support/Steps/ResultSteps.php`, `packages/python/tests/steps/result_steps.py`, `tests/e2e/board.spec.ts`.

| 진술 | 판정 | 판정을 정하는 코드 | 인용하는 테스트 | 메모 |
| --- | --- | --- | --- | --- |
| HY-133.1 | 참 | `packages/ts/src/result/result.ts:35`, `packages/php/src/Result/Result.php:48`, `packages/python/src/polyspec/hyper/result/result.py:48`, `packages/ts/src/result/redirect.ts:10` | 그룹만 | |
| HY-133.2 | 참 | `packages/ts/src/result/result.ts:9`, `packages/php/src/Result/Result.php:17`, `packages/python/src/polyspec/hyper/result/result.py:13`, `packages/rust/src/location.rs:65` | `packages/rust/tests/contracts.rs` | 각 서버는 문법의 자기 복사본을 가진다. 서버는 core 함수를 호출하지 않는다. |
| HY-133.3 | 참 | `packages/ts/src/result/result.ts:43`, `packages/php/src/Result/Result.php:65`, `packages/python/src/polyspec/hyper/result/result.py:58` | 그룹만 | URL parser가 아니라 정규식이다. |
| HY-133.4 | 참 | `packages/ts/src/result/result.ts:9` | 없음 | 이유다. 문법은 `//`와 host가 있는 `http`와 `https`만 받는다. |
| HY-133.5 | 참 | `packages/ts/src/result/result.ts:37`, `packages/php/src/Result/Result.php:51`, `packages/python/src/polyspec/hyper/result/result.py:50`, `packages/rust/src/error.rs:309` | `packages/rust/tests/contracts.rs` | |
| HY-133.6 | 참 | `packages/ts/src/app/app.ts:751`, `packages/php/src/App/App.php:938`, `packages/python/src/polyspec/hyper/app/app.py:891` | 그룹만 | 문서 요청은 `wantsJson()`이다. |
| HY-133.7 | 참 | `packages/ts/src/app/app.ts:755` | 없음 | HY-133.6의 이유다. |
| HY-133.8 | 참 | `packages/ts/src/app/app.ts:753`, `packages/php/src/App/App.php:941`, `packages/python/src/polyspec/hyper/app/app.py:897` | 없음 | |
| HY-133.9 | 참 | `packages/ts/src/app/app.ts:754`, `packages/php/src/App/App.php:945`, `packages/python/src/polyspec/hyper/app/app.py:900` | 없음 | |
| HY-133.10 | 참 | `packages/ts/src/result/result.ts:70`, `packages/ts/src/result/result.ts:97`, `packages/php/src/Result/Result.php:167`, `packages/rust/src/error.rs:310` | 없음 | 거부가 인자 검사보다 먼저 실행된다. |
| HY-133.11 | 참 | `packages/ts/src/result/redirect.ts:13`, `packages/ts/src/app/app.ts:722` | 없음 | |
| HY-133.12 | 참 | `packages/ts/src/app/app.ts:717`, `packages/ts/src/app/app.ts:722` | 없음 | 외부 redirect는 모든 redirect 결과의 경로를 탄다. |
| HY-133.13 | 참 | `packages/ts/src/result/result.ts:43`, `packages/php/src/Result/Result.php:65`, `packages/python/src/polyspec/hyper/result/result.py:58`, `packages/rust/src/location.rs:134` | `packages/rust/tests/contracts.rs` | |
