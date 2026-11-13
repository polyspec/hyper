<!-- doc-id: features -->
<!-- source-sha256: 3ab29d5447d2b2e00b8f5e4ec0b114dcb8660c6d1ed956b7b8c329fb566baa7d -->
# 기능 상태

[English](features.md).

[릴리스 0.0.23](https://github.com/polyspec/hyper/releases/tag/v0.0.23)는 51d8cbb에서 공개되었다. PHP 8.4.27을 사용한 check group 5개와 `ci-passed`가 [CI 실행](https://github.com/polyspec/hyper/actions/runs/41039924973)에서 통과했고 [정책 gate](https://github.com/polyspec/hyper/actions/runs/41039924928)도 통과했으며, [릴리스 실행](https://github.com/polyspec/hyper/actions/runs/41041100350)이 `polyspec-hyper-client-npm-0.0.23.tgz`, `polyspec-hyper-npm-0.0.23.tgz`, `polyspec-hyper-cli-npm-0.0.23.tgz`, `polyspec-hyper-php-0.0.23.zip`, `polyspec_hyper-0.0.23-py3-none-any.whl`와 `polyspec/hyper`의 Composer repository인 `packages.json`(kit K871), asset 여섯 개를 게시했다. template 0.0.15와 Kit 0.0.78에 의존한다.

| ID | 기능 | 상태 | 근거 |
|---|---|---|---|
| protocol | 영역 프로토콜 명세(HY-1 ~ HR-94) | implemented | [프로토콜](spec/protocol.ko.md) |
| rust-core | server 규칙의 Rust core, `packages/rust`의 `polyspec-hyper`(C-7): HY-132의 오류와 인터페이스 계약이 kind로 나열하는 variant를 가진 각 오류의 code `Error::code`, 406과 `Vary`를 가진 media 선택(HY-116, HY-117, HY-119), representation entry·body·응답 검사(HY-118, HY-121, HY-122), tag(HY-53, HY-122.10), cookie 이름과 session cookie(HY-45, HY-38.10), reply 값(HY-52, HY-69, HY-103), 애플리케이션 경로와 page 상태(HY-46, HY-58), manifest와 그 검사(HY-1, HY-2, HY-37, HY-40.2, HY-118), rest 매개변수와 base path를 가진 route(HY-4부터 HY-8, HY-49), JSON 텍스트(HY-54.18부터 HY-54.21), 읽는 데이터(HY-73.29), token과 `browser()`(HY-24), ORM 응답(HY-107), 요청의 순서(HY-120), region 데이터에 맞는 kept 값과 cookie `hy-keep`(HY-38.2부터 HY-38.13까지, HY-38.19), 공유 데이터 안의 context 자리, 그 JSON 텍스트, hash, member `context`, header `Hyper-Context`(HY-10.3, HY-125.10, HY-125.12, HY-127.2, HY-128.2), 그리고 page 조립: 공유 데이터, 현재 경로, 바뀐 topic, 응답의 region, 응답이 보내는 kept 값, JSON 값, 문서의 embedded data(HY-10.2, HY-11.3, HY-11.4, HY-17, HY-18, HY-19, HY-31.2, HY-31.3, HY-38.8, HY-128.1), template 엔진으로 하는 문서 렌더(kept 값으로 렌더하지 않는 region의 kept 값 포함, HY-12, HY-13, HY-31, HY-38.12부터 HY-38.18까지), core가 애플리케이션의 각 handler를 host에게 부르라고 요청하는 단계로서의 요청 page(HY-26, HY-58.3, HY-124.2부터 HY-124.4까지, HY-18, HY-75, HY-92), client 렌더 선언과 data base path 밖의 선택된 요청의 답(HY-62), plain 거부를 포함한 page 앞 요청의 라우팅(HY-62.16부터 HY-62.23까지, HY-40, HY-27.6, HY-116, HY-127.2, HY-59.12), page의 헤더(HY-15.3, HY-52, HY-53, HY-65, HY-117.1, HY-45), kept endpoint의 값(HY-40.1), token 검사를 포함한 page와 kept endpoint의 session(HY-120.6, HY-120.7, HY-24, HY-25.2, HY-59.8, HY-40.1); 그 interface 계약 `packages/rust/interface.json` | 일부; 세 server는 S-4까지 부르지 않는다 | `make core-test`, `make core-lint`, `make core-fmt-check` |
| native-modules | binding scaffold가 쓰는 host package의 `packages/<lang>/native/` native module(binding L-2a): PHP 확장 package `polyspec/hyper-native`, Python module `polyspec.hyper._binding._native`, Node addon `hyper.<target>.node` | partial: binding의 contract check는 `packages/php/composer.json`의 requirement `ext-polyspec_hyper`와 `packages/ts/package.json` `files`의 생성 entry `native/generated/index.cjs`, `index.mjs`, `index.d.ts`, 그리고 그 `optionalDependencies`의 platform별 addon package `@polyspec/hyper-linux-x64-gnu`, `@polyspec/hyper-linux-arm64-gnu`, `@polyspec/hyper-darwin-arm64`(binding T-2)에 CK-19를 보고한다. 확장이 있기 전에는 그 requirement가 모든 install을 실패시키므로, binding을 생성하고 확장을 빌드하는 변경이 이것들을 넣는다 | `binding check packages/rust/interface.json` |
| go-wasm-bindings | `packages/rust/interface.json`의 target `go`와 `wasm`을 위한 Go binding `packages/go`(module `github.com/polyspec/hyper/packages/go`, C ABI crate `packages/go/internal/ffi`)와 npm package `@polyspec/hyper`의 WASM binding, 그리고 `make bindings`, `make bindings-check`, `make lint-bindings`, `make test-bindings`, `make node-package`, `make test-wasm`, `make test-go` | partial: binding 1bf0025의 scaffold가 다섯 target의 binding crate를 썼고, core를 `../../../rust`로 두는 `packages/ts/native/wasm`의 WASM crate `polyspec-hyper-wasm`도 그중 하나이며, 모두 root workspace의 member다(GN-4). 생성기는 소스를 쓰지 않는다: Go는 class unit을, WASM은 host Node package의 binding을 거부한다. core는 feature `fault-test`를 가지며, `make core-test`가 `packages/rust/tests/cases/faults.json`의 case로 `hyper.internal`, `http_negotiation.internal`, `template.internal`, `session_store.internal`을 장전한다. scaffold가 쓰는 binding crate는 http-negotiation과 template의 feature가 아니라 core의 feature만 켠다. Go 1.27.3과 wasm-bindgen 0.2.130은 linux-arm64, linux-x64, macos-arm64에 대해 `mise.toml`과 `mise.lock`의 도구다 | `make bindings-check`, `make test-go`, `make test-wasm` |
| build-id | 한 build가 id 없이 쓰는 모든 파일의 build id, 그 자리의 경로, 해시가 빼는 파일, build id 형식과 `build.json`(HY-125.3, HY-125.15~HY-125.20): Rust core의 `build::id`, `build::check_id`, `build::file_text`, `build::read` | partial: core가 계산한다. 명령 도구가 core를 부르기 전까지(H-8) `hyper build`는 `packages/cli/lib/build-id.mjs`로 HY-125.15의 경로에 대해 한 번 계산하고 같은 `build.json`을 `client/`와 `program/`에 쓴다(HY-125.21) | `make core-test`, `tests/scripts/build-id.test.mts` |
| template-rules | Rust core의 HY-48.3 템플릿 검사 `template_rules::problems`. 모든 문제를 HY-48.13 순서로 준다: HC-6, `{# title}`, `{# data}`, `{# build}` 배치, HY-3, HY-30, HY-75의 manifest 영역과 라우트 영역 | partial: core는 `contracts/manifest.json`의 `templateChecks` case에서 `packages/cli/lib/template-rules.mjs`와 같은 문제를 준다. 명령 도구가 core를 부르기 전까지(H-8) `hyper build`, `hyper check`, `make templates-check`는 이전 구현을 부른다 | `make core-test`, `tests/scripts/build-id.test.mts` |
| read-path-rules | Rust core의 HY-73.2~HY-73.20 읽기 경로: `read_paths::route_reads`는 manifest와 템플릿 소스로 `reads.json`의 routes를, `read_paths::template_reads`는 템플릿 하나의 node를 준다(HY-73.30) | partial: core는 `contracts/reads.json`의 `cases`와 `routes` case에서 `packages/client/src/reads.ts`의 `routeReads`, `templateReads`와 같은 읽기 경로를 준다. 명령 도구와 Node 서버가 core를 부르기 전까지(H-8) `hyper build`와 Node 서버는 브라우저 package로 계산하며, `hyper build`는 `reads.json`의 키를 HY-73.32 순서가 아니라 브라우저 package가 읽은 순서로, 정수인 키를 먼저 쓴다 | `make core-test`, `make hyper-test-js` |
| data-template-rule | Rust core의 `render::data_template`가 주는 예약 템플릿 `hyper/data.tpl`의 이름과 소스(HY-31.9) | partial: core는 `contracts/build.json`의 case `dataTemplate`에서 `packages/client/data-template.json`이 담은 것과 같은 이름과 소스를 준다. 명령 도구와 서버는 core를 부르기 전까지(H-8) 브라우저 package에서 그것을 받는다 | `make core-test`, `tests/scripts/build-id.test.mts` |
| legacy-data-template | core를 부르지 않는 서버를 위한 예약 템플릿의 사본 `program/legacy/hyper/data.tpl`. build는 `program/templates/hyper/data.tpl` 대신 그것을 쓰고(HY-31.10), Python 서버는 그것을 필요로 하며 `program/templates/`와 함께 읽는다(HY-48.14) | not implemented: `hyper build`는 `program/templates/hyper/data.tpl`을 쓰고 `program/legacy/`를 쓰지 않으며, Python 서버는 예약 템플릿을 `program/templates/`에서 읽고 `legacy/hyper/data.tpl`이 없어도 실패하지 않는다(H31.4-2) | — |
| node-core-rules | Node 서버 unit의 이름으로 주는 core의 규칙. `packages/ts/src/core/rules.ts`의 `coreRules`가 core의 Node binding module을 받는다(HY-132.2) | not implemented: 서버의 어떤 unit도 이것을 부르지 않고 core의 Node binding은 build되지 않았다. `tests/scripts/node-core.test.mts`는 binding module의 대역으로 그 호출을 적으며 실행되지 않았다(H31.20, H31.7) | — |
| composition | 애플리케이션 작성 규칙(HC-1 ~ HC-7)과 HC-6에 대한 HY-48 템플릿 검사 | documented; template check implemented | [화면 구성](operations/composition.ko.md), `make templates-check` |
| manifest | PHP와 브라우저가 읽는 애플리케이션 매니페스트 | implemented | `make test-php`, `make test-js` |
| router | 적합성 사례를 공유하는 PHP 라우터와 브라우저 라우터 | implemented | `make test-php`, `make test-js` |
| rest-routes | 라우트 경로 끝의 나머지 매개변수 `{name*}`(HY-49) | implemented | `make test-php`, `make test-js` |
| stop-results | loader와 action의 redirect, 금지 결과(HY-50, HY-51) | implemented | `make test-php`, `make recipe-run-php`, `make recipe-run-node`, `make recipe-run-python`이 실행하는 `contracts/result.json`의 case |
| page-statuses | loader와 action의 잘못된 요청 멈춤, 200, 409, 422로 페이지를 렌더하는 action 결과(HY-58) | implemented | `make test-php`, `make hyper-test-node`, `make recipe-run-php`, `make recipe-run-node`, `make recipe-run-python`이 실행하는 `contracts/result.json`의 case |
| page-forbidden | loader나 action은 reply로 그 요청의 페이지에 상태 403을 준다. 요청이 볼 수 없는 데이터 대신 다른 데이터를 보이는 페이지를 위한 것이다(HY-69) | implemented | `make test-php`, `make hyper-test-node`, `make recipe-run-php`, `make recipe-run-node`, `make recipe-run-python`이 실행하는 `contracts/reply.json`의 case |
| body-checks | 애플리케이션의 body 한도와 받는 폼 type, 413, 415, CSRF 403 순서의 검사(HY-59) | implemented | `make test-php`, `make hyper-test-node`, `make server-parity` |
| failure-cache | 상태가 400 이상인 모든 응답의 `Cache-Control: no-store`(HY-65) | implemented | `make test-php`, `make hyper-test-node` |
| response-limit | 애플리케이션의 응답 한도. 더 큰 body는 보내지 않고 요청은 텍스트 500을 받는다(HY-66) | implemented | `make test-php`, `make hyper-test-node` |
| disconnect-hook | client가 연결을 닫은 요청의 연결 끊김 hook. Node 서버는 요청을 멈추고, PHP는 첫 실패한 쓰기에서 script를 끝내며, Python 서버는 응답의 첫 실패한 쓰기를 알린다(HY-67) | implemented | `make test-php`, `make hyper-test-node`, `make hyper-test-python-render` |
| response-hook | 모든 응답마다 요청, 응답, 경과 시간, note를 가진 요청의 reply, 500의 실패로 한 번 호출하는 응답 hook(HY-60) | implemented | `make test-php`, `make hyper-test-node`, `make recipe-run-php`, `make recipe-run-node`, `make recipe-run-python`이 실행하는 `contracts/reply.json`의 case |
| escaped-error | 요청의 answer를 벗어난 오류의 평범한 500은 모든 adapter에서 같다. PHP와 Node에서는 호출자가 hyper가 요청을 받기 전에 설정한 header를 유지한다. 받은 그대로의 요청과 오류의 failure와 함께 쓰기 hook에 한 번 보고되며, 어떤 응답 hook에도 보고되지 않는다(HY-60, HY-99, HY-100) | implemented | `make test-python`, `make hyper-test-node`, `make test-php`, `make hyper-test-python-render` |
| write-hook | 모든 서버의 쓰기 hook `written`은 애플리케이션이 답한 요청마다 한 번 호출되며, 요청, 쓰기를 시작한 응답, 쓰기가 끝났는지, 경과 시간과 탈출 오류의 failure를 받는다. Node의 `App.listener`의 listener는 그 뒤에 settle된다(HY-99, HY-100) | implemented | `make test-php`, `make hyper-test-node`, `make test-python`, `make hyper-test-python-render` |
| client-shell | 한 서버가 요청마다의 선택(요청의 모든 handler가 그 값을 읽는다)에 따라 클라이언트 렌더 페이지에는 정적 셸과 데이터 기본 경로 아래의 JSON으로, 서버 렌더 페이지에는 그 경로 없이 응답하며, 브라우저는 `html` 요소에 렌더한 layout의 속성을 준다(HY-62, HYC-6) | implemented | `make test-php`, `make hyper-test-node`, `make test-js`, `make e2e` |
| stylesheet-links | 브라우저는 클라이언트 렌더 문서, 영역 응답의 layout, 히스토리 복원 문서의 head에 있는 stylesheet link를 적용한다. 있는 link는 유지하고, 없는 link는 내용을 보이기 전에 불러오며, 그 뒤 나머지를 제거한다(HYC-15) | implemented | `make test-js`, `make e2e` |
| module-scripts | 브라우저는 클라이언트 렌더 문서, 영역 응답의 layout, 히스토리 복원 문서의 head에 있는 module script 중 페이지가 그 주소를 가지지 않은 것을 head의 순서로 만들고, 불러온 뒤 내용을 보이며, 아무것도 제거하지 않는다. 정적 셸은 진입 파일을 `<meta name="hyper-entry">`로 선언한다(HYC-25, HYC-16) | 진행 중: 브라우저 코드와 board 예제가 `make hyper-test-js`와 `make e2e`를 통과한다. 전체 실행은 아직 검증하지 않았다 | `make hyper-test-js`, `make e2e` |
| reply | loader와 action의 응답 cookie와 cache control, JSON tag와 304(HY-52, HY-53) | implemented | `make test-php`, `make recipe-run-php`, `make recipe-run-node`, `make recipe-run-python`이 실행하는 `contracts/reply.json`의 case |
| referrer-policy | page와 JSON 응답의 `Referrer-Policy` header를 정하는 명명된 reply 메서드 `referrerPolicy`, Referrer-Policy 명세의 토큰만 받는다(HY-103) | implemented | `make test-php`, `make hyper-test-node`, `make test-python`, `make hyper-test-python-render`, `make recipe-run-php`, `make recipe-run-node`, `make recipe-run-python`이 실행하는 `contracts/reply.json`의 case |
| csrf | 모든 응답의 가린 CSRF 토큰, 세션 쿠키 `__Host-hy-session` 또는 `hy-session`, 액션의 세션 갱신, 페이지의 공유 캐시 금지(HY-24, HY-45, HY-52, HY-53, HY-72) | implemented | `make test-php`, `make hyper-test-node`, `make server-parity` |
| browser | 세 server에서 request의 `browser()`: 세션 토큰의 소문자 16진 SHA-256 digest이며, 토큰이 갱신될 때까지 한 세션의 모든 요청에서 같고, 세션이 없는 요청에서는 없다(HY-24.10~HY-24.13, HY-106.12) | 진행 중: 세 server가 `contracts/csrf.json`의 case를 통과한다. 전체 실행은 아직 검증하지 않았다 | `make recipe-run-php`, `make recipe-run-node`, `make recipe-run-python` |
| read-paths | 템플릿 AST로 계산한 라우트마다의 읽기 경로. PHP를 위해 `reads.json`에 쓰고 Node 서버는 열 때 계산한다. 두 서버는 공유 데이터와 영역 데이터에서 그 경로만 보낸다(HY-44, HY-73) | implemented | `make test-js`, `make test-php`, `make hyper-test-node`, `make server-parity` |
| php-errors | PHP 요청의 경고, 알림, 폐기 예정 알림은 틀린 페이지 대신 상세 없는 500으로 요청을 실패시킨다(HY-74) | implemented | `make test-php` |
| absent-route-regions | 로더가 null을 돌려주는 라우트 영역은 응답에 없다. 라우트 템플릿이 포함하거나 배치하는 템플릿도 라우트 영역을 배치할 수 있다. 브라우저는 모든 라우트 영역의 요소를 확인한다(HY-30, HY-75) | implemented | `make test-js`, `make test-php`, `make hyper-test-node`, `make templates-check`, `make server-parity` |
| php-analysis | 레벨 `max`의 PHPStan이 기준선이나 무시하는 오류 없이 PHP 서버 패키지의 소스와 테스트를 검사한다 | implemented | `make analyse-php` |
| hyper-client | 브라우저 코드: 영역과 문서 렌더, htmx 확장, 클라이언트 렌더 | implemented | `make test-js`, `make e2e` |
| hyper-php | PHP 서버: 라우트, 액션, CSRF, flash, 바뀐 주제, 기본 경로, 문서와 JSON | implemented | `make test-php` |
| hyper-node | server protocol의 Node.js 구현 `@polyspec/hyper`, 파일 session(HY-104), PHP 구현과 같은 바이트의 JSON, board 예제 서버(HY-54) | implemented | `make hyper-test-node`, `make node-server` |
| python-request-hook | Python 서버 `create_server`의 요청 hook `around`. 요청과 `answer`를 받고, `Request.with_header`로 요청을 바꾸거나 응답을 바꾸며, session과 애플리케이션의 hook 없이 혼자 응답할 수 있다 (HY-97) | implemented | `make test-python`, `make hyper-test-python-render` |
| hyper-python | server protocol의 Python 구현 `polyspec-hyper`. template Python package로 렌더하고 file session(HY-104)과 `http.server` 서버, WSGI application callable(H19.1), ASGI application callable(H19.2), board 예제 서버를 둔다 (H15.3) | implemented | `make test-python`, `make hyper-test-python-render`, `make server-parity-python` |
| route-regions | 자기 로더를 가진 페이지 안의 라우트 영역(HY-30) | implemented | `make test-php`, `make parity` |
| region-data | 라우트 영역의 내장 데이터, 요청 없이 라우트 영역에서 동작하는 `data`, `render`, `set`, `hy-set`, 데이터 공개 규칙(HYC-10 ~ HYC-11, HYC-5, HY-71) | implemented | `make test-js`, `make e2e` |
| kept-data | 서버 세션, 쿠키, localStorage, sessionStorage의 유지 경로(HY-37 ~ HY-40) | implemented | `make test-php`, `make test-js`, `make parity`, `make e2e` |
| template-delivery | 템플릿마다 파일 하나, 렌더가 그 템플릿에 닿을 때 불러온다(HR-34, HYC-12) | implemented | `make test-js`, `make e2e`, `make bundle-size` |
| tailwind-build | `--tailwind <source>=<output>`은 application stylesheet를 Tailwind theme과 template이 쓰는 utility로 compile한다(HR-77) | implemented | `make hyper-test-scripts` |
| asset-delivery | 페이지는 자기가 쓰는 자원만 요청한다. `import()`로 불러오는 클라이언트 조각, 진입 파일 URL만 담은 매니페스트, 스타일시트 없는 정적 셸(HYC-16) | implemented | `make hyper-test-scripts`, `make e2e` |
| parity | 브라우저의 문서와 영역이 PHP 문서와 바이트 단위로 같음 | implemented | `make parity` |
| server-parity | 모든 parity 단계에서 Node 서버 응답이 상태, header, body까지 PHP 응답과 같음(HR-55) | implemented | `make server-parity` |
| ssr | JSON 이동과 JavaScript 없는 동작을 갖춘 서버 렌더 | implemented | `make e2e` |
| csr | 정적 `index.html` 하나와 `/api` JSON을 쓰는 클라이언트 렌더 | implemented | `make e2e` |
| comparison | SSR과 CSR 프레임을 담은 비교 페이지 | implemented | `make e2e` |
| bundle-size | SSR 스크립트, CSR 셸, 템플릿 파일 크기를 상한과 비교해 측정하며, 상한을 넘는 크기는 실패가 아니라 warning이다 | implemented | `make bundle-size`, `tests/scripts/check-bundle-size.test.mts` |
| npm-packages | `@polyspec/hyper-client`와 `@polyspec/hyper`는 Node가 `node_modules`에서 실행하는 JavaScript와 type 선언을 배포하며, 소스는 `erasableSyntaxOnly`를 통과한다(HR-61) | implemented | `make package-check` |
| build-package | `@polyspec/hyper-cli`는 하위 명령 `hyper build`와 `hyper check`를 가진 bin `hyper` 하나를 배포하고, 그 모듈은 배포하는 파일, Node, manifest가 요구하는 패키지만 import한다. consumer는 릴리스 tarball에서 이것을 설치하고 어느 작업 디렉터리에서나 `hyper build`를 실행한다(HR-96) | implemented; 규칙은 H-8까지 TypeScript에서 부른다 | `tests/scripts/package-source.test.mts` |
| server-build-inputs | board 서버 빌드는 설치된 소스 의존성을 사용하며 Composer 설치는 명시적인 작업으로 유지한다(HR-79) | implemented | `tests/scripts/check-recipes.test.mts`, `make board` |
| output-files | `hyper build`는 복사한 출력 파일에 어떤 umask에서도 mode 0644를, 디렉터리에 0755를 주어 다른 사용자가 읽을 수 있게 하며, Linux container의 virtiofs bind mount는 이를 받아들인다(HR-68) | implemented | `make hyper-test-scripts`, Darwin에서 `make virtiofs-check` |
| template-dir | `hyper build`와 template build는 npm이 template release의 tarball에서 설치하는 template package `@polyspec/template`과 `@polyspec/template-compiler`를 package 이름으로 읽고, Composer는 `polyspec/template`을 template release의 zip에서 설치하며, 공개 manifest는 정확한 template version을 요구한다(HR-70) | implemented | `make hyper-test-scripts` |
| template-ext | 네이티브 template 확장은 template release `TEMPLATE_VERSION`(`0.0.27`)의 package `polyspec/template-php-ext`이다. `make hyper-install`이 `make template-ext`를 실행하고, 그것이 release의 Composer repository(`packages.json`, 그 dist가 php-ext zip을 sha1로 pin한다)에서 PIE로 `var/pie`에서 build해 `build/ext/polyspec_template.so`를 게시한다. `make ext`는 그 library만 요구하며 offline으로 실행된다. 어떤 recipe도 확장을 위해 template 저장소를 읽거나 복사하지 않는다(H14.1-7, H27.45) | implemented | `tests/scripts/template-ext.test.mts`, `tests/scripts/template-pins.test.mts`, `make ext`, `make test-php` |
| ci-suite | 전체 suite는 `main`의 push와 모든 수동 실행에 대해 GitHub에서 CI group마다 job 하나로 모든 target을 끝까지 실행하고, job summary와 각 target의 상태, 시간, 첫 실패 줄, 전체 log를 담은 보고서를 upload한다(HR-91) | implemented | `tests/scripts/ci-workflow.test.mts` |
| ci-steps | 애플리케이션 CI job은 commit으로 pin한 action으로 시간 제한 없이 `ubuntu-26.04-arm`에서 실행하고 각 명령 step은 make target 하나를 실행한다(HR-90). 공유 release와 gate workflow는 설치된 공유 도구의 runner 설정을 사용한다 | implemented | `tests/scripts/ci-workflow.test.mts` |
| publish-main | 버전 0.1 전까지 변경은 pull request, merge queue, ruleset 없이 checklist의 모든 작업이 끝났을 때 `main`에 한 번 push한다. `main`의 push는 CI workflow를 실행하며, 그 마지막 job `ci-passed`는 workflow의 다른 모든 job이 통과했을 때만 통과한다(HR-94) | implemented | `tests/scripts/ci-workflow.test.mts` |
| no-live-inputs | 어떤 recipe도 registry에 질의하지 않고, 모든 recipe는 npm, Composer를 offline으로 실행하며 설치 target만 download하고, 없는 download는 그것을 만드는 설치 target을 밝히며, `tests/package-install`은 lock에서 offline 설치하며, test는 event로 순서를 정하고, test 서버는 system이 정한 port에서 listen하며, 서버 시작은 진행을 출력하고, 빈 목록은 검사를 실패시킨다(HR-89) | implemented | `tests/scripts/toolchain.test.mts`, `tests/scripts/board-servers.test.mts`, `tests/scripts/check-bundle-size.test.mts`, `packages/ts/tests/http.test.ts` |
| owner-check | 추적하는 모든 경로는 `config/owner-checks.json`에 owner를 가지고, `make owner-validate`가 이를 검사하며, `make owner-check`는 바뀐 경로의 owner를 실행한다(HR-88) | implemented | `tests/scripts/ignored-files.test.mts` |
| run-resources | run의 서버와 임시 디렉터리는 run이 끝날 때, 실패할 때, SIGINT와 SIGTERM에서 멈추고 지워지며, test는 process가 끝난 뒤에만 디렉터리를 지운다(HR-87) | implemented | `tests/scripts/board-servers.test.mts`, `tests/scripts/check-parity.test.mts`, `tests/scripts/serve-demo.test.mts` |
| all-checks | 여러 검사를 가진 recipe는 각 검사를 끝까지 실행하고 실패한 모든 검사를 밝힌다(HR-86) | implemented | `tests/scripts/check-recipes.test.mts` |
| own-inputs | test는 fixture의 추적 파일을 복사하고, 설치한 template package를 읽으며, 다른 target의 각 입력을 그것을 쓰는 target과 함께 밝힌다(HR-85) | implemented | `tests/scripts/build-assets.test.mts`, `tests/scripts/template-dir.test.mts` |
| checked-results | 실행된 test가 없는 test run, top level에서 await하는 node test 파일, 검사한 step이 없는 parity 검사는 실패하고, native 최종 보고서는 실패 근거를 기록하고 각 target log를 보존한다(HR-84) | implemented | `tests/scripts/check-parity.test.mts` |
| tool-output | 검사는 run 맥락이나 pin하지 않은 release에 따라 바뀌지 않는 형태로 tool 출력을 읽는다. 호출한 make의 변수 없는 make dry run, machine이 읽는 형태, pin한 도구의 text만 읽는다(HR-83) | implemented | `tests/scripts/template-copy.test.mjs` |
| atomic-outputs | 다른 process가 읽는 출력은 rename으로 파일 단위 publish하고, 파일 하나는 rename 한 번으로 쓰며, 설치한 사본은 의존성 tree가 같을 때만 publish하고, package manager 설치와 full run은 lock을 잡는다(HR-82) | implemented | `tests/scripts/publish.test.mts`, `tests/scripts/toolchain.test.mts` |
| toolchain-pin | Node.js, npm, Composer는 정확한 release로, PHP와 Python은 minor release로 추적 파일에 pin한다. npm과 Composer는 digest로 확인해 checkout의 `var/tools`에 설치하고 `PATH`의 맨 앞에 둔다. 없는 도구는 그것을 실행하는 target을 실패시키고(kit K854), CI 보고서는 실행 중인 release를 기록한다(HR-81) | implemented | `tests/scripts/toolchain.test.mts`, `tests/scripts/template-copy.test.mjs` |
| kit-tools | 상속된 offline 설정에서도 명시적 bootstrap은 선언된 다운로드를 허용한다. 문서 검사, commit message 규칙, owner 검사, test runner, CI 보고서, toolchain 설치, 린트, release는 release asset의 URL과 integrity로 pin하고 선택적인 native 로컬 소스 link를 지원하는 npm 패키지 `@polyspec/kit`의 유틸리티이며 `config/*.json`이 이를 설정한다. hyper의 Makefile이 모든 레시피를 담고 각 유틸리티를 명시적 인자로 실행하며, 도구는 hyper의 native 설정(`.npmrc`, `mise.toml`, 린트 설정)을 읽고, 각 유틸리티는 실행할 때 자기가 읽는 `config/*.json`을 schema로 확인한다 | implemented | `make check` |
| template-tag | 릴리즈 선언은 template release `v0.0.27`(`v$(TEMPLATE_VERSION)`)의 asset을 고정하고, 각 설치는 자기가 설치하는 모든 template asset을 그 integrity로 확인한다. npm lock의 sha512, Composer lock의 sha1, `pyproject.toml`과 `uv.lock`의 sha256이다. 어떤 검사도 template checkout을 읽지 않는다(HR-80) | implemented | `tests/scripts/template-pins.test.mts` |
| query-values | 중첩 없이 순서대로 읽는 모든 쿼리 값과 원본 쿼리(HY-56) | implemented | `make test-php`, `make hyper-test-node` |
| file-parts | multipart body의 file part는 method `name()`, `filename()`, `contentType()`, `content()`를 가진 `UploadedFile` 값이고, 세 server에서 `query()`, `form()`, `files()`는 이름과 값 목록의 쌍 목록을 반환한다. 8192 byte보다 긴 part header는 body를 실패시킨다(HY-56.7, HY-106, HY-113, HY-114) | implemented | `make hyper-test-php`, `make hyper-test-node`, `make hyper-test-python`의 `tests/legacy/fields.json`, 즉 http-form가 이제 가진 case(F-20부터 F-27까지)의 고정 사본이며 S-4에서 지운다, `make recipe-run-python` |
| multipart-stream | 한계가 있는 buffer로 조각 단위로 읽는 multipart body, 요청의 임시 file에 두는 file part, value 제한과 part 제한, `UploadedFile`의 `size()`와 `moveTo()`(HY-131) | 진행 중: 세 server의 모든 host가 multipart body를 조각 단위로 요청의 file에 읽고, value 제한과 part 제한과 file 제한에서 멈추며, hook 뒤에 file을 지운다(HY-131). 전체 실행은 아직 검증하지 않았다 | `make hyper-test-php`, `make hyper-test-node`, `make hyper-test-python`의 `tests/legacy/fields.json`, 즉 http-form가 이제 가진 case(F-20부터 F-27까지)의 고정 사본이며 S-4에서 지운다; `docs/plans/execution/checklist.md`의 H29.3부터 H29.5까지, 그리고 `make parity`, `make server-parity`, `make server-parity-python`, `make e2e`의 board 예제 upload |
| form-values | urlencoded body나 multipart body에서 중첩 없이 순서대로 읽는 모든 폼 값이며 세 server가 똑같이 읽는다(HY-57.13, HY-113.21, HY-113.22, http-form의 F-20부터 F-23까지) | implemented | `make hyper-test-php`, `make hyper-test-node`, `make hyper-test-python`의 `tests/legacy/fields.json`, 즉 http-form가 이제 가진 case(F-20부터 F-27까지)의 고정 사본이며 S-4에서 지운다 |
| representations | route의 representation: `Accept`로 `text/html`, `application/vnd.hyper+json`, 선언된 type 중에서 고르는 선택, 매니페스트 검사와 열기 검사, session 없는 handler, `Allow`가 있는 405, `HEAD`, 406, 415, 400, handler 응답의 검사, strong `ETag`와 304, `etag(body)`(HY-116부터 HY-122까지) | 진행 중: 세 server가 답하고 모든 case를 통과한다. 전체 실행은 아직 검증하지 않았다 | `make hyper-test-php`, `make hyper-test-node`, `make hyper-test-python`의 `contracts/representations.json`과 `contracts/client.json` |
| head | body의 `Content-Length`와 함께 body 없이 그 `GET`으로 답하는 `HEAD` 요청, 그리고 모든 405의 `Allow`(HY-27.4부터 HY-27.6까지) | 진행 중: 세 server와 그 host가 답한다. 전체 실행은 아직 검증하지 않았다 | `make hyper-test-php`, `make hyper-test-node`, `make hyper-test-python`의 `contracts/client.json`, `make hyper-test-scripts TESTS=tests/scripts/upload-servers.test.mts` |
| request-boundary | UTF-8 검사, 상세 없는 500 오류, 데이터 모델 검사, 강화한 세션 쿠키, 리다이렉트 검사, 실패 표시(HY-42 ~ HYC-14) | implemented | `make test-php`, `make test-js`, `make e2e` |
| benchmark | 서버와 브라우저 성능 측정: 요청 비용, generated 프로그램과 확장 상태 보고, 행 수별 렌더, 첫 화면, `hy-set` 메인 스레드 부하, 이동 중 메모리 | implemented | `make bench`, [성능 측정](operations/benchmark.ko.md) |
| server-program | 같은 템플릿의 generated PHP 프로그램으로 template package의 API를 통해, 네이티브 템플릿 확장이 있을 때와 없을 때 하는 PHP 렌더(HY-48) | implemented | `make test-php`, `make parity` |
| embedded-data | 문서는 reply가 요청할 때만 데이터를 내장하고, 브라우저는 내장 데이터가 없는 페이지의 데이터를 처음 필요할 때 문서 요청 하나로 얻는다(HY-31, HY-92, HYC-7) | implemented | `make test-php`, `make hyper-test-node`, `make test-js` |
| cdn-deployment | 서버와 CDN 배포(권장)와 정적 셸 배포 | 문서화, 배포 안 함 | [배포](operations/deployment.ko.md) |
| publication | 패키지의 레지스트리 배포 | not started | |
| gate-inputs | Native gate가 읽기 전에 workspace 선언과 runtime fixture를 build한다(HR-85) | implemented | `tests/scripts/check-recipes.test.mts`, `make lint-ts`|
| ci-setup | 모든 CI 검사 group이 검증 전에 선언된 PHP와 checkout hook을 준비한다 | implemented | `tests/scripts/ci-workflow.test.mts` |
| consumer-check-inputs | Script 검사가 build를 소유하고 package 검사가 editor 설정 없이 native source 연결을 위임한다 | implemented | `tests/scripts/check-recipes.test.mts`, `tests/scripts/template-ext.test.mts`, `make package-check` |
| language-parity-ci | 언어 간 protocol 동등 검사는 `ci.yml`의 항목 `gates`에서 실행하고, 선언을 한 번 검증하며 browser를 설치하지 않고, release가 자기 실행에 요구하는 `ci-passed`는 그 항목의 job `check`를 필요로 한다 | configured | `tests/scripts/ci-workflow.test.mts`, `ci.yml`의 항목 `gates` |
| ci-environment-ownership | 각 CI group은 Kit으로 고정 도구를 선택하고 native lock graph를 설치하며 다른 언어 job의 산출물 없이 build 입력을 소유한다. 공통 정책 group은 sibling template source를 선언하지 않는다 | configured; native selector owner checks | `tests/scripts/ci-workflow.test.mts`, `tests/scripts/toolchain.test.mts` |
| shared-runtime-runner | 모든 Python 검사 target은 native Kit runner와 virtual environment 선택을 사용하며, 앱 unittest harness는 남아 있지 않다 | configured | `make hyper-runner-owner-check`, `make hyper-test-python-render` |
| native-browser-runner | 앱 server의 준비와 정리 소유권을 유지하면서 browser E2E 실행에 provider 소유 Playwright adapter를 사용해야 한다 | pending provider support; release held | [Kit issue 13](https://github.com/polyspec/kit/issues/13) |

## host runner의 case section

S-3b 변경은 일부 section의 case를 세 server의 host 코드가 core를 부를 때(C-7)에만 실행하는 형태로 바꿨다. 그때까지 PHP, Node, Python runner는 그 section을 고정 사본 `tests/legacy/<name>-before-s3b.json`, 곧 S-3b case 변경 전의 section에서 읽고, 다른 section은 모두 `contracts/`에서 읽는다(HYR-7). browser runner, build runner, Rust core의 시험은 모든 section을 live로 읽는다. section의 규칙을 core로 옮기는 commit이 그 section을 다시 live로 만들고 사본에서 지운다.

| case 파일 | host runner의 live section | 고정 사본에서 읽는 section |
|---|---|---|
| `accept.json` | — | `parse`, `select` |
| `app.json` | `parts` | `cases`, `opens` |
| `arguments.json` | `counts`, `names` | — |
| `build.json` | `outputs` | `read` |
| `client.json` | `cases`, `declaration` | `openRejections` |
| `container.json` | `services` | — |
| `context.json` | `contexts`, `withContext` | `cases` |
| `cookies.json` | `parse` | — |
| `csrf.json` | `masked` | `mask`, `verify`, `browser` |
| `file-sessions.json` | `requests` | `cookie` |
| `functions.json` | `cases` | — |
| `hooks.json` | `creation` | — |
| `json.json` | — | `encode`, `decode` |
| `keep.json` | `cases`, `select` | — |
| `manifest.json` | `reads` | `checks` |
| `media-type.json` | — | `values` |
| `reads.json` | `cases` | — |
| `reply.json` | `flags` | `cookies`, `cacheControl`, `referrerPolicy`, `status`, `notes` |
| `representations.json` | `manifestRejections`, `openRejections`, `values` | `cases` |
| `request.json` | `texts`, `targets` | `files`, `values` |
| `response.json` | `values` | — |
| `rest.json` | `cases`, `invalidPaths` | — |
| `result.json` | `invalid` | `redirect`, `page`, `copies`, `stop`, `types` |
| `routes.json` | `cases`, `baseCases`, `invalidPaths` | — |
| `session.json` | `token`, `store` | `flash`, `kept` |

## 세 server에 남는 규칙

Rust core(C-7)는 아직 모든 규칙을 갖지 않는다. 가질 때까지 세 server는 아래 규칙을 자기 코드에 두며, core가 가진 규칙도 각 server가 생성된 binding으로 core를 부를 때(S-4)까지 자기 코드에 둔다. 규칙은 그것을 core와 그 case에 더하는 변경에서 이 목록을 떠난다.

| 규칙 | core가 아직 갖지 않는 이유 | 기간 |
|---|---|---|
| template AST에서 read path를 계산하는 일(HY-73.1부터 HY-73.20) | build가 template AST에서 계산하고 Node server는 browser 패키지로 계산하며(HY-73.23), core는 그것으로 읽는 데이터를 보존한다 | template 언어의 compiler가 그것을 줄 때 |
| client 렌더 selection 호출(HY-62.7부터 HY-62.11까지), 식별자로 session의 store 열기(HY-104), body 한도(HY-59.4, HY-131), handler가 반환한 값의 데이터 모델 변환(HY-44) | core는 요청을 라우팅하고, store interface로 session을 읽으며, token을 검사하고, page의 handler를 요청하며, page의 헤더를 준다. host는 selection을 부르고, session의 store를 열며, body를 읽는다 | S-4 |
| 요청의 body(HY-56, HY-57, HY-113, HY-114, HY-131)와 요청의 cookie(HY-129.13) | http-form와 http-cookie 라이브러리가 가지며, 각 server가 binding으로 부른다 | S-4 |
| hook, host 진입점, runtime(HY-43, HY-60, HY-66, HY-67, HY-74, HY-97, HY-99, HY-100, HY-105) | host 코드(L-3)이며 각 runtime에 남는다 | 없음: host 코드로 남는다 |
| ORM 오류를 class로 알아보는 일(HY-107.7)과 handler를 부르는 요청 단계(HY-120, HY-121.5, HY-122.9) | core는 kind별 응답과 단계의 순서를 주고, server가 handler를 실행한다 | S-4 |
