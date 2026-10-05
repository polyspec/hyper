# 실행 체크리스트

## [웨이브 1](waves.ko.md#wave-1) — 애플리케이션이 약하게 만들 수 없는 CSRF 방어

| ID | 작업 | 검증 | 상태 |
|---|---|---|---|
| H1.1 | 가린 토큰(HY-24, HY-10, HY-71), 세션 쿠키 이름(HY-45), 세션 갱신(HY-72), 비공개 페이지 캐시(HY-52)를 명세하고 `conformance/csrf.json`을 추가한다 | `make docs-check` | [o] |
| H1.2 | PHP 서버: 모든 응답에서 토큰을 가리고 가린 값만 받는다(HY-24). 세션 쿠키 이름을 `__Host-hy-session` 또는 `hy-session`으로 정한다(HY-45). 액션에서 세션을 갱신하고 로더의 갱신은 실패시킨다(HY-72). 공유 캐시가 저장할 수 있는 `Cache-Control`을 거부한다(HY-52) | `make test-php` | [o] |
| H1.3 | Node 서버: H1.2와 같은 규칙, 그리고 쿠키 이름 옵션이 없는 `FileSessions` | `make test-node` | [o] |
| H1.4 | H1.1~H1.3에 대한 예제, 브라우저 테스트, 결과 일치 검사, 기능 상태, 배포 절차, 변경 기록 | `make check` | [o] |

## [웨이브 2](waves.ko.md#wave-2) — 템플릿이 읽는 데이터만 보내기

| ID | 작업 | 검증 | 상태 |
|---|---|---|---|
| H2.1 | 라우트의 읽기 경로를 명세한다. 레이아웃, 제목, 영역 템플릿이 포함 템플릿과 블록을 거쳐 읽는 경로, 라우트 영역의 유지 경로, 라우트 영역이 서버에 값을 남길 때의 `csrf`다. 서버는 공유 데이터와 영역 데이터에서 그 경로만 보낸다 | `make docs-check` | [o] |
| H2.2 | 브라우저 패키지: 템플릿 AST에서 라우트마다 읽기 경로를 계산한다. 변수, 멤버, 인덱스, 반복, 대입, 포함, 블록, 함수 인자, 연산자 사례를 둔다 | `make test-js` | [o] |
| H2.3 | 서버 빌드: PHP 서버를 위해 읽기 경로를 쓴다. PHP 서버: 렌더와 인코딩 전에 그 밖의 경로를 모두 뺀다 | `make test-php` | [o] |
| H2.4 | Node 서버: 브라우저 패키지의 읽기 경로로 H2.3과 같이 뺀다. 공통 사례는 `conformance/reads.json`에 둔다 | `make test-node` | [o] |
| H2.5 | H2.1~H2.4에 대한 예제, 결과 일치 검사, 브라우저 테스트, 번들 크기, 기능 상태, README, 변경 기록 | `make check` | [o] |
| H2.6 | 반복 변수의 읽기 경로를 그 반복의 본문 안에서만 계산해, 앞의 대입이 읽은 이름을 다시 묶는 반복 변수에서도 분석이 끝나게 한다. `conformance/reads.json`의 사례 두 개와 모든 사례의 시간 제한 | `make test-js` | [o] |

## [웨이브 3](waves.ko.md#wave-3) — 결함이 있으면 계속하지 않고 실패하기

| ID | 작업 | 검증 | 상태 |
|---|---|---|---|
| H3.1 | 요청 중 정의되지 않은 변수나 배열 키 같은 PHP 경고나 알림이 나면, 그 요청을 HY-43처럼 실패시킨다고 명세한다 | `make docs-check` | [o] |
| H3.2 | PHP 서버: 요청의 모든 경고와 알림을 예외로 바꾸고, 종류마다 실패하는 테스트를 둔다 | `make test-php` | [o] |
| H3.3 | PHP 패키지의 정적 분석을 가장 높은 수준으로 `make check`에서 실행하고, 찾은 문제를 모두 고친다 | `make check` | [o] |

## [웨이브 4](waves.ko.md#wave-4) — 조합한 페이지의 라우트 영역

