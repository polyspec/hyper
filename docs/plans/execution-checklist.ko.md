# 실행 체크리스트

[English](execution-checklist.md).

이 문서는 hyper의 계획한 작업, 작업마다의 검증 명령, 완료 여부를 기록한다. 규칙은 [프로토콜](../spec/protocol.ko.md)에, 기능마다의 상태는 [기능 상태](../features.ko.md)에, 실제 변경은 [변경 기록](../../CHANGELOG.ko.md)에 있다.

## 사용법

- 작업 ID 형식: `H<웨이브>.<번호>`.
- 모든 작업 행의 마지막 열은 상태다(AGENTS). `[ ]` 대기, `[~]` 진행 중, `[o]` 완료, `[!] cause: <원인>; retry: <조건>` 일시 우회. 커밋한 tree에서 verification command가 통과한 뒤에만 `[o]`로 바꾼다.
- 작업은 명세를 먼저 바꾸고, 규칙 식별자를 인용하는 실패하는 테스트를 추가한 다음, 구현을 바꾼다.
- 웨이브는 의존한다고 적은 웨이브가 완료되면 시작한다.

## 웨이브 1 — 애플리케이션이 약하게 만들 수 없는 CSRF 방어

의존: 없음.

| ID | 작업 | 검증 | 상태 |
|---|---|---|---|
| H1.1 | 가린 토큰(HY-24, HY-10, HY-71), 세션 쿠키 이름(HY-45), 세션 갱신(HY-72), 비공개 페이지 캐시(HY-52)를 명세하고 `conformance/csrf.json`을 추가한다 | `make docs-check` | [o] |
| H1.2 | PHP 서버: 모든 응답에서 토큰을 가리고 가린 값만 받는다(HY-24). 세션 쿠키 이름을 `__Host-hy-session` 또는 `hy-session`으로 정한다(HY-45). 액션에서 세션을 갱신하고 로더의 갱신은 실패시킨다(HY-72). 공유 캐시가 저장할 수 있는 `Cache-Control`을 거부한다(HY-52) | `make test-php` | [o] |
| H1.3 | Node 서버: H1.2와 같은 규칙, 그리고 쿠키 이름 옵션이 없는 `FileSessions` | `make test-node` | [o] |
| H1.4 | H1.1~H1.3에 대한 예제, 브라우저 테스트, 결과 일치 검사, 기능 상태, 배포 절차, 변경 기록 | `make check` | [o] |

## 웨이브 2 — 템플릿이 읽는 데이터만 보내기

의존: 웨이브 1.

| ID | 작업 | 검증 | 상태 |
|---|---|---|---|
| H2.1 | 라우트의 읽기 경로를 명세한다. 레이아웃, 제목, 영역 템플릿이 포함 템플릿과 블록을 거쳐 읽는 경로, 라우트 영역의 유지 경로, 라우트 영역이 서버에 값을 남길 때의 `csrf`다. 서버는 공유 데이터와 영역 데이터에서 그 경로만 보낸다 | `make docs-check` | [o] |
| H2.2 | 브라우저 패키지: 템플릿 AST에서 라우트마다 읽기 경로를 계산한다. 변수, 멤버, 인덱스, 반복, 대입, 포함, 블록, 함수 인자, 연산자 사례를 둔다 | `make test-js` | [o] |
| H2.3 | 서버 빌드: PHP 서버를 위해 읽기 경로를 쓴다. PHP 서버: 렌더와 인코딩 전에 그 밖의 경로를 모두 뺀다 | `make test-php` | [o] |
| H2.4 | Node 서버: 브라우저 패키지의 읽기 경로로 H2.3과 같이 뺀다. 공통 사례는 `conformance/reads.json`에 둔다 | `make test-node` | [o] |
| H2.5 | H2.1~H2.4에 대한 예제, 결과 일치 검사, 브라우저 테스트, 번들 크기, 기능 상태, README, 변경 기록 | `make check` | [o] |
| H2.6 | 반복 변수의 읽기 경로를 그 반복의 본문 안에서만 계산해, 앞의 대입이 읽은 이름을 다시 묶는 반복 변수에서도 분석이 끝나게 한다. `conformance/reads.json`의 사례 두 개와 모든 사례의 시간 제한 | `make test-js` | [o] |

## 웨이브 3 — 결함이 있으면 계속하지 않고 실패하기

의존: 없음.

