<!-- doc-id: deployment -->
<!-- source-sha256: 9ce643ff7ca0ece7a342ccea929f9278936183ca41dab0e23aa0b525c13f1cfb -->
# 배포

[English](deployment.md).

애플리케이션 하나를 두 가지 형태로 배포할 수 있다. 두 형태는 같은 매니페스트, 템플릿, 클라이언트 번들, handler를 사용하고 PHP·Node.js·Python server가 같다.

| 형태 | 첫 문서 | 이후 이동 | 용도 |
|---|---|---|---|
| 서버와 CDN(권장) | 서버가 렌더한다(SSR) | JSON을 받아 브라우저가 렌더한다 | 서버가 HTML을 렌더할 수 있는 모든 애플리케이션 |
| 정적 셸 | 브라우저가 `/api` JSON으로 렌더한다(CSR) | JSON을 받아 브라우저가 렌더한다 | JSON만 제공하는 백엔드 |

## 서버와 CDN(권장)

서버는 요청 헤더로 두 종류의 요청을 구분한다(HY-15).
- **직접 요청:** 주소창 입력, 새로고침, 북마크, 검색 크롤러, 링크 미리보기 봇의 요청이다. `HX-Request`가 없으며 완성된 문서를 받는다.
- **htmx 요청:** 페이지 안에서 htmx가 보내는 요청이다. `Accept: application/json`과 `HX-Request`를 가지며 JSON을 받고, 브라우저가 이를 렌더한다.

따라서 검색엔진과 링크 미리보기는 언제나 제목이 들어 있는 완성된 문서를 받는다.

| 경로 패턴 | 오리진 | 동작 |
|---|---|---|
| `/assets/*` | `public/assets`를 담은 S3 버킷 | `GET`과 `HEAD`. 클라이언트 스크립트와 템플릿 파일은 이름에 내용 해시가 들어 있다: `Cache-Control: public, max-age=31536000, immutable`. |
| 기본값(`*`) | PHP 서버 | 모든 메서드를 허용하고 캐시하지 않는다. `Cookie`(세션 쿠키와 `__Host-hy-keep`), `Accept`, `HX-Request`, `HX-Current-URL`, `Content-Type` 헤더와 쿼리 문자열을 전달한다. |

PHP는 기본 경로 없이 실행한다. 응답에는 `Vary: Accept, HX-Request, HX-Current-URL`이 붙는다.

`make server`가 만든 `build/server`를 PHP 코드와 함께 배포한다. 애플리케이션은 `App::open(program: ...)`으로 이 디렉터리를 연다. 가장 빠르게 렌더하려면 서버의 PHP 버전에 맞춰 `make ext`로 네이티브 템플릿 확장을 빌드하고, `php.ini`의 `extension` 설정으로 불러온다. 확장이 없으면 PHP는 `build/server/php/`의 generated 프로그램으로 렌더하며, 애플리케이션은 Composer의 autoload가 그것을 불러오도록 `composer.json`의 `autoload.psr-4`에서 그 네임스페이스를 그 디렉터리에 연결한다(HY-48).

## 정적 셸

`make assets`는 `examples/board/build/csr/`를 만든다. 클라이언트 진입 파일을 인라인하고 스타일시트는 담지 않은 `index.html`(HYC-16), 템플릿마다 파일 하나를 담은 `assets/templates/`, 그리고 렌더한 layout이 link하고 브라우저가 페이지를 보이기 전에 적용하는 스타일시트 `assets/app.css`와 `assets/reader.css`다(HYC-15). `make assets`는 `--static`으로 `public/assets/`의 이 둘을 밝힌다.

1. S3 버킷에 다음과 같이 올린다.
   - `index.html`: `Content-Type: text/html; charset=utf-8`, `Cache-Control: no-cache`
   - `assets/templates/*`: `Content-Type: application/json`, `Cache-Control: public, max-age=31536000, immutable`
   - `assets/*.css`: 이름에 해시가 없으므로 `Content-Type: text/css; charset=utf-8`, `Cache-Control: no-cache`
2. PHP를 환경 변수 `BOARD_BASE_PATH=/api`로 실행한다(HY-8).
3. 라우팅을 다음과 같이 설정한다.
   - `/api/*`: 위 표와 같이 PHP로 보낸다.
   - `/assets/*`: S3로 보낸다.
   - 그 밖의 모든 경로: 뷰어 요청 단계의 CloudFront Function으로 `/index.html`로 보낸다.