| ID | 작업 | 검증 | 상태 |
|---|---|---|---|
| H4.1 | 없는 라우트 영역과 그 배치를 명세한다. 로더가 null을 돌려주는 라우트 영역은 그 응답에 없다(데이터, 유지 값, 정의가 없으므로 `{?# name}`은 거짓이다). 라우트 템플릿이 포함하거나 경로로 배치하는 템플릿도 라우트 영역을 배치할 수 있다. 있는 라우트 영역은 페이지에 요소가 정확히 하나이고, 브라우저가 이를 확인한다. 템플릿 검사는 포함과 블록을 따라간다 | `make docs-check` | [o] |
| H4.2 | PHP 서버: 문서와 JSON의 없는 라우트 영역 | `make test-php` | [o] |
| H4.3 | 브라우저 패키지와 Node 서버: 렌더, 보관 데이터, 내장 데이터의 없는 라우트 영역과 요소 확인 | `make test-js`, `make test-node` | [o] |
| H4.4 | 템플릿 검사, 예제(공지가 없으면 공지 라우트 영역이 없다), 브라우저 테스트, 결과 일치 검사, 기능 상태, 변경 기록 | `make check` | [o] |

## [웨이브 5](waves.ko.md#wave-5) — 렌더가 닿는 템플릿만 받기

| ID | 작업 | 검증 | 상태 |
|---|---|---|---|
| H5.1 | 렌더가 템플릿에 닿을 때 브라우저가 그 템플릿을 받는다고 명세한다. 렌더하고, 렌더가 요청했지만 로더에 없던 템플릿을 모두 받고, 다시 렌더한다. 어떤 렌더도 닿지 않는 템플릿은 받지 않는다 | `make docs-check` | [o] |
| H5.2 | 브라우저 패키지: 영역 응답, 브라우저 렌더, 내장 데이터, `render`, `set`에서 필요할 때 받는 렌더. 선택되지 않은 분기는 템플릿을 받지 않는다는 테스트 | `make test-js` | [o] |
| H5.3 | 예제, 브라우저 테스트, 번들 크기, 기능 상태, 변경 기록 | `make check` | [o] |

## [웨이브 6](waves.ko.md#wave-6) — 페이지가 쓰는 자원만 요청하기

| ID | 작업 | 검증 | 상태 |
|---|---|---|---|
| H6.1 | HY-76을 명세한다. 페이지는 자기가 쓰는 자원만, 각각 많아야 한 번 요청한다. 에셋 빌드는 클라이언트 진입 파일과, 진입 파일이 `import()`로 불러오는 코드마다 조각 파일 하나, 진입 파일 URL만 담은 `manifest.json`, 스타일시트 없는 정적 셸을 쓴다 | `make docs-check` | [o] |
| H6.2 | 에셋 빌드: 조각 파일, 매니페스트, 셸, 주석. 변경 전에 실패하는 빌드 테스트 | `make test-scripts` | [o] |
| H6.3 | 게시판 예제: 레이아웃이 자기 스타일시트를 링크한다. 문서, 번들 크기, 기능 상태, 변경 기록 | `make check` | [o] |

## [웨이브 7](waves.ko.md#wave-7) — 네 가지 작업 상태

