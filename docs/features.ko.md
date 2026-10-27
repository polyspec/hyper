<!-- doc-id: features -->
<!-- source-sha256: 786df86c05b2dede2d19f305d5083c4f2da511d8fdc16c685000aea3d355d810 -->
# 기능 상태

[English](features.md).

| ID | 기능 | 상태 | 근거 |
|---|---|---|---|
| protocol | 영역 프로토콜 명세(HY-1 ~ HR-94) | implemented | [프로토콜](spec/protocol.ko.md) |
| composition | 애플리케이션 작성 규칙(HC-1 ~ HC-7)과 HC-6에 대한 HY-48 템플릿 검사 | documented; template check implemented | [화면 구성](operations/composition.ko.md), `make templates-check` |
| manifest | PHP와 브라우저가 읽는 애플리케이션 매니페스트 | implemented | `make test-php`, `make test-js` |
| router | 적합성 사례를 공유하는 PHP 라우터와 브라우저 라우터 | implemented | `make test-php`, `make test-js` |
| rest-routes | 라우트 경로 끝의 나머지 매개변수 `{name*}`(HY-49) | implemented | `make test-php`, `make test-js` |
| stop-results | loader와 action의 redirect, 금지 결과(HY-50, HY-51) | implemented | `make test-php` |
| page-statuses | loader와 action의 잘못된 요청 멈춤, 200, 409, 422로 페이지를 렌더하는 action 결과(HY-58) | implemented | `make test-php`, `make hyper-test-node` |
| page-forbidden | loader나 action은 reply로 그 요청의 페이지에 상태 403을 준다. 요청이 볼 수 없는 데이터 대신 다른 데이터를 보이는 페이지를 위한 것이다(HY-69) | implemented | `make test-php`, `make hyper-test-node` |
| body-checks | 애플리케이션의 body 한도와 받는 폼 type, 413, 415, CSRF 403 순서의 검사(HY-59) | implemented | `make test-php`, `make hyper-test-node`, `make server-parity` |
| failure-cache | 상태가 400 이상인 모든 응답의 `Cache-Control: no-store`(HY-65) | implemented | `make test-php`, `make hyper-test-node` |
| response-limit | 애플리케이션의 응답 한도. 더 큰 body는 보내지 않고 요청은 텍스트 500을 받는다(HY-66) | implemented | `make test-php`, `make hyper-test-node` |
| disconnect-hook | client가 연결을 닫은 요청의 연결 끊김 hook. Node 서버는 요청을 멈추고, PHP는 첫 실패한 쓰기에서 script를 끝내며, Python 서버는 응답의 첫 실패한 쓰기를 알린다(HY-67) | implemented; Python CI run pending | `make test-php`, `make hyper-test-node`, `make hyper-test-python-render` |
| response-hook | 모든 응답마다 요청, 응답, 경과 시간, note를 가진 요청의 reply, 500의 실패로 한 번 호출하는 응답 hook(HY-60) | implemented | `make test-php`, `make hyper-test-node` |
| escaped-error | 요청의 answer를 벗어난 오류의 평범한 500은 모든 adapter에서 같다. PHP와 Node에서는 호출자가 hyper가 요청을 받기 전에 설정한 header를 유지한다. 받은 그대로의 요청과 오류의 failure와 함께 쓰기 hook에 한 번 보고되며, 어떤 응답 hook에도 보고되지 않는다(HY-60, HY-99, HY-100) | implemented; CI run pending | `make test-python`, `make hyper-test-node`, `make test-php`, `make hyper-test-python-render` |
| write-hook | 모든 서버의 쓰기 hook `written`은 애플리케이션이 답한 요청마다 한 번 호출되며, 요청, 쓰기를 시작한 응답, 쓰기가 끝났는지, 경과 시간과 탈출 오류의 failure를 받는다. Node의 `App.listener`가 반환하는 listener는 그 뒤에 settle된다(HY-99, HY-100) | implemented; CI run pending | `make test-php`, `make hyper-test-node`, `make test-python`, `make hyper-test-python-render` |
| client-shell | 한 서버가 요청마다의 선택(요청의 모든 handler가 그 값을 읽는다)에 따라 클라이언트 렌더 페이지에는 정적 셸과 데이터 기본 경로 아래의 JSON으로, 서버 렌더 페이지에는 그 경로 없이 응답하며, 브라우저는 `html` 요소에 렌더한 layout의 속성을 준다(HY-62, HYC-6) | implemented | `make test-php`, `make hyper-test-node`, `make test-js`, `make e2e` |
| stylesheet-links | 브라우저는 클라이언트 렌더 문서, 영역 응답의 layout, 히스토리 복원 문서의 head에 있는 stylesheet link를 적용한다. 있는 link는 유지하고, 없는 link는 내용을 보이기 전에 불러오며, 그 뒤 나머지를 제거한다(HYC-15) | implemented | `make test-js`, `make e2e` |
| reply | loader와 action의 응답 cookie와 cache control, JSON tag와 304(HY-52, HY-53) | implemented | `make test-php` |
| referrer-policy | page와 JSON 응답의 `Referrer-Policy` header를 정하는 명명된 reply 메서드 `referrerPolicy`, Referrer-Policy 명세의 토큰만 받는다(HY-103) | implemented | `make test-php`, `make hyper-test-node`, `make test-python`, `make hyper-test-python-render` |
| csrf | 모든 응답의 가린 CSRF 토큰, 세션 쿠키 `__Host-hy-session` 또는 `hy-session`, 액션의 세션 갱신, 페이지의 공유 캐시 금지(HY-24, HY-45, HY-52, HY-53, HY-72) | implemented | `make test-php`, `make hyper-test-node`, `make server-parity` |
| read-paths | 템플릿 AST로 계산한 라우트마다의 읽기 경로. PHP를 위해 `reads.json`에 쓰고 Node 서버는 열 때 계산한다. 두 서버는 공유 데이터와 영역 데이터에서 그 경로만 보낸다(HY-44, HY-73) | implemented | `make test-js`, `make test-php`, `make hyper-test-node`, `make server-parity` |
| php-errors | PHP 요청의 경고, 알림, 폐기 예정 알림은 틀린 페이지 대신 상세 없는 500으로 요청을 실패시킨다(HY-74) | implemented | `make test-php` |
| absent-route-regions | 로더가 null을 돌려주는 라우트 영역은 응답에 없다. 라우트 템플릿이 포함하거나 배치하는 템플릿도 라우트 영역을 배치할 수 있다. 브라우저는 모든 라우트 영역의 요소를 확인한다(HY-30, HY-75) | implemented | `make test-js`, `make test-php`, `make hyper-test-node`, `make templates-check`, `make server-parity` |
| php-analysis | 레벨 `max`의 PHPStan이 기준선이나 무시하는 오류 없이 PHP 서버 패키지의 소스와 테스트를 검사한다 | implemented | `make analyse-php` |
| hyper-client | 브라우저 코드: 영역과 문서 렌더, htmx 확장, 클라이언트 렌더 | implemented | `make test-js`, `make e2e` |
| hyper-server-php | PHP 서버: 라우트, 액션, CSRF, flash, 바뀐 주제, 기본 경로, 문서와 JSON | implemented | `make test-php` |
| hyper-server-node | server protocol의 Node.js 구현 `@polyspec/hyper-server`, 파일 session(HY-104), PHP 구현과 같은 바이트의 JSON, board 예제 서버(HY-54) | implemented | `make hyper-test-node`, `make node-server` |
| python-request-hook | Python 서버 `create_server`의 요청 hook `around`. 요청과 `answer`를 받고, `Request.with_header`로 요청을 바꾸거나 응답을 바꾸며, session과 애플리케이션의 hook 없이 혼자 응답할 수 있다 (HY-97) | implemented; CI run pending | `make test-python`, `make hyper-test-python-render` |
| hyper-server-python | server protocol의 Python 구현 `polyspec-hyper-server`. template Python package로 렌더하고 file session(HY-104)과 `http.server` 서버, WSGI application callable(H19.1), ASGI application callable(H19.2), board 예제 서버를 둔다 (H15.3) | implemented; CI run pending | `make test-python`, `make hyper-test-python-render`, `make server-parity-python` |
| route-regions | 자기 로더를 가진 페이지 안의 라우트 영역(HY-30) | implemented | `make test-php`, `make parity` |
| region-data | 라우트 영역의 내장 데이터, 요청 없이 라우트 영역에서 동작하는 `data`, `render`, `set`, `hy-set`, 데이터 공개 규칙(HYC-10 ~ HYC-11, HYC-5, HY-71) | implemented | `make test-js`, `make e2e` |
| kept-data | 서버 세션, 쿠키, localStorage, sessionStorage의 유지 경로(HY-37 ~ HY-41) | implemented | `make test-php`, `make test-js`, `make parity`, `make e2e` |
| template-delivery | 템플릿마다 파일 하나, 렌더가 닿는 템플릿만 불러오기(HR-34, HYC-12) | implemented | `make test-js`, `make e2e`, `make bundle-size` |
| tailwind-build | `--tailwind <source>=<output>`은 application stylesheet를 Tailwind theme과 template이 쓰는 utility로 compile한다(HR-77) | implemented | `make hyper-test-scripts` |
| asset-delivery | 페이지는 자기가 쓰는 자원만 요청한다. `import()`로 불러오는 클라이언트 조각, 진입 파일 URL만 담은 매니페스트, 스타일시트 없는 정적 셸(HYC-16) | implemented | `make hyper-test-scripts`, `make e2e` |
| parity | 브라우저의 문서와 영역이 PHP 문서와 바이트 단위로 같음 | implemented | `make parity` |
| server-parity | 모든 parity 단계에서 Node 서버 응답이 상태, header, body까지 PHP 응답과 같음(HR-55) | implemented | `make server-parity` |
| ssr | JSON 이동과 JavaScript 없는 동작을 갖춘 서버 렌더 | implemented | `make e2e` |
| csr | 정적 `index.html` 하나와 `/api` JSON을 쓰는 클라이언트 렌더 | implemented | `make e2e` |
| comparison | SSR과 CSR 프레임을 담은 비교 페이지 | implemented | `make e2e` |
| bundle-size | SSR 스크립트, CSR 셸, 템플릿 파일 크기를 상한과 비교해 측정하며, 상한을 넘는 크기는 실패가 아니라 warning이다 | implemented | `make bundle-size`, `tests/scripts/check-bundle-size.test.mts` |
| npm-packages | `@polyspec/hyper-client`와 `@polyspec/hyper-server`는 Node가 `node_modules`에서 실행하는 JavaScript와 type 선언을 배포하며, 소스는 `erasableSyntaxOnly`를 통과한다(HR-61) | implemented | `make package-check` |
| build-package | `@polyspec/hyper-build`는 bin `hyper-build-server`와 `hyper-build-assets`를 배포하고, 그 모듈은 배포하는 파일, Node, manifest가 요구하는 패키지만 import한다. consumer는 릴리스 tarball에서 이것을 설치하고 두 bin을 실행한다(HR-96) | implemented; CI run pending | `tests/scripts/package-source.test.mts`, `make release-consumer` |
| server-build-inputs | board 서버 빌드는 설치된 소스 의존성을 사용하며 Composer 설치는 명시적인 작업으로 유지한다(HR-79) | unit verified; CI run pending | `tests/scripts/check-recipes.test.mts`, `make server` |
| output-files | asset build와 server build는 복사한 출력 파일에 어떤 umask에서도 mode 0644를, 디렉터리에 0755를 주어 다른 사용자가 읽을 수 있게 하며, Linux container의 virtiofs bind mount는 이를 받아들인다(HR-68) | unit and Darwin verified; CI run pending | `make hyper-test-scripts`, Darwin에서 `make virtiofs-check` |
| template-dir | asset build, template build, server build는 npm이 template release의 tarball에서 설치하는 template package `@polyspec/template`과 `@polyspec/template-compiler`를 package 이름으로 읽고, Composer는 `polyspec/template`을 template release의 zip에서 설치하며, 공개 manifest는 정확한 template version을 요구한다(HR-70) | implemented; CI run pending | `make hyper-test-scripts` |
| template-ext | 네이티브 template 확장은 `config/release-assets.json`이 sha256으로 pin한 tag `TEMPLATE_TAG`(`v0.0.12`)의 php-ext release archive에서 build한다. `make hyper-install`이 kit의 `make release-assets-fetch`로 가져와 확인하고, `make ext`가 offline으로 build하며, PHPStan은 그 stub을 읽는다. 어떤 recipe도 확장을 위해 template 저장소를 읽거나 복사하지 않는다(H14.1-7) | implemented; CI run pending | `tests/scripts/release-assets.test.mts`, `tests/scripts/template-pins.test.mts`, `make ext`, `make test-php` |
| ci-suite | 전체 suite는 `main`의 push와 모든 수동 실행에 대해 GitHub에서 CI group마다 job 하나로 모든 target을 끝까지 실행하고, job summary와 각 target의 상태, 시간, 첫 실패 줄, 전체 log를 담은 보고서를 upload한다(HR-91) | implemented; CI run pending | `tests/scripts/ci-workflow.test.mts` |
| ci-steps | 모든 GitHub workflow는 commit으로 pin한 action으로 시간 제한 없이 `ubuntu-26.04-arm`에서 실행하고, 모든 step은 make target 하나를 실행한다(HR-90) | implemented; CI run pending | `tests/scripts/ci-workflow.test.mts` |
| publish-main | 버전 0.1 전까지 변경은 pull request, merge queue, ruleset 없이 checklist의 모든 작업이 끝났을 때 `main`에 한 번 push한다. pre-push hook은 작업이 진행 중이면 push를 거부하고, `main`의 push는 CI workflow를 실행하며, 그 마지막 job `ci-passed`는 workflow의 다른 모든 job이 통과했을 때만 통과한다(HR-94) | implemented; CI run pending | `tests/scripts/ci-workflow.test.mts` |
| no-live-inputs | 어떤 recipe도 registry에 질의하지 않고, 모든 recipe는 npm, Composer를 offline으로 실행하며 설치 target만 download하고, 없는 download는 그것을 만드는 설치 target을 밝히며, `tests/package-install`은 lock에서 offline 설치하며, test는 event로 순서를 정하고, test 서버는 system이 정한 port에서 listen하며, 서버 시작은 진행을 출력하고, 빈 목록은 검사를 실패시킨다(HR-89) | implemented | `tests/scripts/toolchain.test.mts`, `tests/scripts/board-servers.test.mts`, `tests/scripts/check-bundle-size.test.mts`, `packages/server/ts/tests/http.test.ts` |
| owner-check | 추적하는 모든 경로는 `config/owner-checks.json`에 owner를 가지고, `make owner-validate`가 이를 검사하며, `make owner-check`는 바뀐 경로의 owner를 실행한다(HR-88) | implemented; CI run pending | `tests/scripts/ignored-files.test.mts` |
| run-resources | run의 서버와 임시 디렉터리는 run이 끝날 때, 실패할 때, SIGINT와 SIGTERM에서 멈추고 지워지며, test는 process가 끝난 뒤에만 디렉터리를 지운다(HR-87) | implemented | `tests/scripts/board-servers.test.mts`, `tests/scripts/check-parity.test.mts`, `tests/scripts/serve-demo.test.mts` |
| all-checks | 여러 검사를 가진 recipe는 각 검사를 끝까지 실행하고 실패한 모든 검사를 밝힌다(HR-86) | implemented | `tests/scripts/check-recipes.test.mts` |
| own-inputs | test는 fixture의 추적 파일을 복사하고, 설치한 template package를 읽으며, 다른 target의 각 입력을 그것을 쓰는 target과 함께 밝힌다(HR-85) | implemented; CI run pending | `tests/scripts/build-assets.test.mts`, `tests/scripts/template-dir.test.mts` |
| checked-results | 실행된 test가 없는 test run, top level에서 await하는 node test 파일, 검사한 step이 없는 parity 검사는 실패하고, 기본 최종 보고서는 실패 근거와 각 target log를 보존한다(HR-84) | implemented; CI run pending | `tests/scripts/check-parity.test.mts` |
| tool-output | 검사는 run 맥락이나 pin하지 않은 release에 따라 바뀌지 않는 형태로 tool 출력을 읽는다. 호출한 make의 변수 없는 make dry run, machine이 읽는 형태, pin한 도구의 text만 읽는다(HR-83) | implemented; CI run pending | `tests/scripts/template-copy.test.mjs` |
| atomic-outputs | 다른 process가 읽는 출력은 rename으로 파일 단위 publish하고, 파일 하나는 rename 한 번으로 쓰며, 설치한 사본은 의존성 tree가 같을 때만 publish하고, package manager 설치와 full run은 lock을 잡는다(HR-82) | implemented; CI run pending | `tests/scripts/publish.test.mts`, `tests/scripts/toolchain.test.mts` |
| toolchain-pin | Node.js, npm, Composer는 정확한 release로, PHP와 Python은 minor release로 추적 파일에 pin한다. npm과 Composer는 digest로 확인해 checkout의 `var/tools`에 설치하고 `PATH`의 맨 앞에 둔다. `make toolchain-check`는 pin과 다른 모든 도구를 밝히고 CI 보고서는 실행 중인 release를 기록한다(HR-81) | implemented; CI run pending | `tests/scripts/toolchain.test.mts`, `tests/scripts/template-copy.test.mjs` |
| composer-development | 명시적 기본 개발 manifest와 별도 lock으로 소스 package version, link, 설치 기록과 PHP 8.4 요구를 일치시킨다(HR-70, HR-79) | unit verified; CI run pending | `make composer-development-check`, `tests/scripts/composer-development.test.mts` |
| kit-tools | 선택적인 기본 로컬 소스 link를 지원하는 설치된 공유 도구 release 0.0.60의 push gate, 최종 검증 실행기, Git hook, holder lock, 문서와 commit 검사, owner 검사, test runner, CI 보고서, toolchain 설치와 검사, release는 release asset의 URL과 integrity로 pin한 npm 패키지 `@polyspec/kit`이며 `config/*.json`이 이를 설정한다. `package-lock.json`과 다른 패키지, 패키지와 다른 `kit.copies`의 복사본, schema를 어기는 설정은 실패한다 | implemented; CI run pending | `make kit-check` |
| template-tag | 릴리즈 선언은 `TEMPLATE_TAG`(`v0.0.12`)를 고정하며 없는 tag는 기대값과 실제값을 밝히고 `make template-tag`를 실패시킨다(HR-80) | implemented; CI run pending | `tests/scripts/template-pins.test.mts`, `tests/scripts/template-version.test.mts` |
| query-values | 중첩 없이 순서대로 읽는 모든 쿼리 값과 원본 쿼리(HY-56) | implemented | `make test-php`, `make hyper-test-node` |
| file-parts | 공개 업로드 metadata와 파일 제한은 기본 API 선언을 가지며 PHP 요청 map은 내부 저장형 없이 순서가 있는 iterable 항목을 노출한다(HY-106, HY-113, HY-114) | unit verified; CI run pending | `tests/scripts/public-symbols.test.mts`, `make parity-check UNITS=file-parts`, `packages/server/php/tests/FilePartsTest.php` |
| form-values | urlencoded body나 multipart body에서 중첩 없이 순서대로 읽는 모든 폼 값(HY-57) | implemented | `make test-php`, `make hyper-test-node` |
| request-boundary | UTF-8 검사, 상세 없는 500 오류, 데이터 모델 검사, 강화한 세션 쿠키, 리다이렉트 검사, 실패 표시(HY-42 ~ HYC-14) | implemented | `make test-php`, `make test-js`, `make e2e` |
| benchmark | 서버와 브라우저 성능 측정: 요청 비용, generated 프로그램과 확장 상태 보고, 행 수별 렌더, 첫 화면, `hy-set` 메인 스레드 부하, 이동 중 메모리 | implemented | `make bench`, [성능 측정](operations/benchmark.ko.md) |
| server-program | 같은 템플릿의 generated PHP 프로그램으로 template package의 API를 통해, 네이티브 템플릿 확장이 있을 때와 없을 때 하는 PHP 렌더(HY-48) | implemented | `make test-php`, `make parity` |
| embedded-data | 문서는 reply가 요청할 때만 데이터를 내장하고, 브라우저는 내장 데이터가 없는 페이지의 데이터를 처음 필요할 때 문서 요청 하나로 얻는다(HY-31, HY-92, HYC-7) | implemented; CI run pending | `make test-php`, `make hyper-test-node`, `make test-js` |
| cdn-deployment | 서버와 CDN 배포(권장)와 정적 셸 배포 | 문서화, 배포 안 함 | [배포](operations/deployment.ko.md) |
| publication | 패키지의 레지스트리 배포 | not started | |
