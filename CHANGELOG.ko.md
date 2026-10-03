# 변경 기록

[English](CHANGELOG.md).

## 미배포

### 추가

- 응답 hook은 HY-43이나 HY-66의 500에 대해 그 실패도 다섯째 인자로 받는다. PHP에서는 `?string $failure`, Node에서는 `failure: string | null`이다(HY-60). 실패는 오류의 message, 또는 `the response to <method> <path> has <size> bytes, more than the response limit of <limit> bytes`이며, 다른 모든 응답에 대해서는 null이다. 서버는 원인을 자기 로그에만 썼으므로, 애플리케이션은 그것을 요청의 자기 줄에 쓸 수 없었다. 변경 전에는 `AppTest`와 `app.test.ts`가 실패했다.
- `scripts/build-assets.mjs`와 `scripts/build-templates.mjs`는 `scripts/build-server.mjs`처럼 `--template-dir`를 요구하고, parser, render runtime, manifest 검사 bundle을 그 template 저장소의 template package `packages/template-ts`에서 읽는다. asset build는 client bundle의 `@polyspec/template`도 그 package로 resolve한다(HY-70). 이전에는 이 저장소의 의존성에서 `@polyspec/template`을 resolve했고, 그 의존성은 옆의 template checkout을 link하므로, 그 checkout을 다시 build하면 애플리케이션의 build가 읽는 중에 package가 사라졌고, 애플리케이션은 다른 template package로 build할 수 없었다. `tests/scripts/template-dir.test.mjs`는 변경 전에 실패했다.
- loader나 action은 PHP의 `Reply::status(403)`과 Node의 `reply.status(403)`으로 그 요청의 페이지에 상태 403을 준다(HY-69). 그래서 애플리케이션은 session이 필요한 페이지의 URL에서 그 페이지 대신 sign-in form을 보인다. 페이지는 200일 때처럼 JSON이나 문서로 렌더되며 `Cache-Control: no-store`를 가지고 `ETag`는 없다. 409나 422인 페이지, redirect, stop은 자기 상태를 유지하고, 다른 상태는 500으로 실패한다. 전에는 loader가 HY-51의 텍스트 403으로 요청을 멈추거나, 응답이 그 페이지라고 밝히는 200으로 페이지를 렌더할 수만 있었다. `AppTest`와 `app.test.ts`는 변경 전에 실패했다.
- 애플리케이션은 연결 끊김 hook을 선언할 수 있다. PHP에서는 `App::open(onDisconnect:)`, Node에서는 `App.open`의 `onDisconnect` 옵션이며, 서버는 client가 연결을 닫은 요청의 요청, 경과 밀리초, reply로 이 hook을 한 번 호출한다(HY-67). Node 서버는 `node:http`로 닫힘을 알고, 그 뒤 그 요청의 다른 loader, action, 렌더를 실행하지 않고, 응답을 쓰지 않으며, 응답 hook을 호출하지 않는다. PHP는 닫힌 연결을 그 연결에 쓰기가 실패할 때만 알리므로, `App::run`은 `ignore_user_abort`를 끄고, PHP는 응답의 첫 실패한 쓰기에서 script를 끝내며, shutdown 함수가 hook을 호출한다. PHP 서버는 닫힘을 알기 전에 응답을 끝까지 렌더한다. 서버는 떠난 client를 위해 모든 loader를 실행하고 응답을 렌더했으며 아무것도 보고하지 않았다. `RunTest`와 `http.test.ts`는 변경 전에 실패했다.
- 상태가 400 이상인 모든 응답은 `Cache-Control: no-store`를 가진다(HY-65). hyper가 스스로 응답하는 텍스트 응답, `node:http`가 해석하지 못하는 요청에 대한 Node 서버의 400과 431 응답, 상태 409나 422의 페이지다. 텍스트 응답에는 `Cache-Control`이 없었으므로, cache가 404나 405 응답을 heuristic freshness로 저장할 수 있었다(RFC 9111). `AppTest`, `ClientTest`와 Node 테스트 `app.test.ts`, `http.test.ts`, `client.test.ts`는 변경 전에 실패했다. 이제 `conformance/client.json`의 실패 사례 12개가 이 header를 적는다.
- 애플리케이션은 응답 한도, 즉 가장 큰 응답 body의 바이트 수(기본 8 MiB)를 선언한다. PHP에서는 `App::open(responseLimit:)`, Node에서는 `App.open`의 `responseLimit` 옵션이다(HY-66). body가 더 큰 응답은 보내지 않는다. 서버는 method, 경로, 크기, 한도를 로그에 쓰고, 어떤 cache도 저장하지 않는 텍스트 500으로 응답하며, 이를 응답 hook에 보고한다. 양의 정수가 아닌 한도는 애플리케이션을 열 때 실패한다. 서버는 크기와 관계없이 body를 보냈고, 느린 클라이언트는 그 body를 서버 프로세스의 메모리와 응답을 buffer하는 웹 서버의 메모리에 붙잡아 둔다. `AppTest`와 `app.test.ts`는 변경 전에 실패했다.
- PHP의 `App::open`은 서버 프로그램의 빠진 파일, 즉 `program.php`, `program.json`, 디렉터리 `templates` 중 빠진 것을 밝힌다(HY-48). 이전에는 프로그램 디렉터리만 밝혔다. `RendererTest`는 변경 전에 실패했다.
- 브라우저는 새 내용을 보일 때 head의 stylesheet link를 적용한다(HY-64). 클라이언트 렌더에서는 렌더한 문서의, 영역 응답에서는 그 공유 데이터로 렌더한 layout의, 서버 렌더의 히스토리 복원에서는 그 HTML 문서의 link다. 원본에 같은 키(페이지 URL을 기준으로 해석한 `href`)가 있는 link는 유지하고, 없는 link를 원본의 순서로 넣어 불러올 때까지 기다린 뒤에야 내용을 보이며, 그 뒤 원본에 없는 link를 제거한다. 클라이언트 렌더는 `html` 속성, 제목, body만 바꾸었고 영역 이동은 영역만 바꾸었으므로, 클라이언트 렌더 페이지는 link한 stylesheet를 적용하지 않았고, layout이 다른 stylesheet를 link하는 페이지로 이동해도 그것을 적용하지 않았다. 불러오기에 실패한 link는 페이지를 그대로 두고 영역이나 body에 `hy-error="0"`을 표시한다(HY-47). board의 글 페이지는 이제 `reader.css`를 link하고, `make assets`는 이 파일도 `dist/csr/assets/`에 복사한다. `tests/hyper.test.ts`의 사례 7개와 `tests/stylesheets.test.ts`는 변경 전에 실패했고, `make e2e`는 SSR에서 글로 이동한 뒤 `/assets/reader.css`가 없어서, CSR에서 stylesheet link가 하나도 없어서 실패했다. 이제 SSR과 CSR 흐름은 이동, 히스토리 복원, 첫 문서 뒤의 link, stylesheet 응답을 늦춘 상태에서 글 본문이 처음 나타날 때의 style, 불러오기에 실패한 stylesheet를 확인한다. 이 코드가 gzip 761바이트와 726바이트를 더하므로 bundle 상한을 SSR 스크립트는 gzip 32,700바이트, CSR 셸은 34,000바이트로 올린다.
- Node 서버에서 클라이언트 렌더의 선택은 `true` 또는 `false`의 promise를 반환할 수 있으며, 서버는 그 promise를 기다린다(HY-62). host의 service를 database에서 읽는 선택은 Node에서 그 값을 비동기로 읽는데, 서버가 선택을 기다리지 않고 호출했으므로 그런 선택은 모든 요청에 500으로 응답했다. reject되거나 다른 값으로 resolve되는 promise는 HY-43으로 실패한다. `tests/client.test.ts`는 변경 전에 promise를 반환하는 선택에서 status 500으로 실패했다.
- 한 서버가 한 매니페스트의 클라이언트 렌더 페이지와 서버 렌더 페이지를 같은 handler로 응답한다(HY-62). 애플리케이션은 PHP에서는 `App::open(clientRendering: new ClientRendering(shell, basePath, selects))`, Node에서는 `App.open`의 `clientRendering` 옵션으로 클라이언트 렌더를 선언한다. 정적 셸의 절대 경로, `/_props` 같은 데이터 기본 경로, 예를 들어 `Host` header로 클라이언트 렌더 페이지의 요청을 고르는 선택이다. 선택이 고른 페이지의 HTML `GET`은 세션과 loader 없이 `Cache-Control: no-cache`, `Vary: Accept`와 함께 셸을 받는다. 그 JSON 요청과 action은 데이터 기본 경로 아래에서 실행되고 그 안으로 리다이렉트한다. 데이터 기본 경로 아래의 HTML 요청과 그 밖의 JSON 요청은 406을 받는다. 다른 요청은 애플리케이션의 기본 경로로 응답한다. 셸 응답은 frame 정책(HY-45)을 가지며 응답 hook(HY-60)에 보고된다. 셸이 데이터 기본 경로를 선언하지 않거나 라우트가 그 아래에 있으면 열기가 실패한다. 서버는 모든 handler를 기본 경로 하나에 묶었으므로 한 process가 두 형태에 응답할 수 없었고, Node 서버는 셸로 응답할 수 없었다. 두 서버는 `conformance/client.json`의 사례 24개를 통과하며, 변경 전에는 실패했다.
- 클라이언트 렌더는 `html` 요소에 렌더한 layout의 `html` 요소의 속성을 주므로, 데이터가 영어인 페이지는 `lang="en"`을 가진다(HY-63). 브라우저는 제목과 body만 바꾸었으므로 정적 셸의 `lang="ko"`가 모든 페이지에 남았다. 이제 `scripts/build-assets.mjs`가 쓰는 셸에는 `lang`이 없다. `tests/document.test.ts`는 변경 전에 실패했고, `make e2e`는 클라이언트 렌더 board가 서버 렌더 board의 `html` 요소를 가지는지 확인한다.
- `@polyspec/hyper`와 `@polyspec/hyper-server`는 type 선언을 가진 JavaScript module을 배포하며, 각 package의 `npm run build`(`make packages`)가 이를 `dist`에 쓴다. 두 package의 `exports`는 `dist/index.js`와 `dist/index.d.ts`만 가리킨다(HY-61). package는 TypeScript 소스를 export했는데, Node 26은 이를 `node_modules`에서 실행하지 않는다(`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). 소스는 `erasableSyntaxOnly` type 검사가 거부하는 parameter property를 썼다. 이제 class는 field를 선언하며, 두 package와 board Node 서버는 `erasableSyntaxOnly`로 type 검사를 통과한다. `make check`에 포함된 `make package-check`는 두 package를 `npm install --install-links`로 `tests/package-install`에 설치하고, 그 test를 선언에 대해 type 검사한 뒤 `node`로 실행한다. 변경 전에는 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`으로 실패했다. Node 서버 test, 에셋과 서버 build, fixture build는 이제 build된 package를 가져온다.
- 응답 hook은 요청의 reply도 받으며, loader나 action은 `Reply::note(name, value)`(Node에서는 `reply.note(name, value)`)로 hook을 위한 요청의 값을 기록하고, hook은 이를 `notes()`로 읽는다(HY-60). Node 서버는 hook에 받은 그대로의 요청을 주고 loader와 action에는 그 사본을 주었으므로, hook은 거부의 종류처럼 그들이 정한 값을 읽을 수 없었다. PHP 애플리케이션은 자기 process의 상태를 썼다. reply는 loader와 action이 받은 reply이며, 멈춤이나 오류 뒤에도 같고, 서버가 라우팅 전에 응답했으면 빈 reply다. note는 응답에 포함되지 않는다. 두 서버의 test는 변경 전에 실패했다.
- 애플리케이션은 응답 hook을 선언할 수 있다. PHP에서는 `App::open(onResponse:)`, Node에서는 `App.open`의 `onResponse` 옵션이다. 서버는 hyper가 스스로 응답하는 400, 403, 404, 405, 413, 415, 500을 포함해 모든 응답마다 요청, 응답, 경과 밀리초로 hook을 한 번 호출한다(HY-60). 애플리케이션은 이것으로 거부를 log에 쓴다. `App::run`은 `REQUEST_TIME_FLOAT`부터 세고, Node 서버는 `node:http`가 요청을 준 시각부터 세며, `node:http`가 해석하지 못하는 요청에 대한 400과 431 응답도 보고한다.
- 애플리케이션은 body 한도(기본 8 MiB)와 action과 `/_hyper/keep`이 받는 폼 type(기본 `application/x-www-form-urlencoded`, 그리고 `multipart/form-data`)을 선언한다. PHP에서는 `App::open(bodyLimit:, formTypes:)`, Node에서는 `App.open`의 `bodyLimit`, `formTypes` 옵션이다(HY-59). 두 서버는 어떤 loader나 action도 실행하기 전에 더 큰 body에 413, 다른 media type에 415, 틀린 CSRF token에 403을 이 순서로 응답한다. `app.server`의 Node 서버 옵션 `bodyLimit`은 제거했으며, 서버는 body를 애플리케이션의 한도까지만 읽는다. PHP는 `post_max_size`보다 큰 body를 비워 두므로 크기를 `Content-Length`에서도 읽는다. `App::run`은 `post_max_size`가 한도보다 작거나, `enable_post_data_reading`이 켜진 채 multipart body를 받으면 실패한다. `make server-parity`는 이제 두 서버의 413, 415, 403 응답도 비교하며, 49개 응답이 같았다.
- loader나 action은 `BadRequest`로 요청을 멈춰 텍스트 `Bad Request`와 함께 400으로 응답할 수 있고, action은 200, 409, 422 상태로 라우트 페이지를 렌더하는 `Result::page(status, data)`(Node에서는 `Result.page`)를 반환할 수 있다(HY-58). `Result::invalid(data)`는 422인 페이지다. 이제 `GET` 요청만 맞는 `If-None-Match`에 304를 받으므로, 200으로 페이지를 렌더하는 action은 언제나 실행된다(HY-53).
- `Request`는 body의 모든 폼 값을 쿼리 값처럼 중첩 없이 순서대로 제공한다. `roles[]`는 모든 값을 가진 이름 `roles[]`로 남는다(HY-57). PHP는 대괄호 이름을 중첩하는 `$_POST`를 읽었고, Node 서버는 이름의 마지막 값만 남겼다. 이제 두 서버 모두 원본 body, 즉 `application/x-www-form-urlencoded` body나 `multipart/form-data` body의 텍스트 필드를 읽는다. PHP는 `enable_post_data_reading`이 꺼져 있을 때만 multipart body를 읽는다. `formString`은 이름의 마지막 값을 읽는다. 두 서버는 `conformance/fields.json`의 multipart 사례 4개를 통과한다.
- `Request`는 모든 쿼리 값을 중첩 없이 순서대로, 각 이름을 그 값들에 대응시키는 순서 있는 map으로 제공하고, 요청 대상의 원본 쿼리도 제공한다(HY-56). PHP는 `a[]`와 `a[b]`를 중첩하고 반복된 이름의 값을 하나만 남기는 `$_GET`을 읽었으므로, 이제 두 서버 모두 원본 쿼리를 직접 parse한다. `queryInt`는 이름의 마지막 값을 읽는다. 두 서버는 `conformance/fields.json`의 사례 17개를 통과한다.
- `make check`에 포함된 `make server-parity`는 parity 단계의 모든 요청을 PHP 서버와 board Node 서버에 보내고, session 식별자, CSRF token, `ETag` 값을 placeholder로 바꾼 뒤 상태, header, body가 같은지 확인한다(HY-55). 41개 응답이 같았다. `BOARD_TIME`은 두 board 서버에서 게시글의 생성 시각을 고정한다.
- Node.js 서버 package `@polyspec/hyper-server`(`packages/hyper-node`)가 PHP 서버의 규칙을 구현한다. base path를 쓰는 라우트, loader, CSRF를 검사하는 action, 결과와 멈춤, reply cookie와 cache control, JSON tag, flash 값과 바뀐 topic, 유지 값, 요청 검사, 평문 오류, 데이터 모델 검사, 파일 session이다. 문서는 브라우저 코드와 asset build의 템플릿 파일로 렌더하고, JSON은 PHP `json_encode`와 같은 바이트로 쓰며, 유지 값은 PHP `json_decode`처럼 decode한다(HY-54). loader와 action은 요청, reply, service를 담은 context 하나를 받는다. test는 같은 fixture로 PHP 서버 test의 사례를 실행하고, `conformance/json.json`에는 U+2028과 U+2029, float, 빈 map을 포함해 두 서버가 통과하는 JSON 사례가 있다. `make node-server`는 `node:sqlite`를 쓰는 board 예제의 Node 서버를 build하며, 이 서버는 PHP와 같은 문서를 렌더한다.
- 요청 경로는 RFC 9112가 요청 대상에 요구하는 대로 출력 가능한 ASCII 문자로만 이루어져야 한다. 두 서버는 다른 경로에 400으로 응답한다(HY-42). `node:http`는 애플리케이션이 보기 전에 그런 대상을 거부하므로, PHP 서버도 이제 같은 규칙을 따른다.
- 브라우저 코드의 manifest 검사는 PHP manifest reader처럼 layout과 title 템플릿, 모든 라우트와 라우트 영역의 title과 템플릿도 요구한다.
- 라우트 경로가 나머지 매개변수 `{name*}`로 끝날 수 있다. 이 매개변수는 0개 이상의 남은 요청 segment에 맞고, decode하지 않은 요청 경로의 나머지를 담는다(HY-49). 두 라우터가 `conformance/rest.json`의 사례를 통과한다.
- loader나 action은 `Redirect`로 요청을 멈춰 redirect 결과의 위치, flash 값, 바뀐 topic으로 303 응답을 하거나(HY-50), `Forbidden`으로 403 응답을 할 수 있다(HY-51).
- loader와 action은 요청의 `Reply`를 받는다. `Reply`는 HY-45의 속성으로 cookie를 더하거나 지우고 페이지 응답의 `Cache-Control`을 정하며, 응답은 상태와 상관없이 그 cookie를 담는다(HY-52). JSON 페이지 응답은 strong `ETag`를 가지며, 같은 `If-None-Match`를 가진 요청은 304를 받는다(HY-53). `Set-Cookie`는 여러 값을 가질 수 있는 유일한 응답 header다.

### 수정

- PHP 서버는 응답 hook과 연결 끊김 hook의 경과 시간을 monotonic clock으로 센다(HY-60). `App::run(?int $started)`와 `handle(..., ?int $started)`는 호출자에게서 `hrtime(true)` 시작을 받으며, 받지 않으면 자기 호출부터 센다. 이전에는 `App::run`이 두 wall clock 시각인 `microtime(true)`에서 `REQUEST_TIME_FLOAT`를 뺐으므로, 요청 중에 시스템 시각이 뒤로 가면 경과 시간이 음수가 되었고, 요청 log에 `-1.419ms`가 나타났다. `RunTest`는 변경 전에 지금보다 10초 뒤의 `REQUEST_TIME_FLOAT`에 대해 `-9998.7` ms로 실패했고, `AppTest`와 `RunTest`는 `hrtime(true)` 시작에 대해 실패했다.
- asset build와 server build는 출력 파일을 mode 0644로, 디렉터리를 mode 0755로 복사한다(HY-68). 이전에는 대상 파일을 mode 0200으로 만드는 Node의 `fs.cpSync`로 복사했고, Linux container의 virtiofs bind mount는 그 생성을 거부하므로, `scripts/build-server.mjs`가 container에서 `templates` 디렉터리에 대해 `EACCES, Permission denied`로 실패했다. `tests/scripts/output-files.test.mjs`는 출력이 Apple `container`의 virtiofs bind mount에 있는 공식 Node image에서 server build와 복사를 실행하며, 변경 전에 실패했다.
- build script가 browser package를 작업 디렉터리에서 읽었다: `packages/hyper-js/`의 `data-template.json`과 `packages/hyper-js/dist` build 출력의 `checkManifest`, `templateReferences`. 그래서 저장소 디렉터리 밖이나 `dist`가 없을 때 build가 실패했고, 이 script로 build하는 application은 이 저장소에 `dist`를 써야 했다. 이제 script는 자기 옆 `packages/hyper-js`의 `data-template.json`과 소스를 읽는다. `make server`, `make server-fixtures`, `make node-fixtures`는 더 이상 `make packages`를 실행하지 않는다. `tests/scripts/package-source.test.mjs`는 변경 전에 `./dist/index.js` 없음과 `packages/hyper-js/data-template.json`의 `ENOENT`로 실패했다.
- `Polyspec\Hyper\Examples\Board\Posts`가 시계 함수를 받게 된 뒤로 PHP 측정기가 실패했다. 측정기가 `make check`에 들어 있지 않았기 때문이다. 이제 고정 시계를 넘기며, `make check`는 PHP 측정기를 측정마다 한 번씩 실행하는 `make bench-server-smoke`를 실행한다. 브라우저 측정기는 몇 분이 걸려 `make check` 밖에 두며, `docs/operations/benchmark.ko.md`에 이 사실을 적었다. 성능 측정 문서는 이제 현재 코드의 결과를 담는다(2026-10-02, 부하 평균 8인 기계에서 측정). 1,000행을 generated PHP 프로그램은 12.8 ms, 네이티브 확장은 3.6 ms에 렌더한다.
- bundle 상한을 SSR 스크립트 32,500, CSR 셸 33,800 gzip 바이트로 올린다. 데이터 모델의 모든 숫자를 검사하는 템플릿 runtime이 SSR 스크립트를 32,057, CSR 셸을 33,364 gzip 바이트로 키운다. hyper 코드가 더한 것은 그중 79바이트다.
- PHP session이 session의 모든 응답에 `Expires`, `Pragma`, 두 번째 `Cache-Control` header를 더했다. 그래서 JSON 응답에 `Cache-Control` header가 두 개 있었고, reply는 페이지를 cache 가능하게 만들 수 없었다. PHP는 303과 204처럼 body가 없는 응답에도 `text/html` type을 주었다. 이제 session은 자기 cookie만 더하고, 모든 페이지 응답은 reply가 상태 200에서 정하지 않으면 `Cache-Control: no-store`를 가지며, `App::run`은 기본 content type을 끈다(HY-52). 응답 header 전체를 비교해 이 결함을 찾았으며, `AppTest`, `RequestTest`, `RunTest`는 수정 전에 실패했다.
- 스왑, 유지 값, 리다이렉트, 세션의 다음 결함을 수정 전에 실패하던 테스트와 함께 고쳤다.
  - 호출 순서의 수정(HY-33)은 `set`, `render`, `hy-set` 변경을 어떤 응답이 와도 끝냈다. 그 영역을 담지 않은 응답이어도, 스왑이 이미 화면을 바꾼 뒤여도 끝냈다. 그래서 화면에는 보관도 저장도 되지 않은 값이 남았다. 이제 변경은 자기 영역의 데이터가 스왑 전에 교체된 경우에만 끝나고, 스왑 중에 교체되면 보관 데이터로 영역을 다시 렌더한다(HY-33).
  - 브라우저가 라우트 영역을 템플릿 정의로 페이지 영역에 넘겨서, 라우트 영역이 영역 응답에서는 페이지 영역 데이터를 보고 문서에서는 보지 못했다. HY-48 이후 같은 URL의 PHP 문서와 htmx 이동 결과가 다를 수 있었다. 이제 서버와 브라우저 모두 라우트 영역을 단독으로 렌더해 HTML로 넘긴다(HY-12, HY-13). `make parity`는 이 경우를 검사하지 않았고, 이제 테스트가 검사한다.
  - 브라우저 유지 값을 HY-38의 순서(브라우저 저장소, 그다음 대기 중인 서버 값)가 아니라 선언 순서로 적용했다.
  - 클라이언트 렌더가 문서를 리다이렉트 뒤의 URL이 아니라 요청한 경로로 해석했다(HY-22).
  - 라우팅 전에 거부한 요청과 라우트가 없는 경로를 포함한 모든 요청이 세션을 시작하고 세션 파일을 썼다(HY-45).
아래 정확성과 보안의 결함을 수정했다. 각 결함에는 수정 전에 실패하던 테스트가 있다.

- PHP 서버:
  - 처리하지 않은 예외가 메시지, 파일 경로, 스택 트레이스를 출력했고, 저장된 잘못된 UTF-8 바이트 하나가 모든 방문자의 목록을 깨뜨렸다. 이제 서버는 UTF-8이 아닌 입력을 400으로 거부하고(HY-42), 그 밖의 실패에는 상세 없는 500으로 응답한다(HY-43).
  - `parse_url`이 `/board/12:30`을 `/`로, `//board/1`을 호스트로 읽었다. 이제 요청 경로는 요청 대상에서 `?`나 `#` 앞까지다(HY-42).
  - 페이지 영역이 아닌 `Hy-Region`을 가진 POST가 액션을 실행했다. 이제 로더와 액션보다 먼저 검사한다(HY-16).
  - JSON이 template 데이터 모델 밖의 정수를 상태 200으로 내보냈다. 이제 문서와 JSON 모두 500으로 실패한다(HY-44).
  - 세션 쿠키에 `HttpOnly`, `SameSite`, `Secure`가 없었고, 서버가 자기가 만들지 않은 식별자를 받아들였다(HY-45).
  - `/\evil.example` 같은 리다이렉트 위치를 받아들였다(HY-46). `/_hyper/keep`이 크기 제한 없이 값을 저장했다. 이제 4,096바이트보다 긴 값을 거부한다(HY-40).
  - 빈 맵과 `stdClass` 맵 유지 값을 적용하지 못했고, 배열 펼치기가 숫자 데이터 키를 다시 매겼다.
- 브라우저 코드:
  - SSR 히스토리 복원 뒤 이전 페이지의 데이터를 보관하고 있었다. 이제 복원된 문서의 `#hy-data`를 읽는다(HY-32).
  - 겹친 CSR 복원이 다른 페이지를 마운트할 수 있었다. 이제 가장 마지막 복원만 렌더한다(HY-23).
  - CSR이 브라우저 유지 값을 `#hy-data`에 섞었다. 이제 내장 데이터와 JSON은 서버 데이터 그대로이고, 브라우저 값은 보관 데이터에만 적용한다. 저장이 끝나지 않은 `server` 값은 응답보다 우선한다(HY-38, HY-39).
  - `set`이 없는 맵 키를 추가했다(HY-33). 유지 경로의 부모나 자식을 통한 변경은 저장되지 않았다(HY-39). 기본 경로 아래에서, 경로가 이미 기본 경로로 시작하는 영역 요청에는 접두사가 붙지 않았다(HY-23). `hy-set`이 백슬래시로 끝나는 문자열을 거부했다(HY-36).
  - JSON이 아닌 응답을 받은 영역 요청이 본문을 HTML로 스왑했다. 이제 스왑하지 않고 영역에 `hy-error`를 표시한다(HY-47).
  - 클라이언트 번들에 `hyper/data.tpl`의 소스가 들어 있었다. 이제 이름만 들어 있다(HY-34). 템플릿 참조는 테스트되지 않은 빌드 코드가 계산했다. 이제 `templateReferences`가 패키지에 있고 테스트가 있다.
- 예제와 개발 도구:
  - 비교 페이지가 `?ssr=`의 `javascript:` URL을 실행했고, 모든 출처의 메시지를 받아들였다. 프레임은 CSRF 토큰이 든 body 전체를 아무 부모에게나 보냈다. 이제 프레임은 body의 SHA-256만 자신을 담은 출처로 보내고, 비교 페이지는 http(s) 출처만 받아들인다.
  - 엣지 서버가 `index.html`을 1년 동안 캐시하게 했다. 이제 `/assets/` 아래 파일만 캐시한다.
- 복원, 저장, 요청 검사, 실패 표시의 결함을 더 테스트와 함께 수정했다.
  - 느린 CSR 복원이 이후 이동을 덮어썼다(HY-23).
  - 실패한 서버 저장이 대기 값을 지웠고, 성공한 저장이 이후 변경까지 지울 수 있었다(HY-39).
  - 관계없는 비UTF-8 쿠키 하나가 모든 페이지를 막았다. 이제 HY-42는 `hy-keep`과 세션 쿠키만 검사한다.
  - `render`, `set`, `hy-set`이 렌더 전에 보관 데이터를 바꿨고 실패를 표시하지 않았다(HY-47).
  - 데이터 모델 밖의 유지 값이 계속되는 500을 일으켰다. 이제 무시하거나 거부한다(HY-38, HY-40).
  - `?/x`와 절대 형식 대상의 요청 경로가 틀렸다(HY-42).
  - 페이지 영역 밖 영역의 표시가 해제되지 않았고, 취소된 요청이 표시됐다(HY-47).
  - 같은 출처의 절대·상대 URL에 접두사가 붙지 않았다(HY-23).
  - 리다이렉트 위치가 C1 제어 문자와 잘못된 UTF-8을 허용했다(HY-46).
  - TLS를 끝내는 CDN 뒤에서 세션 쿠키가 `Secure`가 될 수 없었고, 어떤 응답도 프레임 삽입을 제한하지 않았다(HY-45).
  - 예제와 스크립트는 PHP를 `display_errors=0`으로 시작한다. PHP가 애플리케이션 실행 전에 시작 경고를 출력하기 때문이다(HY-43).
- "Keep region data in the server session, a cookie or Web Storage"에서 "Fix defects of kept data, requests and failures"까지의 변경의 결함을 더 테스트와 함께 수정했다.
  - 동시에 실행한 `set` 두 개 중 하나의 변경이 사라졌다. 또 변경은 렌더하는 동안 도착한 응답의 값을 저장했고, 그 위에 오래된 내용을 스왑했다. 이제 호출은 호출 순서대로 실행되며, 응답이 보관 데이터를 교체한 변경은 스왑, 보관, 저장 없이 끝난다(HY-33).
  - 한 경로의 저장이 순서가 바뀌어 도착할 수 있었고, 이전의 실패한 저장이 최신 값이 저장된 영역을 실패로 표시했다. 이제 한 경로의 저장은 한 번에 하나씩 최신 값으로 보내며, 최신 변경의 저장만 영역을 표시한다(HY-39).
  - `holdEmbedded`의 실패(템플릿 불러오기, 렌더, 읽을 수 없는 내장 데이터)가 표시되지 않았고 처리되지 않은 reject가 됐다. 이제 영역이나 body를 표시하며 reject하지 않는다(HY-47).
  - 제한 시간이 지나 htmx가 중단한 요청이 표시되지 않았다. 이제 네트워크 실패다(HY-47).
  - 유지 맵과 목록은 바깥 타입만 검사했다. 그래서 안쪽 형태가 다른 저장 값이 모든 문서에서 500을 일으켰다. 이제 유지 값은 데이터의 형태에 맞아야 한다(HY-38). 형태가 맞는데도 렌더를 깨는 값이 있으면 그 영역은 로더 데이터로 렌더한다(HY-38).
  - 배열 안에 중첩된 쿼리와 폼 이름은 UTF-8 검사를 건너뛰었다(HY-42).
  - 리다이렉트 위치가 `/.//evil.example` 같은 `.`과 `..` 세그먼트를 허용했다(HY-46).
- `make templates-check`는 레이아웃이 `{# title}`, `{# data}`, 모든 매니페스트 영역을 한 번씩 배치하는지도 검사하며(HY-3), 매니페스트는 잘못된 주제 이름을 거부한다.

### 변경

- HY-53의 304는 `Content-Type`을 뺀 200 응답의 header를 가지며, HY-52는 body가 없는 어떤 응답에도 `Content-Type`을 주지 않는다. 304는 representation을 담지 않고(RFC 9110, 15.4.5절), php-fpm은 304의 `Content-Type`을 지웠지만 Node server는 보냈으므로 두 server가 같은 요청에 다른 header로 응답했다. 변경 전 `AppTest`와 `app.test.ts`가 실패했다.
- SSR 스크립트와 CSR 셸의 gzip 상한을 앞선 병합이 올린 32,500과 33,800에서 31,900과 33,200바이트로 낮추고, 개발 문서에 규칙을 적는다. 상한은 측정한 크기에 약 1%를 더해 100바이트 단위로 올린 값이며, 출력이 상한을 넘어 커지거나 작아지는 변경은 같은 변경 안에서 상한을 고친다.
- PHP 서버가 문서를 렌더하기 전에 하던 데이터 모델 검사를 제거한다. 렌더가 영역과 내장 응답의 모든 값을 바인딩하므로, 데이터 모델 밖의 값은 이미 그곳에서 문서를 실패시킨다. 이 검사는 그 일을 반복했고 1,000행에 약 2.3 ms가 들었다. 렌더하지 않는 JSON 응답은 검사를 유지한다(HY-44). 데이터 모델 밖의 공유 데이터가 문서와 JSON을 실패시킨다는 것을 테스트로 고정한다.
- 브라우저는 더 이상 번들에 든 매니페스트를 검사하지 않는다. `createApplication`은 `checkManifest`를 호출하지 않는다. 에셋 빌드가 아무것도 쓰기 전에 매니페스트를 검사하고, Node 서버는 PHP 서버처럼 시작할 때 `checkManifest`를 호출한다(HY-2). 이 검사는 빌드와 서버 검사의 반복이었고 SSR 스크립트 gzip 바이트 중 471바이트를 차지했다. 에셋 빌드가 잘못된 매니페스트를 거부하고 아무것도 쓰지 않는다는 것을 테스트로 고정한다.
- template 저장소가 이제 generated PHP 프로그램에 namespace를 요구하고 모든 수를 값으로 검사한다. 서버 build는 generated 프로그램을 namespace `Polyspec\Hyper\Program`에 쓰며, ±(2^53 − 1) 밖의 수는 정수든 아니든 요청을 500으로 실패시키고 유지 값이 되지 않는다(HY-38, HY-44).
- 빌드는 이제 generated PHP 프로그램의 네임스페이스를 고정된 `Polyspec\Hyper\Program` 대신 애플리케이션에서 받고(`--php-namespace`, 게시판은 `Polyspec\Hyper\Examples\Board\Program`), `program.json`에 기록한다. 그래서 여러 애플리케이션의 프로그램을 한 PHP 프로세스에서 불러올 수 있으며, 프로세스가 generated 프로그램 하나만 불러온다는 규칙을 제거한다(HY-48). `make template`은 PHP template 패키지의 Composer 복사본도 다시 설치하며, 테스트, 에셋, 서버 빌드가 먼저 실행한다. 패키지 버전이 바뀌지 않으면 Composer가 오래된 복사본을 그대로 두었기 때문이다. `make check`는 `make template-check`로 시작하며, 복사본이 template 저장소와 다르면 실패한다.
- 매니페스트가 이미 가진 정보를 반복하던 속성 `hy-region`과 요청 헤더 `Hy-Region`을 제거한다. 페이지 영역이 아닌 `Hy-Region`을 가진 POST가 액션을 실행했고(앞서 규칙 HY-16으로 막았으며, 이 규칙도 제거한다), 영역 `id`는 있지만 속성이 없는 요소에는 htmx가 HTML 문서 전체를 넣었다. 이제 영역 요소는 `id`가 영역 이름인 요소다(HY-3, HY-36). 확장은 대상이 페이지 영역 요소일 때 JSON을 요청하고, 서버는 htmx가 보내는 `HX-Request`로 영역 요청을 알아본다(HY-15, HY-21). `make templates-check`는 레이아웃과 라우트 템플릿의 모든 영역 배치를 검사하며, 영역 배치에는 블록 인자가 없다.
- HTTPS에서 유지 쿠키 이름은 `__Host-hy-keep`이다. 그래서 형제 서브도메인이 유지 값을 심을 수 없다(HY-39).
- `make bench-browser`에서 Chromium `<thead>` 측정을 제거한다. 이 프로젝트가 아니라 브라우저 동작을 재는 코드였다.
- PHP 서버는 `make server`가 템플릿에서 컴파일한 프로그램으로 렌더한다. PHP가 네이티브 템플릿 확장을 불러왔으면 그 확장으로, 그렇지 않으면 generated PHP 프로그램으로 렌더한다(HY-48). 한가한 기계에서 PHP AST 인터프리터는 1,000행에 15.7 ms, generated 프로그램은 같은 입력에 9.6 ms가 걸렸고 출력은 같았다. 네이티브 확장은 부하가 큰 기계에서만 재서 여기에는 속도를 기록하지 않는다. generated 프로그램은 정의마다 템플릿을 고정하므로, 서버는 모든 영역을 단독으로 렌더해 HTML 정의로 넘긴다. `make test-php`와 `make parity`는 두 프로그램으로 실행한다. `App::open`은 `templates:` 대신 `program:`을 받고, `TemplateLoader`를 제거했다.
- JSON 응답은 유지 값을 영역 데이터와 따로 담는다(HY-17). `regions`는 로더 데이터를 담고, `kept`는 형태가 맞는 `server`와 `cookie` 값을 담는다. 서버는 문서를 렌더할 때 이 값을 적용하고, 브라우저는 자기 값과 함께 적용한다. 그래서 브라우저도 렌더를 깨는 유지 값을 빼고 영역을 렌더할 수 있다(HY-38).
- 서버는 더 이상 쿠키의 UTF-8을 검사하지 않는다(HY-42). 쿠키가 만료될 때까지 모든 요청에 400으로 응답하는 대신, 잘못된 `hy-keep`은 무시하고 잘못된 세션 쿠키에는 새 세션을 시작한다.
- 권장 배포는 서버 하나가 직접 요청에는 SSR로, htmx 요청에는 JSON으로 응답하는 방식이다. 정적 셸은 JSON만 제공하는 백엔드를 위한 것이다(`docs/operations/deployment.ko.md`).

### 추가

- `make bench`로 성능을 측정한다(`docs/operations/benchmark.ko.md`). `make bench-server`는 요청 종류별 `App::handle` 시간과 10~1,000행의 렌더, 데이터 모델, JSON 비용을 잰다. `make bench-browser`는 첫 화면, 영역 이동, `hy-set` 변경 1회의 단계별 시간(hyper, 템플릿 엔진, 파싱, htmx morph, `htmx.process`)과 메인 스레드 부하, 50 ms를 넘는 작업의 구성, 200회 이동 중 메모리와 두 힙 스냅샷 사이에 늘어난 객체 및 그 리테이너, 넣었다 뺀 `<thead>`마다 Chromium이 보유하는 `blink::MediaQuerySet`을 잰다. 2026-10-01 측정에서 1,000행 `hy-set` 변경은 22~25 ms였고, 그중 htmx morph가 13~15 ms, 템플릿 엔진이 3 ms였다. DOM 노드와 이벤트 리스너는 200회 동안 일정했다.
- 영역 데이터를 새로고침 후에도 유지한다(HY-37 ~ HY-41).
  - 영역은 유지 경로와 그 저장소를 선언한다.
    - `server`: 서버 세션. 렌더가 기다리지 않는 백그라운드 요청으로 저장한다.
    - `cookie`: 브라우저 코드가 쓰는 `hy-keep` 쿠키
    - `localStorage`
    - `sessionStorage`
  - 서버는 렌더 전에 `server`와 `cookie` 값을 적용하므로, 첫 SSR 문서가 그 값을 보여준다.
  - 브라우저는 응답을 렌더하기 전에 `localStorage`와 `sessionStorage` 값을 적용하고, 서버 문서에서는 불러온 뒤에 적용한다.
  - 유지 값은 값의 형태가 같은 기존 경로에서만 로더 값을 대체한다(HY-38). `conformance/keep.json`은 PHP와 JavaScript가 함께 통과하는 사례를 담는다.
  - 공유 데이터는 이제 항상 `csrf`를 담는다.
- 게시판 예제에서 네 종류를 모두 쓴다. 공지 닫기(`server`), 정렬(`localStorage`), 좁게 보기(`sessionStorage`), 게시글 페이지의 큰 글자(`cookie`)다.

- 데이터로 화면을 제어한다(HY-29 ~ HY-36).
  - 라우트는 라우트 영역을 선언하고, 라우트 템플릿은 이를 `{# name}`으로 배치한다. 라우트 영역마다 자기 로더를 가진다.
  - 레이아웃은 예약 템플릿 `hyper/data.tpl`을 통해 `{# data}`로 문서 JSON을 내장한다. 따라서 첫 SSR 페이지도 자기 데이터를 보관한다.
  - 브라우저 코드는 `data`, `render`, `set`을 제공한다. `hy-set="path=value"`를 가진 요소는 요청 없이 자기 영역의 데이터를 바꾸고 그 영역을 다시 렌더한다. 변경 추적은 없다.
- 템플릿을 라우트별로 전달한다(HY-34, HY-35).
  - 에셋 빌드는 템플릿마다 해시를 붙인 AST 파일 하나와 색인을 쓴다. 클라이언트 번들에는 색인만 들어 있다.
  - 영역 요청은 데이터와 동시에 그 라우트의 템플릿을 불러오고, 리다이렉트 뒤에는 최종 라우트의 템플릿을 불러온다.
- 게시판 예제에 공지와 목록 라우트 영역을 추가한다. 공지 닫기와 목록 정렬은 요청 없이 영역 데이터를 바꾼다. HC-7을 정의하고 템플릿 파일 하나를 4,096 gzip 바이트로 제한한다.

- 화면 구성 규칙(HC-1 ~ HC-6)을 `docs/spec/composition.ko.md`에 정의한다. 내용만 다른 부분은 HTML과 CSS로, 데이터를 받는 부분은 블록으로, 독립적으로 갱신되는 부분은 영역으로 만들고, `hx-*` 속성은 레이아웃에만 둔다. HC-6을 검사하는 `make templates-check`를 추가한다. 2026-10-01 검증: `make templates-check`는 게시판 템플릿 7개에서 통과했고, `hx-get` 속성을 추가한 페이지 템플릿에서 실패했다.
- 영역 프로토콜(HY-1 ~ HY-28)을 `docs/spec/protocol.ko.md`에 정의한다. 애플리케이션 매니페스트, 라우팅, 렌더, 요청, JSON 응답, 브라우저 코드, 액션, 오류를 다룬다.
- 게시판의 레이아웃, 제목, 영역, 라우트를 매니페스트 하나 `examples/board/app/app.json`에 선언한다. PHP와 브라우저가 이 파일을 읽는다.
- PHP 라우터와 브라우저 라우터를 추가하고, 두 라우터가 함께 통과하는 라우터 사례 `conformance/routes.json`을 추가한다.
- 브라우저 코드 `@polyspec/hyper`를 추가한다. 포함하는 기능은 다음과 같다.
  - htmx 4 확장: `hy-region`이 표시된 대상에 JSON을 요청하고, 응답 URL을 라우팅하고, 서버 라우트와 브라우저 라우트가 같은지 확인한 뒤 영역을 렌더한다.
  - 문서 렌더
  - 기본 경로를 쓰는 정적 셸에서의 클라이언트 렌더
- PHP 서버 `polyspec/hyper`를 추가한다. 다음과 같이 응답한다.
  - 문서, 문서 JSON, 영역 JSON
  - 성공한 액션에는 303 리다이렉트, 거부한 입력에는 422 페이지
  - 바뀐 주제에 따른 영역 선택과 기본 경로 처리
  - 없는 리소스에는 404
- 게시판 예제를 추가한다. 포함하는 내용은 다음과 같다.
  - 목록, 상세, 글쓰기 페이지와 서버 검증
  - JavaScript 없는 동작
  - 파일 하나로 된 CSR 셸
  - CDN 동작을 재현하는 엣지 서버
  - SSR과 CSR을 두 프레임으로 보여주는 비교 페이지
- 에셋 빌드, 동일성 검사, 번들 크기 검사, 문서 검사, 배포 문서, 종단 간 테스트를 추가한다.

### 검증

- 2026-10-02, 매니페스트 검사를 브라우저에서 옮긴 뒤: `make check` 통과(종료 상태 0). `make test-scripts` 테스트 3개, `make test-js` 165개, `make test-node` 248개, 각 프로그램으로 `make test-php` 224개, `make parity`, `make server-parity` 응답 41개, `make bundle-size`(SSR 31,586, CSR 32,892 gzip 바이트), `make e2e` 12개
- 2026-10-01, 별도 server package를 이 저장소로 병합하고 네임스페이스를 변경한 뒤: `make check` 통과(종료 상태 0). template 복사본이 template 저장소와 같음, `make test-js` 테스트 165개, `make test-node` 테스트 248개, `make test-php`는 generated 프로그램으로 224개와 네이티브 확장으로 224개(해당하지 않는 1개는 건너뜀), 두 프로그램 모두로 `make parity`, `make server-parity` 응답 41개, `make bundle-size`(SSR 32,500 중 32,057, CSR 33,800 중 33,364 gzip 바이트), `make e2e` 테스트 12개
- 2026-10-01, `hy-region`, `Hy-Region` 제거와 스왑, 유지 값, 리다이렉트, 세션의 수정 뒤: `make check` 통과. `make test-scripts` 테스트 2개, `make test-js` 테스트 145개, `make test-php`는 generated 프로그램으로 149개와 네이티브 확장으로 149개(해당하지 않는 테스트 1개는 건너뜀), 두 프로그램 모두로 `make parity`, `make bundle-size`, `make e2e` 테스트 12개
- 2026-10-01, 컴파일된 템플릿 프로그램으로 바꾼 뒤(HY-48): `make check` 통과.
  - `make test-php`: generated 프로그램으로 테스트 148개 통과, 네이티브 확장으로 148개 통과. 확장에서는 두 번째 generated 프로그램을 불러오는 테스트가 해당하지 않아 건너뛴다.
  - `make parity`: 비교 단계 10개가 generated 프로그램과 네이티브 확장 모두에서 바이트 단위로 같았다.
  - `make test-js` 테스트 139개, `make e2e` 테스트 12개, `make bundle-size` 통과
- 2026-10-01, 호출 순서, 저장, 요청 검사의 수정 뒤, 환경: macOS, Node.js 26.8.1, PHP 8.5.10, Playwright 1.63.0의 Chromium. `make check` 통과.
  - `make test-js`: 유지 값 적합성 사례 31개를 포함한 테스트 139개와 타입 검사 통과
  - `make test-php`: 같은 유지 값 사례 31개를 포함한 테스트 145개 통과
  - `make parity`: 비교 단계 10개가 바이트 단위로 같았고, 404 단계 3개는 404를 반환했다.
  - `make bundle-size`: SSR 스크립트 31,043 gzip 바이트(상한 31,400), CSR 셸 32,345 gzip 바이트(상한 32,600), 가장 큰 템플릿 파일 1,325 gzip 바이트
  - `make e2e`: 테스트 12개 통과
- 2026-10-01 환경: macOS, Node.js 26.8.1, PHP 8.5.10, Playwright 1.63.0의 Chromium. `make check` 통과.
  - `make test-js`: 라우터 적합성 사례 51개와 유지 값 적합성 사례 17개를 포함한 테스트 94개와 타입 검사 통과
  - `make test-php`: 같은 라우터 사례 51개와 유지 값 사례 17개를 포함한 테스트 90개 통과
  - `make parity`: 비교 단계 10개에서 문서 JSON의 브라우저 렌더 결과가 PHP 문서와 바이트 단위로 같았고, 모든 영역 부분이 그 문서에 나타났다. 이 단계에는 라우트 영역, 내장 데이터, `server`와 `cookie` 유지 값, 매개변수 라우트, 쿼리 문자열, 422 응답, HTML 특수문자가 들어간 제목과 본문이 포함된다. 404 단계 3개는 404를 반환했다.
  - `make bundle-size`: SSR 스크립트 29,619 gzip 바이트, CSR 셸 30,755 gzip 바이트, 가장 큰 템플릿 파일 1,325 gzip 바이트, 템플릿 파일 11개 합계 5,655 gzip 바이트
  - `make e2e`: 테스트 9개 통과. SSR과 CSR 흐름, 데이터 요청 없는 SSR과 CSR의 `hy-set` 변경, SSR과 CSR에서 새로고침과 새 탭에 걸친 유지 종류 네 가지, CSR이 라우트별 템플릿만 불러오기, JavaScript 없는 흐름, 비교 페이지를 포함한다.