| ID | 작업 | 검증 | 상태 |
|---|---|---|---|
| H7.1 | `scripts/check-documents.mjs`가 네 가지 작업 상태만, 두 언어에서 같게 받고, 일시 우회 작업은 원인과 재시도 조건을 담게 한다. x로 표시한 행에서 실패하는지 확인한다. 모든 완료 작업을 완료 표시로 쓴다. AGENTS에 checklist 규칙을 적는다 | `make docs-check` | [o] |
| H7.2 | AGENTS에 72자에서 줄을 바꾼 본문을 가진 commit message 형식 `type(scope): Subject (#task)`, `main`에서 직접 작업할 수 있음, branch와 worktree의 이름과 merge 뒤의 제거, merge할 수 없는 test code의 제거, 받은 지시를 agent memory와 함께 분류하는 규칙을 적는다 | `make docs-check` | [o] |
| H7.1-1 | 이 checklist에서 작업 상태 표시는 작업 행 마지막 칸 첫머리의 상태로만 쓴다. 사용법의 범례와 웨이브 7, H7.1, H11.1, H11.1-1의 문장이 inline code로 표시를 적었고 `scripts/check-documents.mjs`는 작업 행의 마지막 칸만 읽었으므로, 표시를 세는 도구가 존재하지 않는 진행 중 작업을 셌다. AGENTS가 상태를 정의한다. 범례를 없애고 문장은 상태를 말로 적으며, `make docs-check`가 다른 모든 표시에 대해 file, 줄, 열을 적고 예외 없이 실패하게 한다. 변경 전에 실패하는 `tests/scripts/check-documents.test.mjs`의 case를 둔다. Red: test의 fixture는 범례, 작업의 inline code, 일시 우회 작업의 원인, 작업이 아닌 행의 마지막 칸에 표시를 담는다. 이전 검사는 이 fixture에 `2 documents, 0 problem(s)`를 출력했다. Green: 2개 case가 통과하고 fixture는 언어마다 위치 5개로 실패한다. 검사를 넣고 문장이 이전 것일 때 `make docs-check`는 언어마다 10, 81, 85, 128, 131번 줄의 문제 28개로 실패했고, 변경 후에는 통과한다 | `make docs-check`, `node scripts/run-tests.mjs node -- tests/scripts/check-documents.test.mjs` | [o] |
| H7.1-1-1 | GitHub의 task list 상태도 상태 표시로 다룬다. H7.1-1은 이 저장소의 네 상태만 검사하지만 Markdown reader는 대괄호 안의 x나 대문자 X도 task list 항목의 상태로 읽으므로, 작업 상태 밖의 그런 표시가 `make docs-check`를 통과했다. 검사가 그 표시에 대해 file, 줄, 열을 적고 실패하게 하며, 변경 전에 실패하는 case를 `tests/scripts/check-documents.test.mjs`에 둔다. Red: inline code로 대문자 X를 적은 작업과 x 형식의 목록 항목을 fixture에 더하자 검사가 두 표시를 보고하지 않아 case가 실패했다. Green: 2개 case가 통과하고 fixture는 언어마다 위치 7개로 실패하며, `make docs-check`가 통과한다 | `make docs-check`, `node scripts/run-tests.mjs node -- tests/scripts/check-documents.test.mjs` | [o] |
| H7.1-1-2 | checklist에는 제목과 작업 table만 둔다. checklist에는 번역 link, 내용을 설명하는 문단, 사용법 규칙, 웨이브마다 배경과 의존을 적은 문단이 있었고 그런 문장을 작업과 구별하는 검사가 없었다. 규칙은 AGENTS로, 웨이브의 배경과 의존은 각 웨이브 제목이 link하는 `docs/plans/waves.md`로 옮긴다. `make docs-check`가 빈 줄, 제목, 작업 행, table 머리 행과 그 구분 행이 아닌 모든 줄에 대해 file, 줄, 열을 적고 실패하게 하며, 변경 전에 실패하는 case를 `tests/scripts/check-documents.test.mjs`에 둔다. Red: 번역 link, 문단, 사용법 아래의 목록 항목, 의존 줄, 작업이 아닌 행, 구분 행 없는 table을 담은 fixture에 검사가 문제를 출력하지 않았다. Green: 3개 case가 통과하고 fixture는 언어마다 위치 6개로 실패한다. 검사를 넣고 checklist가 이전 것일 때 `make docs-check`는 언어마다 17줄로 실패했고, 옮긴 뒤에는 통과한다 | `make docs-check`, `node scripts/run-tests.mjs node -- tests/scripts/check-documents.test.mjs` | [o] |

## [웨이브 8](waves.ko.md#wave-8) — asset build의 Tailwind CSS

| ID | 작업 | 검증 | 상태 |
|---|---|---|---|
| H8.1 | HY-77을 명세한다. `--tailwind <source>=<output>`은 application의 source stylesheet를 최신 stable Tailwind CSS의 theme과 utility로 compile하여, template과 client code가 쓰는 utility를 생성하고 source의 rule을 cascade layer `components`에 쓴다 | `make docs-check` | [o] |
| H8.2 | asset build: 이 option과 변경 전에 실패하는 build test, dependency로서의 Tailwind CSS, 문서와 changelog | `make check` | [o] |
| H8.2-1 | 정적 배포물이 stylesheet를 복사하기 전에 Tailwind stylesheet를 compile한다. build가 복사 뒤에 output을 썼으므로, `dist/csr/assets/`에는 첫 build의 output이 없었고 다음 build에서는 이전 build의 output이 있었다| `make check` | [o] |