| ID | 작업 | 검증 | 상태 |
|---|---|---|---|
| H3.1 | 요청 중 정의되지 않은 변수나 배열 키 같은 PHP 경고나 알림이 나면, 그 요청을 HY-43처럼 실패시킨다고 명세한다 | `make docs-check` | [o] |
| H3.2 | PHP 서버: 요청의 모든 경고와 알림을 예외로 바꾸고, 종류마다 실패하는 테스트를 둔다 | `make test-php` | [o] |
| H3.3 | PHP 패키지의 정적 분석을 가장 높은 수준으로 `make check`에서 실행하고, 찾은 문제를 모두 고친다 | `make check` | [o] |

## 웨이브 4 — 조합한 페이지의 라우트 영역

의존: 웨이브 2.

| ID | 작업 | 검증 | 상태 |
|---|---|---|---|
| H4.1 | 없는 라우트 영역과 그 배치를 명세한다. 로더가 null을 돌려주는 라우트 영역은 그 응답에 없다(데이터, 유지 값, 정의가 없으므로 `{?# name}`은 거짓이다). 라우트 템플릿이 포함하거나 경로로 배치하는 템플릿도 라우트 영역을 배치할 수 있다. 있는 라우트 영역은 페이지에 요소가 정확히 하나이고, 브라우저가 이를 확인한다. 템플릿 검사는 포함과 블록을 따라간다 | `make docs-check` | [o] |
| H4.2 | PHP 서버: 문서와 JSON의 없는 라우트 영역 | `make test-php` | [o] |
| H4.3 | 브라우저 패키지와 Node 서버: 렌더, 보관 데이터, 내장 데이터의 없는 라우트 영역과 요소 확인 | `make test-js`, `make test-node` | [o] |
| H4.4 | 템플릿 검사, 예제(공지가 없으면 공지 라우트 영역이 없다), 브라우저 테스트, 결과 일치 검사, 기능 상태, 변경 기록 | `make check` | [o] |

## 웨이브 5 — 렌더가 닿는 템플릿만 받기

의존: 없음. 브라우저는 라우트의 템플릿이 참조하는 모든 템플릿을 끝까지 받는다(HY-35). 하나의 라우트의 분기 템플릿이 모든 화면을 참조해 요청 시점에 화면을 고르는 페이지는, 렌더하지 않는 화면까지 모든 페이지에서 모든 화면 템플릿을 받는다.

| ID | 작업 | 검증 | 상태 |
|---|---|---|---|
| H5.1 | 렌더가 템플릿에 닿을 때 브라우저가 그 템플릿을 받는다고 명세한다. 렌더하고, 렌더가 요청했지만 로더에 없던 템플릿을 모두 받고, 다시 렌더한다. 어떤 렌더도 닿지 않는 템플릿은 받지 않는다 | `make docs-check` | [o] |
| H5.2 | 브라우저 패키지: 영역 응답, 브라우저 렌더, 내장 데이터, `render`, `set`에서 필요할 때 받는 렌더. 선택되지 않은 분기는 템플릿을 받지 않는다는 테스트 | `make test-js` | [o] |
| H5.3 | 예제, 브라우저 테스트, 번들 크기, 기능 상태, 변경 기록 | `make check` | [o] |

## 웨이브 6 — 페이지가 쓰는 자원만 요청하기

의존: 웨이브 5. 페이지는 템플릿, 스타일시트, 스크립트 모두 자기가 쓰는 자원만, 각각 한 번만 요청해야 한다. 에셋 빌드는 세 곳에서 이 규칙을 어긴다. 클라이언트 코드를 파일 하나에 쓰므로, 애플리케이션은 일부 페이지만 쓰는 코드를 그 페이지가 필요할 때 불러올 수 없다. 정적 셸은 렌더한 레이아웃도 링크하는 `app.css`를 인라인하므로, 클라이언트 렌더 페이지는 그 파일을 두 번 받는다. 빌드는 `public/assets/manifest.json`에 다른 애플리케이션에는 없는 게시판 예제의 이름 `css`와 `reader`를 쓴다. `scripts/build-assets.mjs`와 `scripts/build-templates.mjs`의 머리 주석은 웨이브 5가 제거한, 참조 템플릿을 담은 색인을 아직 설명한다.

| ID | 작업 | 검증 | 상태 |
|---|---|---|---|
| H6.1 | HY-76을 명세한다. 페이지는 자기가 쓰는 자원만, 각각 많아야 한 번 요청한다. 에셋 빌드는 클라이언트 진입 파일과, 진입 파일이 `import()`로 불러오는 코드마다 조각 파일 하나, 진입 파일 URL만 담은 `manifest.json`, 스타일시트 없는 정적 셸을 쓴다 | `make docs-check` | [o] |
| H6.2 | 에셋 빌드: 조각 파일, 매니페스트, 셸, 주석. 변경 전에 실패하는 빌드 테스트 | `make test-scripts` | [o] |
| H6.3 | 게시판 예제: 레이아웃이 자기 스타일시트를 링크한다. 문서, 번들 크기, 기능 상태, 변경 기록 | `make check` | [o] |