4. 인라인한 진입 파일을 해시로, 조각 파일과 link한 스타일시트를 `'self'`로 허용하는 Content Security Policy를 보낸다. 그 정책은 `make assets`가 출력한다. 조각 파일 `assets/hyper-chunk-*.js`는 이름에 해시가 있으므로 `Content-Type: text/javascript; charset=utf-8`, `Cache-Control: public, max-age=31536000, immutable`로 올린다.

모든 페이지 경로가 같은 빈 셸을 반환한다. 그래서 JavaScript를 실행하지 않는 검색 크롤러와 링크 미리보기 봇은 내용도 제목도 보지 못한다. 이 형태는 그런 노출이 필요 없는 화면에만 쓴다.

## 두 형태를 한 서버로

어느 구현의 서버 하나가 한 매니페스트의 서버 렌더 페이지와 클라이언트 렌더 페이지를 같은 handler로 응답할 수 있다(HY-62). 애플리케이션은 열 때 클라이언트 렌더를 선언한다. PHP에서는 `App::open(clientRendering: new ClientRendering(shell: '/srv/app/build/csr/index.html', basePath: '/_props', selects: fn (Request $request): Choice => new Choice(chosen: ..., value: ...)))`, Node에서는 `App.open`의 `clientRendering` 옵션 `{ shell, basePath, selects }`, Python에서는 `client_rendering=ClientRendering(shell='/srv/app/build/csr/index.html', base_path='/_props', selects=...)`다. 선택은 예를 들어 `Host` header로 클라이언트 렌더 요청을 고르고, host에 저장된 service 같은 그 값은 PHP의 `$request->selection()`과 Node·Python의 `request.selection()`으로 요청의 모든 loader와 action에 전달되므로 handler가 그 값을 다시 읽지 않는다. 셸이 데이터 기본 경로를 선언하도록 `@polyspec/hyper-build`의 `hyper-build-assets --api /_props`로 셸을 build한다. 그렇지 않으면 애플리케이션 열기가 실패한다.

| 선택이 고른 페이지의 요청 | 응답 |
|---|---|
| 페이지 경로의 HTML `GET` | 셸, `Cache-Control: no-cache`, 세션과 loader 없음 |
| `/_props` 아래의 JSON 요청이나 액션 | 서버 형태와 같은 JSON과 액션, `/_props` 아래의 `Location` |
| `/_props` 아래의 HTML 요청, 그 밖의 JSON 요청 | 406 |

선택이 고르지 않은 요청은 서버 형태처럼 응답한다. 셸 응답은 `frame-ancestors`(HY-45)를 가지며 응답 hook(HY-60)에 보고된다. 브라우저는 `html` 요소에 렌더한 layout의 `lang` 같은 속성을 준다(HYC-6).

## 서버 설정

- PHP 설정(`php.ini`, PHP-FPM 풀, 또는 `php -d display_errors=0`)에서 `display_errors=Off`로 둔다. PHP는 애플리케이션이 실행되기 전에 시작 경고(예: `max_input_vars` 초과)를 출력한다. 애플리케이션 안의 예외는 상세 없이 500으로 응답하고 로그에 남는다(HY-43).
- `post_max_size`는 애플리케이션의 body 한도 이상으로 둔다(기본 8 MiB, PHP 기본값 `8M`). 애플리케이션이 `multipart/form-data`를 받으면 `enable_post_data_reading=Off`로 둔다. 그렇지 않으면 `App::run`이 실패한다(HY-59).
- 세션 쿠키는 HTTPS에서 `__Host-hy-session`, 그렇지 않으면 `hy-session`이고, `Path=/`를 가지며 `Domain`이 없고, `HttpOnly`, `SameSite=Lax`이며 HTTPS에서는 `Secure`다(HY-45). TLS를 끝내는 CDN 뒤에서는 PHP가 평문 HTTP를 받는다. 쿠키가 `__Host-` 이름과 `Secure`를 유지하도록 애플리케이션을 `https: true`로 연다(예제는 `BOARD_HTTPS=1`을 읽는다).
- 페이지는 방문자의 가린 CSRF 토큰을 담으므로(HY-24) 페이지의 `Cache-Control`은 공유 캐시가 저장하지 못하게 해야 하고(HY-52), 로그인과 로그아웃 액션은 reply의 `renewSession()`을 부른다(HY-72).
- 모든 응답은 `Content-Security-Policy: frame-ancestors 'self'`를 가진다(HY-45). `App::open(frameAncestors: ...)`로 출처를 바꿀 수 있으며, 예제는 `BOARD_FRAME_ANCESTORS`를 읽는다. S3의 정적 셸에는 CloudFront 응답 헤더 정책으로 같은 헤더를 붙여야 한다. `frame-ancestors`는 `<meta>` 정책에서는 효과가 없기 때문이다.

