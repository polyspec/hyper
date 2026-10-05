# 웨이브 배경

[English](waves.md).

각 section은 [실행 체크리스트](execution-checklist.ko.md)의 웨이브 하나의 의존과 배경을 적으며, 체크리스트의 웨이브 제목이 이 section을 link한다.

## Wave 1

의존: 없음.

## Wave 2

의존: 웨이브 1.

## Wave 3

의존: 없음.

## Wave 4

의존: 웨이브 2.

## Wave 5

의존: 없음. 브라우저는 라우트의 템플릿이 참조하는 모든 템플릿을 끝까지 받는다(HY-35). 하나의 라우트의 분기 템플릿이 모든 화면을 참조해 요청 시점에 화면을 고르는 페이지는, 렌더하지 않는 화면까지 모든 페이지에서 모든 화면 템플릿을 받는다.

## Wave 6

의존: 웨이브 5. 페이지는 템플릿, 스타일시트, 스크립트 모두 자기가 쓰는 자원만, 각각 한 번만 요청해야 한다. 에셋 빌드는 세 곳에서 이 규칙을 어긴다. 클라이언트 코드를 파일 하나에 쓰므로, 애플리케이션은 일부 페이지만 쓰는 코드를 그 페이지가 필요할 때 불러올 수 없다. 정적 셸은 렌더한 레이아웃도 링크하는 `app.css`를 인라인하므로, 클라이언트 렌더 페이지는 그 파일을 두 번 받는다. 빌드는 `public/assets/manifest.json`에 다른 애플리케이션에는 없는 게시판 예제의 이름 `css`와 `reader`를 쓴다. `scripts/build-assets.mjs`와 `scripts/build-templates.mjs`의 머리 주석은 웨이브 5가 제거한, 참조 템플릿을 담은 색인을 아직 설명한다.

## Wave 7

의존: 없음. 모든 checklist는 네 가지 작업 상태를 쓴다. 대기, 진행 중, 완료, 원인과 재시도 조건을 적은 일시 우회다. 이 checklist는 완료 작업을 대괄호 안의 x로, 막힌 작업을 대기 표시 뒤의 `blocked: <이유>`로 적었고, 상태를 읽는 검사가 없었다.

## Wave 8

의존: 웨이브 6. Tailwind CSS로 page를 꾸미는 template은 utility class를 쓰는데, asset build에는 template이 쓰는 Tailwind class로 stylesheet를 compile하는 단계가 없다.

## Wave 9

의존: 없음. HY-62의 selection은 `true` 또는 `false`만 반환하므로, `Host` header의 service처럼 저장된 data를 읽는 selection을 둔 application은 같은 request에서 selection에서 한 번, handler에서 다시 한 번, 같은 data를 두 번 읽는다. selection은 값을 가진 choice를 반환하고, request의 모든 handler는 그 값을 request에서 읽는다.

## Wave 10

의존: H10.4는 template T14.2에 의존한다. server와 build에는 결함 네 가지가 있다. PHP의 HY-44 검사는 loader data의 application object를 받지만 Node는 HY-43으로 거부하므로, 두 server가 같은 loader에 다르게 답한다. server build는 HC-6, HY-3, HY-30의 template 검사를 실행하지 않는다. 이 검사는 board 예제에서 `make templates-check`만 실행하므로, server program은 이를 어기는 template을 제공한다. asset build는 이전 build의 파일을 지우고(`build-assets.mjs`, `template-files.mjs`) hash 없는 출력을 `public/`에 쓴다. 그래서 이전 build를 아직 제공하는 server나 browser에 이미 열린 page가 사라진 파일을 읽는다. document의 render마다 shared data를 다시 binding한다.

## Wave 11

의존: 없음. 세 곳에서 검사가 한도 없이 또는 진행 출력 없이 실행되었다. AGENTS의 필수 검사는 기능을 implemented로 표시하기 전에 `make check`를 요구했고, 작업 행은 검증으로 `make check`를 적었으므로, 작업마다 전체 suite가 실행되었다. test target은 vitest, `node --test`, PHPUnit을 직접 실행했다. `node --test`와 PHPUnit에는 test별 timeout이 없어서 끝나지 않는 test가 실행을 끝없이 멈추고, 세 도구 모두 test마다 시작과 경과 시간을 출력하지 않는다. `scripts/check-parity.mjs`는 timeout 없는 `fetch`로 요청하고 step이 끝난 뒤에만 줄을 출력하므로, 응답하지 않는 server가 step 이름 없이 검사를 멈춘다.

## Wave 12

의존: 없음. 서로 다른 checkout이나 session의 두 실행이, 다른 실행이 쓰고 있는 resource를 바꾸거나 초기화했다. node_modules는 `@polyspec/template`을 `../template/packages/template-ts`에 link했고, 그 build는 `dist`를 비운다(tsup `clean: true`). `make template`은 template 저장소에서 그 package를 build했고, Composer, PHPStan, `make ext`는 template checkout을 읽었다. `make parity`와 `make server-parity`는 고정 port 8092, 8094, 8096에 서버를 띄우고 그 port에서 응답하는 아무 서버나 받아들였으며, 고정 database `examples/board/var/parity*.db`와 session directory `parity-sessions`를 썼다. `make e2e`는 port 8090, 8091, 8093과 `var/e2e.db`를, `make bench-browser`는 port 8085 ~ 8087과 `var/bench-browser.db`를 썼다. 실행의 resource는 그 실행이 격리한다(system이 배정하고 서버가 알리는 port, 임시 directory). 하나뿐인 resource는 한 번에 holder 하나를 가지며, holder는 원자적으로 만드는 lock file에 기록되고 그 file은 holder의 checkout, process ID, 시작 시각을 적는다. 다른 실행은 그 holder를 밝히며 실패하고, holder가 lock을 푼다. process가 끝난 lock은 보고되고 명시적인 명령으로 지운다.