## 웨이브 7 — 네 가지 작업 상태

의존: 없음. 모든 checklist는 네 가지 작업 상태를 쓴다. `[ ]` 대기, `[~]` 진행 중, `[o]` 완료, 원인과 재시도 조건을 적은 `[!]` 일시 우회다. 이 checklist는 `[x]`와 `[ ] blocked: <이유>`를 썼고, 상태를 읽는 검사가 없었다.

| ID | 작업 | 검증 | 상태 |
|---|---|---|---|
| H7.1 | `scripts/check-documents.mjs`가 네 가지 작업 상태만, 두 언어에서 같게 받고, 일시 우회 작업은 원인과 재시도 조건을 담게 한다. `[x]` 행에서 실패하는지 확인한다. 모든 완료 작업을 `[o]`로 쓴다. AGENTS에 checklist 규칙을 적는다 | `make docs-check` | [o] |
| H7.2 | AGENTS에 72자에서 줄을 바꾼 본문을 가진 commit message 형식 `type(scope): Subject (#task)`, `main`에서 직접 작업할 수 있음, branch와 worktree의 이름과 merge 뒤의 제거, merge할 수 없는 test code의 제거, 받은 지시를 agent memory와 함께 분류하는 규칙을 적는다 | `make docs-check` | [o] |

## 웨이브 8 — asset build의 Tailwind CSS

의존: 웨이브 6. Tailwind CSS로 page를 꾸미는 template은 utility class를 쓰는데, asset build에는 template이 쓰는 Tailwind class로 stylesheet를 compile하는 단계가 없다.

| ID | 작업 | 검증 | 상태 |
|---|---|---|---|
| H8.1 | HY-77을 명세한다. `--tailwind <source>=<output>`은 application의 source stylesheet를 최신 stable Tailwind CSS의 theme과 utility로 compile하여, template과 client code가 쓰는 utility를 생성하고 source의 rule을 cascade layer `components`에 쓴다 | `make docs-check` | [o] |
| H8.2 | asset build: 이 option과 변경 전에 실패하는 build test, dependency로서의 Tailwind CSS, 문서와 changelog | `make check` | [o] |
| H8.2-1 | 정적 배포물이 stylesheet를 복사하기 전에 Tailwind stylesheet를 compile한다. build가 복사 뒤에 output을 썼으므로, `dist/csr/assets/`에는 첫 build의 output이 없었고 다음 build에서는 이전 build의 output이 있었다| `make check` | [o] |

## 웨이브 9 — client rendering selection의 값이 handler에 전달된다

의존: 없음. HY-62의 selection은 `true` 또는 `false`만 반환하므로, `Host` header의 service처럼 저장된 data를 읽는 selection을 둔 application은 같은 request에서 selection에서 한 번, handler에서 다시 한 번, 같은 data를 두 번 읽는다. selection은 값을 가진 choice를 반환하고, request의 모든 handler는 그 값을 request에서 읽는다.

| ID | 작업 | 검증 | 상태 |
|---|---|---|---|
| H9.1 | HY-62에 명세한다. selection은 request가 client-rendered page의 것인지와 값을 담은 choice를 반환한다. request의 모든 loader와 action은 그 값을 request에서 읽고, 선언이 없는 application의 request는 값 null을 가진다 | `make docs-check` | [o] |
| H9.2 | PHP와 Node server: `Choice`, `Request::selection()`, `request.selection()`과 변경 전에 실패하는 test, 문서, feature status, changelog | `make check` | [o] |

## 웨이브 10 — data model 검사 한 번과 추가만 하는 build 출력

의존: H10.4는 template T14.2에 의존한다. server와 build에는 결함 네 가지가 있다. PHP의 HY-44 검사는 loader data의 application object를 받지만 Node는 HY-43으로 거부하므로, 두 server가 같은 loader에 다르게 답한다. server build는 HC-6, HY-3, HY-30의 template 검사를 실행하지 않는다. 이 검사는 board 예제에서 `make templates-check`만 실행하므로, server program은 이를 어기는 template을 제공한다. asset build는 이전 build의 파일을 지우고(`build-assets.mjs`, `template-files.mjs`) hash 없는 출력을 `public/`에 쓴다. 그래서 이전 build를 아직 제공하는 server나 browser에 이미 열린 page가 사라진 파일을 읽는다. document의 render마다 shared data를 다시 binding한다.