## 로컬 재현

`make serve-demo`는 데이터베이스 하나로 두 형태를 실행한다. 주소가 바뀌지 않도록 port가 고정되어 있으므로, 한 machine에서 demo는 한 번에 하나만 실행된다. demo는 자신의 checkout, process ID, 시작 시각을 적은 lock file `/tmp/hyper-serve-demo.lock`을 잡고, 두 번째 demo는 그 holder를 밝히며 실패한다. demo는 멈출 때(Ctrl+C나 SIGTERM) lock을 푼다. demo process가 끝난 lock은 그 holder와 함께 보고되고 남는다. `make serve-demo-unlock`이 그 lock을 지우며, demo가 실행 중이면 실패한다.

| URL | 역할 |
|---|---|
| `http://127.0.0.1:8080/board` | 서버 형태: 루트의 PHP |
| `http://127.0.0.1:8082/api/board` | `BOARD_BASE_PATH=/api`로 실행한 PHP |
| `http://127.0.0.1:8081/board` | 정적 셸: `scripts/serve-edge.mts`가 `build/csr/`의 파일을 반환하고, 그 밖의 모든 경로에는 셸을 반환하며, `/api/*`를 포트 8082로 전달한다 |
| `http://127.0.0.1:8081/compare?ssr=http://127.0.0.1:8080` | 비교 페이지: 두 형태를 두 프레임에 띄우고 두 body의 비교 결과를 표시한다. 개발 도구이며 배포에 포함하지 않는다. |

## 서버들이 공유하는 session

PHP, Node, Python 서버는 한 디렉터리(HY-104) 또는 한 Redis 서버(HY-115)에서 session을 공유한다. 한 배포의 모든 서버는 같은 곳을 쓴다.

디렉터리를 쓰면 PHP 서버는 `session.save_path`를 그 디렉터리로 정하며, 그 파일 시스템의 `flock`은 공유하는 모든 서버에 미쳐야 한다. Node와 Python 서버는 `FileSessions`에 그 디렉터리를 준다. Node 서버는 Node의 experimental module인 `node:ffi`로 `flock`을 호출하며, 이 module은 경고를 한 번 출력하고, `--permission`으로 시작한 process에는 `--allow-ffi`가 필요하다.

Redis를 쓰면 PHP 서버는 phpredis 6.3.0을 불러오고 다음을 정한다.

```ini
session.save_handler = redis
session.save_path = "tcp://redis:6379?persistent=1"
redis.session.locking_enabled = 1
redis.session.lock_expire = 30
redis.session.lock_retries = 100
redis.session.lock_wait_time = 20000
```

`persistent=1`은 PHP process마다 연결 하나를 유지한다. 이 값이 없으면 요청마다 TCP 연결을 열고, 닫힌 연결이 TIME_WAIT 동안 client의 port를 잡는다. 지속적인 부하에서는 port가 고갈되어 요청이 `Redis connection not available`로 실패한다.

