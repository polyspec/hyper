<!-- doc-id: waves -->
<!-- source-sha256: 9b42856bf8e00314fb7d0cc5a69d2ab8f963ab7dd8c2cf18688ed8cd02868dd3 -->
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

## Wave 13

의존: 없음. AGENTS는 `[~]` 작업이 없을 때만 push를 허용하지만 이를 강제하는 것이 없었다. push는 진행 중인 작업이 있는 tree를 보냈고, 그 tree의 전체 suite는 guard가 거부한다. pre-push hook은 `make`를 실행한 모든 checkout에서 그런 push를 거부하고, workflow `push-gate`는 hook을 거치지 않은 push도 포함해 그런 commit에 대해 GitHub에서 실패한다.

## Wave 14

의존: 없음. 이 저장소의 검사는 실행 시각과 machine, 이전 실행이 남긴 상태에 따라 다른 결과를 냈다. 2026-10-05의 full run은 7개 target에서 실패했다. 모든 target이 `make template`을 실행했고, 그것은 template 저장소가 `dist`를 다시 build하는 동안 `../template`의 working tree를 복사했다. 이어서 npm 12.2.0이 `npm pack --json`을 object로 출력해 복사가 `TypeError: object is not iterable`로 실패했다. 이 저장소의 검사에는 열 가지 결함 class가 있다. 시각이나 외부 세계에 의존하는 결과, 남은 상태에 의존하는 test, 지운 뒤 쓰는 방식으로 publish하는 출력, 첫 실패한 검사에서 멈추는 recipe, 스스로 설명하지 않는 실패, 실행하지 않고 통과할 수 있는 case, 누수된 process와 파일, 버전에 따라 다른 tool 출력에 대한 assertion, owner test가 없는 변경 경로, 공유 상태의 경쟁이다. 각 class는 이 저장소의 모든 사례를 고치는 작업과 AGENTS의 규칙을 받는다.

## Wave 15

의존: 없음. 있는 라우트 영역이 있는 라우트의 모든 서버 렌더 문서는 데이터를 `#hy-data`에 내장했다. 그래서 페이지의 소스에 HTML과 함께 데이터가 보였고 HTML이 컸다. 보기만 하는 페이지는 그 데이터를 쓰지 않는다. 이제 애플리케이션이 문서가 데이터를 내장할지 요청마다 정하며(HY-92), 기본으로 문서는 데이터를 내장하지 않는다. 브라우저는 데이터가 처음 필요할 때 페이지의 문서 JSON을 한 번 요청한다(HY-93). protocol의 서버 규칙은 Python 구현도 가진다. package `packages/hyper-python`이 template Python package로 렌더하고 `http.server`로 board 예제를 서비스한다(H15.3).

## Wave 16

의존: 없음. push를 막고, 전체 suite를 실행하고, 문서를 검사하고, owner 검사를 고르고, test를 실행하고, CI를 보고하고, toolchain을 검사하고, release하고, 의존성을 검토하는 script는 여러 polyspec 저장소에 복사본으로 있었고 저장소마다 달랐다. 이제 이 script는 공유 도구 저장소 `polyspec/kit`에서 온다. 이 저장소는 tag `v0.0.7`의 `scripts/kit/`와 `tests/kit/`를 byte 단위로 같은 복사본으로 가지며(`kit.json`, `.kit/kit.lock.json`), 다른 저장소와는 `config/*.json`에서만 다르다. 버전 0.1 전까지 변경은 그 변경을 소유한 unit test로 검사하고, 모든 작업이 끝났을 때 `main`에 한 번 push한다. `main`의 push는 CI group job을 실행하며, release tag는 그 CI 실행의 check `ci-passed`가 성공한 뒤에만 붙인다(W16).