| ID | 작업 | 검증 | 상태 |
|---|---|---|---|
| H10.1 | HY-44: loader와 shared handler 값의 host binding에 native object(VAL-19)가 있으면 HY-43으로 실패하고, binding이 data model 값으로 바꾸는 값(PHP `stdClass`, `JsonSerializable`)은 통과한다. 변경 전 PHP에서 실패하는 case를 둔다 | `make check` | [o] |
| H10.2 | `check-templates.mjs`의 검사를 manifest와 template directory를 받는 함수 하나로 옮기고, `make templates-check`와 `build-server.mjs`가 아무것도 쓰기 전에 그 함수를 쓴다. HY-48에 위반이 있으면 아무것도 쓰지 않는다고 적는다. 변경 전에 실패하는 case를 둔다 | `make check` | [o] |
| H10.2-1 | template 규칙이 조건 분기 안의 배치와 include를 보게 한다. 순회는 type이 없는 객체 안의 node 목록을 건너뛰었으므로, `{? }` 분기를 거쳐 배치한 route region을 0번으로 셌다. server build가 쓰도록 규칙을 `scripts/template-rules.mjs`의 `templateProblems`로 옮긴다. 분기 안에 배치한 region과 분기 안의 include로 배치한 region을 가진 fixture route를 둔다 | `make check` | [o] |
| H10.3 | asset build는 이름에 content hash가 있는 파일을 더하기만 하고, hash 없는 출력(`manifest.json`, `templates.index.json`)은 `--output` directory에 쓴다(HY-34, HY-76). 변경 전에 실패하는 build test를 둔다 | `make check` | [o] |
| H10.4 | template T14.2의 bound 값으로 pruning한 root를 document마다 한 번 binding하고 모든 render에 쓴다. 그래서 값은 render 횟수와 상관없이 최대 두 번 검사된다. JSON 응답은 `params`만 다시 binding한다 | `make check` | [o] |
| H10.5 | 브라우저 package와 Node package가 template package의 host binding을 이름 `bindValue`로 부른다. template T14.2가 TypeScript host binding `bind`를 `bindValue`로 바꾸고 `bind`를 bound map에 주었으므로, template main에서 `packages/hyper-js`의 `tsc`가 `BoundMap is not assignable to Value`로 실패했고 | `make check` | [o] |

## 웨이브 11 — 진행을 출력하고 한도가 있는 test 실행

의존: 없음. 세 곳에서 검사가 한도 없이 또는 진행 출력 없이 실행되었다. AGENTS의 필수 검사는 기능을 implemented로 표시하기 전에 `make check`를 요구했고, 작업 행은 검증으로 `make check`를 적었으므로, 작업마다 전체 suite가 실행되었다. test target은 vitest, `node --test`, PHPUnit을 직접 실행했다. `node --test`와 PHPUnit에는 test별 timeout이 없어서 끝나지 않는 test가 실행을 끝없이 멈추고, 세 도구 모두 test마다 시작과 경과 시간을 출력하지 않는다. `scripts/check-parity.mjs`는 timeout 없는 `fetch`로 요청하고 step이 끝난 뒤에만 줄을 출력하므로, 응답하지 않는 server가 step 이름 없이 검사를 멈춘다.

| ID | 작업 | 검증 | 상태 |
|---|---|---|---|
| H11.1 | AGENTS의 필수 검사: 커밋 전에는 변경을 소유한 Red test와 Green test, 그리고 `make docs-check`; 작업은 Verification column에 적은 그 작업의 소유 명령으로 `[o]`가 된다; `make check`는 활성 작업이 모두 끝났을 때 한 번 실행한다 | `make docs-check` | [o] |
| H11.2 | vitest, `node --test`, PHPUnit을 `scripts/run-tests.mjs`와 그 진행 reporter로 실행한다: 모든 test는 시작, 결과, 경과 시간을 출력하고 자기 timeout에서 이름으로 실패한다; `make test-js`, `test-node`, `test-php`, `test-scripts`, `package-check`가 이를 쓴다; runner는 자기 test를 가진다 | `node scripts/run-tests.mjs node -- tests/scripts/run-tests.test.mjs` | [~] |
| H11.3 | `scripts/check-parity.mjs`는 모든 요청에 `AbortSignal.timeout`으로 timeout을 주고, step이 시작할 때 줄을 출력하고 결과와 함께 경과 밀리초를 출력하며, server가 응답하지 않으면 step 이름으로 실패한다; 응답하지 않는 server에 대한 test | `node scripts/run-tests.mjs node -- tests/scripts/check-parity.test.mjs` | [ ] |