Node와 Python 서버는 `RedisSessions`에 client의 command 함수(Python은 `decode_responses=False`인 `redis.Redis(...).execute_command`)와 같은 값을 준다. `lockExpire` 30, `lockRetries` 100, `lockWait` 20밀리초다(Python은 `lock_expire`, `lock_retries`, `lock_wait` 0.02초). `lock_expire`는 어떤 요청보다 길어야 하고, 없으면 끝난 process가 `max_execution_time`까지, 그 값이 0이면 영원히 잠금을 잡는다. 재시도 허용보다 오래 기다린 요청은 실패하므로, 한 session의 요청이 잠금을 오래 잡으면 재시도 값을 올린다. 연결이 끊긴 동안 명령을 쌓아 두는 client는 다시 연결될 때까지 요청을 붙잡으므로, Node 서버는 node-redis를 `disableOfflineQueue: true`와 `error` listener로 만들고 Python 서버는 `redis.Redis`에 `socket_timeout`을 정한다. 그러면 Redis 서버가 돌아올 때까지 요청은 status 500으로 응답한다. 재시작으로 session이 끝나면 안 되면 append-only file로 보관한다. 공유 session의 값은 template data model의 값이며, `stdClass` 외의 class 객체를 담은 record는 Node와 Python 서버에서 요청을 실패시킨다.

### Replica가 있는 primary와 Sentinel

Redis Sentinel은 primary를 알려 주고, primary가 실패하면 replica를 승격한다. phpredis의 session handler는 Sentinel을 모르므로, PHP 서버는 `RedisSentinelSessions`를 `App::open`의 `sessionSetup`으로 넘긴다. 요청이 session을 시작하기 직전에 Sentinel들에게 차례로 물어 `session.save_path`를 primary로 정하고, 잠금은 phpredis가 그대로 맡는다. Session이 없는 요청은 아무것도 묻지 않는다. phpredis를 `session_set_save_handler`와 `SessionHandler`로 감싸지 않는다. 그러면 PHP에 `validate_sid`가 없어 `session.use_strict_mode`가 아무도 만들지 않은 식별자를 받아들인다. 위의 `session.save_handler`와 `redis.session.*` 설정은 그대로 둔다.

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

Node와 Python 서버는 `RedisSessions`에 Sentinel client의 command 함수를 준다.

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

Primary가 실패한 때부터 Sentinel이 replica를 승격할 때까지 요청은 status 500으로 답하고, 그 뒤 session은 이어진다. 어떤 Sentinel도 primary를 알려 주지 못하면 요청은 실패한다. Sentinel은 서로 다른 장애 영역에 셋 이상 둔다.

복제는 비동기이므로, primary가 확인 응답했지만 replica가 받지 못한 것은 failover에서 사라진다. 그런 session은 이전 record로 돌아가거나, 새 session이었다면 사라져 다음 요청이 새로 시작한다. 잠금도 같은 방식으로 사라질 수 있다. 그러면 쥐고 있던 요청이 아직 실행되는 동안 다음 요청이 시작될 수 있고, 쥐고 있던 요청은 잠금이 맞지 않아 아무것도 쓰지 않는다. Redis의 `min-replicas-to-write`와 `min-replicas-max-lag`는 최신 replica가 없는 동안 primary가 쓰기를 거부하게 하여 손실을 줄이고 대신 status 500으로 답하게 한다. hyper는 이 설정을 테스트하지 않는다. `tests/scripts/session-redis-failover.test.mts`는 세 서버가 쓰는 도중 primary를 kill하고, replica가 `WAIT`로 확인 응답한 것이 남는지 확인한다.

### TLS와 ACL 사용자

TLS와 ACL 사용자를 요구하는 연결은 다음 값을 설정한다. 인증 기관이 서버를 검증하며, 인증서가 가리키는 주소는 client가 접속하는 주소여야 한다.

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

Sentinel을 쓰면 각 Sentinel도 같은 보안을 요구하므로, client는 Sentinel과 primary 양쪽에 이를 지정한다. PHP 서버는 각 항목에 `'auth' => ['hyper', 'secret'], 'ssl' => ['cafile' => '/etc/redis/ca.pem']`를 주고, `RedisSentinelSessions`의 이름 다음 인자로 primary의 매개변수와 scheme `'?persistent=1&auth[]=hyper&auth[]=secret&stream[cafile]=/etc/redis/ca.pem', 'tls'`를 준다. Node 서버는 `{ socket: { tls: true, ca }, username, password }`를 `sentinelClientOptions`와 `nodeClientOptions`에 준다. Python 서버는 `ssl=True, ssl_ca_certs=..., username=..., password=...`를 `Sentinel`과 `sentinel_kwargs`에 준다. Redis 서버 하나의 용량은 [benchmark](benchmark.ko.md)에 있다.