## [웨이브 9](waves.ko.md#wave-9) — client rendering selection의 값이 handler에 전달된다

| ID | 작업 | 검증 | 상태 |
|---|---|---|---|
| H9.1 | HY-62에 명세한다. selection은 request가 client-rendered page의 것인지와 값을 담은 choice를 반환한다. request의 모든 loader와 action은 그 값을 request에서 읽고, 선언이 없는 application의 request는 값 null을 가진다 | `make docs-check` | [o] |
| H9.2 | PHP와 Node server: `Choice`, `Request::selection()`, `request.selection()`과 변경 전에 실패하는 test, 문서, feature status, changelog | `make check` | [o] |

## [웨이브 10](waves.ko.md#wave-10) — data model 검사 한 번과 추가만 하는 build 출력

| ID | 작업 | 검증 | 상태 |
|---|---|---|---|
| H10.1 | HY-44: loader와 shared handler 값의 host binding에 native object(VAL-19)가 있으면 HY-43으로 실패하고, binding이 data model 값으로 바꾸는 값(PHP `stdClass`, `JsonSerializable`)은 통과한다. 변경 전 PHP에서 실패하는 case를 둔다 | `make check` | [o] |
| H10.2 | `check-templates.mjs`의 검사를 manifest와 template directory를 받는 함수 하나로 옮기고, `make templates-check`와 `build-server.mjs`가 아무것도 쓰기 전에 그 함수를 쓴다. HY-48에 위반이 있으면 아무것도 쓰지 않는다고 적는다. 변경 전에 실패하는 case를 둔다 | `make check` | [o] |
| H10.2-1 | template 규칙이 조건 분기 안의 배치와 include를 보게 한다. 순회는 type이 없는 객체 안의 node 목록을 건너뛰었으므로, `{? }` 분기를 거쳐 배치한 route region을 0번으로 셌다. server build가 쓰도록 규칙을 `scripts/template-rules.mjs`의 `templateProblems`로 옮긴다. 분기 안에 배치한 region과 분기 안의 include로 배치한 region을 가진 fixture route를 둔다 | `make check` | [o] |
| H10.3 | asset build는 이름에 content hash가 있는 파일을 더하기만 하고, hash 없는 출력(`manifest.json`, `templates.index.json`)은 `--output` directory에 쓴다(HY-34, HY-76). 변경 전에 실패하는 build test를 둔다 | `make check` | [o] |
| H10.3-1 | `tests/package-install`가 H10.3이 더한 `@polyspec/hyper`의 export `./templates-index`를 기대하게 한다. package install test는 export `.`만 요구했으므로 main에서 `make package-check`가 실패했다 | `make package-check` | [o] |
| H10.4 | template T14.2의 bound 값으로 pruning한 root를 document마다 한 번 binding하고 모든 render에 쓴다. 그래서 값은 render 횟수와 상관없이 최대 두 번 검사된다. JSON 응답은 `params`만 다시 binding한다 | `make check` | [o] |
| H10.5 | 브라우저 package와 Node package가 template package의 host binding을 이름 `bindValue`로 부른다. template T14.2가 TypeScript host binding `bind`를 `bindValue`로 바꾸고 `bind`를 bound map에 주었으므로, template main에서 `packages/hyper-js`의 `tsc`가 `BoundMap is not assignable to Value`로 실패했고 | `make check` | [o] |
| H10.6 | SSR script와 CSR shell의 gzip 한도를 개발 문서의 규칙(측정 크기에 약 1%를 더하고 100바이트 단위로 올림)으로 다시 측정한다: gzip 33,080과 33,224 바이트에 대해 33,500과 33,600. 2026-10-04 이후 SSR script는 gzip 441바이트, CSR shell은 442바이트 커졌다. bundle이 render가 호출하는 코드를 담게 되었기 때문이다: template T14.2의 bound map runtime(`bind`, `merge`, `BoundMap`, `bindValue`, `bindMap`, `bindData`의 bound map 처리) minify 후 982바이트, `response.ts`에 있는 H10.4의 root binding(`bindParts`, `renderRegionOf`) 341바이트, H10.5의 이름 변경 13바이트. SSR 한도 32,700은 규칙을 따르지 않았다. 32,639바이트에 대한 규칙 값은 33,000이었고, 이 변경이 이를 바로잡는다 | `make bundle-size` | [o] |

