<!-- doc-id: deployment -->
<!-- source-sha256: 2b6b9198bee54481686cba43593e5a54db2d732affc942e85db272ca257d99fa -->
# 배포

[English](deployment.md).

애플리케이션 하나를 두 가지 형태로 배포할 수 있다. 두 형태는 같은 매니페스트, 템플릿, 클라이언트 번들, PHP 핸들러를 사용한다.

| 형태 | 첫 문서 | 이후 이동 | 용도 |
|---|---|---|---|
| 서버와 CDN(권장) | PHP가 렌더한다(SSR) | JSON을 받아 브라우저가 렌더한다 | 서버가 HTML을 렌더할 수 있는 모든 애플리케이션 |
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

`make server`가 만든 `build/server`를 PHP 코드와 함께 배포한다. 애플리케이션은 `App::open(program: ...)`으로 이 디렉터리를 연다. 가장 빠르게 렌더하려면 서버의 PHP 버전에 맞춰 `make ext`로 네이티브 템플릿 확장을 빌드하고, `php.ini`의 `extension` 설정으로 불러온다. 확장이 없으면 PHP는 `build/server/program.php`의 generated 프로그램으로 렌더한다(HY-48).

## 정적 셸

`make assets`는 `examples/board/build/csr/`를 만든다. 클라이언트 진입 파일을 인라인하고 스타일시트는 담지 않은 `index.html`(HY-76), 템플릿마다 파일 하나를 담은 `assets/templates/`, 그리고 렌더한 layout이 link하고 브라우저가 페이지를 보이기 전에 적용하는 스타일시트 `assets/app.css`와 `assets/reader.css`다(HY-64). `make assets`는 `--static`으로 `public/assets/`의 이 둘을 밝힌다.

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

PHP나 Node 서버 하나가 한 매니페스트의 서버 렌더 페이지와 클라이언트 렌더 페이지를 같은 handler로 응답할 수 있다(HY-62). 애플리케이션은 열 때 클라이언트 렌더를 선언한다. PHP에서는 `App::open(clientRendering: new ClientRendering(shell: '/srv/app/build/csr/index.html', basePath: '/_props', selects: fn (Request $request): Choice => new Choice(chosen: ..., value: ...)))`, Node에서는 `App.open`의 `clientRendering` 옵션 `{ shell, basePath, selects }`다. 선택은 예를 들어 `Host` header로 클라이언트 렌더 요청을 고르고, host에 저장된 service 같은 그 값은 PHP의 `$request->selection()`과 Node의 `request.selection()`으로 요청의 모든 loader와 action에 전달되므로 handler가 그 값을 다시 읽지 않는다. 셸이 데이터 기본 경로를 선언하도록 `@polyspec/hyper-build`의 `hyper-build-assets --api /_props`로 셸을 build한다. 그렇지 않으면 애플리케이션 열기가 실패한다.

| 선택이 고른 페이지의 요청 | 응답 |
|---|---|
| 페이지 경로의 HTML `GET` | 셸, `Cache-Control: no-cache`, 세션과 loader 없음 |
| `/_props` 아래의 JSON 요청이나 액션 | 서버 형태와 같은 JSON과 액션, `/_props` 아래의 `Location` |
| `/_props` 아래의 HTML 요청, 그 밖의 JSON 요청 | 406 |

선택이 고르지 않은 요청은 서버 형태처럼 응답한다. 셸 응답은 `frame-ancestors`(HY-45)를 가지며 응답 hook(HY-60)에 보고된다. 브라우저는 `html` 요소에 렌더한 layout의 `lang` 같은 속성을 준다(HY-63).

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
| `http://127.0.0.1:8081/board` | 정적 셸: `scripts/serve-edge.mjs`가 `build/csr/`의 파일을 반환하고, 그 밖의 모든 경로에는 셸을 반환하며, `/api/*`를 포트 8082로 전달한다 |
| `http://127.0.0.1:8081/compare?ssr=http://127.0.0.1:8080` | 비교 페이지: 두 형태를 두 프레임에 띄우고 두 body의 비교 결과를 표시한다. 개발 도구이며 배포에 포함하지 않는다. |