## [웨이브 11](waves.ko.md#wave-11) — 진행을 출력하고 한도가 있는 test 실행

| ID | 작업 | 검증 | 상태 |
|---|---|---|---|
| H11.1 | AGENTS의 필수 검사: 커밋 전에는 변경을 소유한 Red test와 Green test, 그리고 `make docs-check`; 작업은 Verification column에 적은 그 작업의 소유 명령으로 완료가 된다; `make check`는 활성 작업이 모두 끝났을 때 한 번 실행한다 | `make docs-check` | [o] |
| H11.2 | vitest, `node --test`, PHPUnit을 `scripts/run-tests.mjs`와 그 진행 reporter로 실행한다: 모든 test는 시작, 결과, 경과 시간을 출력하고 자기 timeout에서 이름으로 실패한다; `make test-js`, `test-node`, `test-php`, `test-scripts`, `package-check`가 이를 쓴다; runner는 자기 test를 가진다 | `node scripts/run-tests.mjs node -- tests/scripts/run-tests.test.mjs` | [o] |
| H11.3 | `scripts/check-parity.mjs`는 모든 요청에 `AbortSignal.timeout`으로 timeout을 주고, step이 시작할 때 줄을 출력하고 결과와 함께 경과 밀리초를 출력하며, server가 응답하지 않으면 step 이름으로 실패한다; 응답하지 않는 server에 대한 test | `node scripts/run-tests.mjs node -- tests/scripts/check-parity.test.mjs` | [o] |
| H11.1-1 | 한 번의 전체 실행을 guard `scripts/full-run.mjs`로 강제한다. `make check`는 어떤 단계보다 먼저 이 guard를 시작한다. guard는 이 checklist의 작업 행이 진행 중이면 거부하고 활성 ID를 작업과 함께 나열하며, 추적 파일의 변경이 커밋되지 않았으면 거부하고, 같은 tree(`git rev-parse HEAD^{tree}`)의 두 번째 전체 실행을 앞선 실행을 밝히며 거부한다. `CHECK_TARGETS`의 각 target을 `make <target>`으로 끝까지 실행하고, 각 target의 앞뒤에 `var/full-run.json`(tree, commit, 결과, 각 target의 상태와 시각)을 쓰므로 멈춘 실행은 `incomplete`로 남는다. `make rerun-failed`는 현재 tree에서 통과하지 못한 target만 다시 실행하고, 그것이 통과하면 결과를 완성한다. 원인: AGENTS는 `make check`를 활성 작업이 모두 끝났을 때 정확히 한 번 실행한다고 적지만 이를 강제하는 것이 없었다. 진행 중인 작업이 있는 실행, 커밋되지 않은 변경의 실행, 같은 tree의 두 번째 실행이 모두 suite를 시작했다. Red: `make -n check`는 `template-check`의 첫 단계를 출력했으므로 suite는 checklist의 내용과 상관없이 시작했고, `make -n rerun-failed`는 `No rule to make target`으로 실패했으며, `tests/scripts/full-run.test.mjs`는 `scripts/full-run.mjs`에 대한 `ERR_MODULE_NOT_FOUND`로 실패했다. Green: 그 10개 case가 통과한다. `make -n check`는 guard만 출력하고, 진행 중 작업이 있는 fixture checklist, 더러운 tree, 한 tree의 두 번째 실행, record 없는 `rerun-failed`는 stub target이 실행되기 전에 거부되며, `rerun-failed`는 실패했거나 끝나지 않은 stub target만 실행한다 | `node scripts/run-tests.mjs node -- tests/scripts/full-run.test.mjs` | [o] |

## [Wave 12](waves.ko.md#wave-12) — 한 실행의 test resource

| ID | 작업 | 검증 | 상태 |
|---|---|---|---|
| H12.1 | HY-78: template 저장소를 `scripts/copy-template.mjs`가 쓰는 선언한 복사본 `var/products/template`으로만 읽는다(build된 TypeScript package의 `npm pack`, PHP package, 네이티브 확장, Rust crate, compiler의 추적 파일). npm은 사본을 설치하고, Composer, PHPStan, `make ext`는 복사본을 읽으며, `make template`은 template 저장소에서 아무것도 build하지 않는다 | `node scripts/run-tests.mjs node -- tests/scripts/template-copy.test.mjs` | [o] |
| H12.2 | `scripts/check-parity.mjs`는 `scripts/board-servers.mjs`로 PHP 서버와 board Node 서버를 system이 배정하는 port에 띄우고, 각 서버가 출력에 알리는 주소로 요청을 보내며, 그 출력에 서버의 prefix를 붙여 출력하고, database와 session 디렉터리를 실행의 임시 디렉터리에 둔다. option `--port`, `--node-port`와 polling하는 `waitForServer`는 없앤다 | `node scripts/run-tests.mjs node -- tests/scripts/check-parity.test.mjs` | [o] |
| H12.3 | `make e2e`는 `scripts/run-e2e.mjs`를 실행한다. 이 script는 `scripts/board-servers.mjs`로 board 예제를 system이 배정하는 port와 실행의 임시 디렉터리에 있는 빈 database로 띄우고, 주소를 `HYPER_E2E_SSR`과 `HYPER_E2E_CSR`에 담아 Playwright를 실행한다. `playwright.config.ts`에는 `webServer`와 port가 없고, `examples/board/var/e2e.db`는 쓰지 않는다 | `node scripts/run-tests.mjs node -- tests/scripts/run-e2e.test.mjs` | [o] |
| H12.4 | `make serve-demo`는 고정 port 8080 ~ 8082를 유지하고, demo의 checkout, process ID, 시작 시각을 적은 `scripts/holder-lock.mjs`의 lock `/tmp/hyper-serve-demo.lock`을 잡는다. 두 번째 demo는 그 holder를 밝히며 실패하고, demo는 멈출 때 lock을 풀며, 끝난 demo의 lock은 보고되고 `make serve-demo-unlock`으로 지운다. `make bench-browser`는 `scripts/board-servers.mjs`로 서버를 system이 배정하는 port에 띄우고 데이터베이스를 실행의 임시 디렉터리에 둔다 | `node scripts/run-tests.mjs node -- tests/scripts/serve-demo.test.mjs` | [o] |
| H12.5 | `make analyse-php`의 PHPStan을 `--memory-limit=256M`으로 실행한다. 새 worktree처럼 result cache `build/phpstan`이 없으면 worker가 132 MB를 써서 기본 PHP 한도 128M에서 crash했고, `make check`가 `analyse-php`에서 실패했다 | `rm -rf build/phpstan && make analyse-php` | [o] |
| H12.6 | HY-79: `node_modules`나 `vendor` 아래에 symbolic link가 없다. npm은 모든 의존성을 사본으로 설치하고 bin link를 만들지 않으며(`.npmrc`), root package는 npm이 언제나 link하는 workspace 대신 이 저장소의 package를 선언하고, `make packages`는 build 뒤 사본을 다시 설치하며, recipe는 도구를 그 package의 파일로 실행하고, Composer는 board에 `polyspec/hyper`를 추적 파일 사본 `var/products/hyper-php`에서 설치한다. `tests/scripts/no-symlinks.test.mjs`는 symbolic link 하나에도 실패한다 | `node scripts/run-tests.mjs node -- tests/scripts/no-symlinks.test.mjs` | [o] |
| H12.6-1 | 각 npm package에 TypeScript compiler를 그 package의 경로로 실행하는 선언된 build를 둔다. H12.6이 bin link를 없앴으므로 `packages/hyper-js`에서 `npm exec --offline --no -- tsc`가 명령을 찾지 못했고(`This is not the tsc command you are looking for`), H12.6은 되돌려졌다. `scripts/tsc.mjs`는 `typescript/package.json`을 resolve하고 그 `bin.tsc`를 호출의 인자와 함께 실행한다. 각 package의 `npm run build`(`tsconfig.build.json`)와 `npm run tsc -- <arguments>`, Makefile의 `TSC`가 이것을 쓴다. H12.6은 이 작업과 함께 다시 들어간다 | `node scripts/run-tests.mjs node -- tests/scripts/package-build.test.mjs` | [o] |
