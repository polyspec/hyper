<!-- doc-id: plan-execution -->
<!-- source-sha256: d6a5ee23c08ff62f65761d63e5607f63fc86ae2dd993b7e06fae2544db197df3 -->
# 실행

[English](plan.md).

각 section은 [실행 체크리스트](checklist.ko.md)의 웨이브 하나의 의존과 배경을 적는다.

## Wave 1 — 애플리케이션이 약하게 만들 수 없는 CSRF 방어

의존: 없음.

## Wave 2 — 템플릿이 읽는 데이터만 보내기

의존: 웨이브 1.

## Wave 3 — 결함이 있으면 계속하지 않고 실패하기

의존: 없음.

## Wave 4 — 조합한 페이지의 라우트 영역

의존: 웨이브 2.

## Wave 5 — 렌더가 닿는 템플릿만 받기

의존: 없음. 브라우저는 라우트의 템플릿이 참조하는 모든 템플릿을 끝까지 받는다(HY-35). 하나의 라우트의 분기 템플릿이 모든 화면을 참조해 요청 시점에 화면을 고르는 페이지는, 렌더하지 않는 화면까지 모든 페이지에서 모든 화면 템플릿을 받는다.

## Wave 6 — 페이지가 쓰는 자원만 요청하기

의존: 웨이브 5. 페이지는 템플릿, 스타일시트, 스크립트 모두 자기가 쓰는 자원만, 각각 한 번만 요청해야 한다. 에셋 빌드는 세 곳에서 이 규칙을 어긴다. 클라이언트 코드를 파일 하나에 쓰므로, 애플리케이션은 일부 페이지만 쓰는 코드를 그 페이지가 필요할 때 불러올 수 없다. 정적 셸은 렌더한 레이아웃도 링크하는 `app.css`를 인라인하므로, 클라이언트 렌더 페이지는 그 파일을 두 번 받는다. 빌드는 `public/assets/manifest.json`에 다른 애플리케이션에는 없는 게시판 예제의 이름 `css`와 `reader`를 쓴다. `scripts/build-assets.mjs`와 `scripts/build-templates.mjs`의 머리 주석은 웨이브 5가 제거한, 참조 템플릿을 담은 색인을 아직 설명한다.

## Wave 7 — 네 가지 작업 상태

의존: 없음. 모든 checklist는 네 가지 작업 상태를 쓴다. 대기, 진행 중, 완료, 원인과 재시도 조건을 적은 일시 우회다. 이 checklist는 완료 작업을 대괄호 안의 x로, 막힌 작업을 대기 표시 뒤의 `blocked: <이유>`로 적었고, 상태를 읽는 검사가 없었다.

## Wave 8 — asset build의 Tailwind CSS

의존: 웨이브 6. Tailwind CSS로 page를 꾸미는 template은 utility class를 쓰는데, asset build에는 template이 쓰는 Tailwind class로 stylesheet를 compile하는 단계가 없다.

## Wave 9 — client rendering selection의 값이 handler에 전달된다

의존: 없음. HY-62의 selection은 `true` 또는 `false`만 반환하므로, `Host` header의 service처럼 저장된 data를 읽는 selection을 둔 application은 같은 request에서 selection에서 한 번, handler에서 다시 한 번, 같은 data를 두 번 읽는다. selection은 값을 가진 choice를 반환하고, request의 모든 handler는 그 값을 request에서 읽는다.

## Wave 10 — data model 검사 한 번과 추가만 하는 build 출력

의존: H10.4는 template T14.2에 의존한다. server와 build에는 결함 네 가지가 있다. PHP의 HY-44 검사는 loader data의 application object를 받지만 Node는 HY-43으로 거부하므로, 두 server가 같은 loader에 다르게 답한다. server build는 HC-6, HY-3, HY-30의 template 검사를 실행하지 않는다. 이 검사는 board 예제에서 `make templates-check`만 실행하므로, server program은 이를 어기는 template을 제공한다. asset build는 이전 build의 파일을 지우고(`build-assets.mjs`, `template-files.mjs`) hash 없는 출력을 `public/`에 쓴다. 그래서 이전 build를 아직 제공하는 server나 browser에 이미 열린 page가 사라진 파일을 읽는다. document의 render마다 shared data를 다시 binding한다.

## Wave 11 — 진행을 출력하고 한도가 있는 test 실행

의존: 없음. 세 곳에서 검사가 한도 없이 또는 진행 출력 없이 실행되었다. AGENTS의 필수 검사는 기능을 implemented로 표시하기 전에 `make check`를 요구했고, 작업 행은 검증으로 `make check`를 적었으므로, 작업마다 전체 suite가 실행되었다. test target은 vitest, `node --test`, PHPUnit을 직접 실행했다. `node --test`와 PHPUnit에는 test별 timeout이 없어서 끝나지 않는 test가 실행을 끝없이 멈추고, 세 도구 모두 test마다 시작과 경과 시간을 출력하지 않는다. `scripts/check-parity.mjs`는 timeout 없는 `fetch`로 요청하고 step이 끝난 뒤에만 줄을 출력하므로, 응답하지 않는 server가 step 이름 없이 검사를 멈춘다.

## Wave 12 — 한 실행의 test resource

의존: 없음. 서로 다른 checkout이나 session의 두 실행이, 다른 실행이 쓰고 있는 resource를 바꾸거나 초기화했다. node_modules는 `@polyspec/template`을 `../template/packages/template-ts`에 link했고, 그 build는 `dist`를 비운다(tsup `clean: true`). `make template`은 template 저장소에서 그 package를 build했고, Composer, PHPStan, `make ext`는 template checkout을 읽었다. `make parity`와 `make server-parity`는 고정 port 8092, 8094, 8096에 서버를 띄우고 그 port에서 응답하는 아무 서버나 받아들였으며, 고정 database `examples/board/var/parity*.db`와 session directory `parity-sessions`를 썼다. `make e2e`는 port 8090, 8091, 8093과 `var/e2e.db`를, `make bench-browser`는 port 8085 ~ 8087과 `var/bench-browser.db`를 썼다. 실행의 resource는 그 실행이 격리한다(system이 배정하고 서버가 알리는 port, 임시 directory). 하나뿐인 resource는 한 번에 holder 하나를 가지며, holder는 원자적으로 만드는 lock file에 기록되고 그 file은 holder의 checkout, process ID, 시작 시각을 적는다. 다른 실행은 그 holder를 밝히며 실패하고, holder가 lock을 푼다. process가 끝난 lock은 보고되고 명시적인 명령으로 지운다.

## Wave 13 — 진행 중인 작업이 없는 push

의존: 없음. AGENTS는 `[~]` 작업이 없을 때만 push를 허용하지만 이를 강제하는 것이 없었다. push는 진행 중인 작업이 있는 tree를 보냈고, 그 tree의 전체 suite는 guard가 거부한다. pre-push hook은 `make`를 실행한 모든 checkout에서 그런 push를 거부하고, workflow `push-gate`는 hook을 거치지 않은 push도 포함해 그런 commit에 대해 GitHub에서 실패한다.

## Wave 14 — tree에만 의존하는 결과

의존: 없음. 이 저장소의 검사는 실행 시각과 machine, 이전 실행이 남긴 상태에 따라 다른 결과를 냈다. 2026-10-05의 full run은 7개 target에서 실패했다. 모든 target이 `make template`을 실행했고, 그것은 template 저장소가 `dist`를 다시 build하는 동안 `../template`의 working tree를 복사했다. 이어서 npm 12.2.0이 `npm pack --json`을 object로 출력해 복사가 `TypeError: object is not iterable`로 실패했다. 이 저장소의 검사에는 열 가지 결함 class가 있다. 시각이나 외부 세계에 의존하는 결과, 남은 상태에 의존하는 test, 지운 뒤 쓰는 방식으로 publish하는 출력, 첫 실패한 검사에서 멈추는 recipe, 스스로 설명하지 않는 실패, 실행하지 않고 통과할 수 있는 case, 누수된 process와 파일, 버전에 따라 다른 tool 출력에 대한 assertion, owner test가 없는 변경 경로, 공유 상태의 경쟁이다. 각 class는 이 저장소의 모든 사례를 고치는 작업과 AGENTS의 규칙을 받는다.

## Wave 15 — 애플리케이션이 요청할 때만 데이터를 내장하는 문서

의존: 없음. 있는 라우트 영역이 있는 라우트의 모든 서버 렌더 문서는 데이터를 `#hy-data`에 내장했다. 그래서 페이지의 소스에 HTML과 함께 데이터가 보였고 HTML이 컸다. 보기만 하는 페이지는 그 데이터를 쓰지 않는다. 이제 애플리케이션이 문서가 데이터를 내장할지 요청마다 정하며(HY-92), 기본으로 문서는 데이터를 내장하지 않는다. 브라우저는 데이터가 처음 필요할 때 페이지의 문서 JSON을 한 번 요청한다(HY-93). protocol의 서버 규칙은 Python 구현도 가진다. package `packages/hyper-python`이 template Python package로 렌더하고 `http.server`로 board 예제를 서비스한다(H15.3).

## Wave 16 — polyspec/kit의 공유 도구

의존: 없음. push를 막고, 전체 suite를 실행하고, 문서를 검사하고, owner 검사를 고르고, test를 실행하고, CI를 보고하고, toolchain을 검사하고, release하고, 의존성을 검토하는 script는 여러 polyspec 저장소에 복사본으로 있었고 저장소마다 달랐다. 이제 이 script는 공유 도구 저장소 `polyspec/kit`에서 온다. 이 저장소는 tag `v0.0.9`의 `scripts/kit/`와 `tests/kit/`를 byte 단위로 같은 복사본으로 가지며(`kit.json`, `.kit/kit.lock.json`), 다른 저장소와는 `config/*.json`에서만 다르다. 버전 0.1 전까지 변경은 그 변경을 소유한 unit test로 검사하고, 모든 작업이 끝났을 때 `main`에 한 번 push한다. `main`의 push는 CI group job을 실행하며, release tag는 그 CI 실행의 check `ci-passed`가 성공한 뒤에만 붙인다(W16).

## Wave 17 — 릴리스 0.0.5와 0.0.6

의존: wave 16. 릴리스 0.0.5는 `config/release.json`이 나열하는 모든 manifest의 버전을 0.0.5로 정하며, 이는 릴리스 v0.0.5의 template pin과 git tag로 사용하는 Python 패키지를 포함한다. 릴리스 0.0.6은 같은 manifest의 버전을 0.0.6으로 정하고 릴리스 v0.0.5의 template pin을 유지한다.

## Wave 18 — 역할을 밝히는 package 이름

의존: wave 17. 같은 이름 `polyspec/hyper`가 npm에서는 browser package를, Composer에서는 PHP server를 가리켰고, directory `hyper-js`와 `hyper-node`는 package 이름과 달랐다. 이제 모든 package 이름은 역할(client, server, build)을 밝히고, `packages/` 아래 모든 directory는 역할과 server의 언어를 밝히므로, release archive 이름이 그 package의 역할과 registry를 밝힌다. 릴리스 0.0.7은 이 이름으로 package를 배포한다. 0.0.8 release가 Python 서버에 쓰기 hook을 준다.

## Wave 19 — production server가 실행하는 server callable

의존: wave 18. Python server는 `http.server` 위에서 application을 serving했는데, Python 문서는 그것을 production에 권장하지 않는다고 적으며 무엇이 앞에 서더라도 그렇다. `php -S`가 PHP에서 그러하듯이. 그래서 application이 그 프로젝트가 production에 권장하는 server 아래에서는 실행될 수 없었다. server의 pipeline — public file, body 제한, request hook `around`(HY-97), 새 session의 session cookie(HY-45), write hook `written`(HY-99), 실패한 write의 disconnect hook(HY-67) — 이 이제 WSGI application callable과 ASGI application callable로도 서 있다. library는 어떤 server도 이름하지 않고 그 의존을 갖지 않는다. 배포가 자기가 고른 server로 callable을 실행한다. 릴리스 0.0.9가 이 callable들을 발행한다.

## Wave 20 — 모든 서버의 쓰기 hook과 탈출 오류의 평범한 500

의존: wave 19. 요청의 answer를 벗어난 오류는 adapter마다 다른 방식으로 consumer에게 닿았다. PHP는 평범한 500을 응답 hook에 보고했고, Node와 Python `create_server`는 hook 보고 없이 그것을 썼으며, WSGI와 ASGI callable은 오류를 server에 전파했다. 쓰기 hook `written`은 Python `create_server`와 Node 응답의 event에만 있었으므로, consumer가 PHP 요청의 응답을 기록할 수 없었다. HY-99는 이제 모든 서버에 같은 값을 주는 쓰기 hook 하나를 정하고, HY-102는 Node 서버에 애플리케이션의 listener를 준다. HY-60은 탈출 오류의 평범한 500이 hyper가 요청을 받기 전에 호출자가 설정한 header를 유지한다고 정한다.

## Wave 21 — Referrer-Policy header를 정하는 reply

의존: wave 20. 페이지는 정책이 허용하는 만큼 페이지의 주소를 연결된 사이트에 Referer header로 보낸다. reply에는 Referrer-Policy header를 정하는 메서드가 없어서 application이 그 header를 제한할 수 없었고, 일반 header setter는 Cache-Control, frame 정책, cookie처럼 hyper가 페이지 header에 지키는 규칙을 우회했을 것이다. reply는 각 adapter에 명명된 메서드 `referrerPolicy`를 가지며(HY-103), 이 메서드는 Referrer-Policy 명세의 토큰만 받는다.

## Wave 22 — 외부 도구를 있는 그대로 쓰기

의존: wave 21. `AGENTS.md`의 경로와 symbolic link 규칙이 외부 도구가 만드는 link와 경로까지 다루는 것처럼 읽혀서, 변경이 이 저장소에 uv(Python 환경과 lock) 같은 생태계의 표준 도구를 다시 만들라고 요구하는 것으로 해석될 수 있었다. 이제 규칙은 기존 외부 도구나 라이브러리를 자기 동작과 함께 있는 그대로 쓴다고 정하며, 경로와 symbolic link 규칙은 이 저장소가 만드는 것을 다스린다고 밝힌다.

## Wave 23 — npm 패키지 @polyspec/kit인 공유 도구

의존: wave 22. 공유 도구는 `scripts/kit`과 `tests/kit`에 둔 kit 저장소 tag의 vendored 복사본이었고, npm은 모든 dependency를 bin link 없이 복사본으로 설치해서 `scripts/tsc.mjs`와 `node_modules`의 npm 패키지 복사본이 필요했다. 이제 kit은 npm 패키지 `@polyspec/kit`이다. 이 저장소는 release asset에서 그것을 설치하고, `kit.copies`의 파일만 복사본으로 가지며, kit이 pin하는 toolchain 하한을 선언한다. npm은 자기 기본값으로 설치한다. 이 저장소의 npm 패키지는 npm workspace이고 도구는 npm의 bin link로 실행한다.

## Wave 24 — 여러 process가 쓰는 session 파일

의존: wave 23. 같은 session 파일을 동시에 쓰는 두 process가 실패했다. Python과 Node의 session store는 session을 쓸 때마다 하나의 임시 파일 `<id>.tmp`에 쓰고 그것을 rename했다. 두 process가 겹치면 한쪽의 rename은 다른 쪽이 이미 옮긴 임시 파일을 찾아 `FileNotFoundError`를 던졌다. 이제 쓰기마다 자기 임시 파일을 만들고 rename한다(HY-104).

## Wave 27 — 링크 개발 이후의 릴리스 준비

의존: 완료된 개발 항목. H27.1은 이전 결정을 검토하고, H27.2는 PHP 의존성 그래프를 해결한 뒤 H27.3이 후보를 빌드하고 검증한다. H26.9는 별도 측정 작업으로 유지한다.

체크리스트의 종결 상태는 릴리스 준비 완료를 뜻하지 않는다. 철회된 네 항목은 로컬 개발 중의 결정을 기록하며, 각 릴리스 의무는 별도로 판단한다. 런타임 기준은 PHP 8.4다. 소스 링크는 배포된 의존성의 호환성이나 깨끗한 아카이브 설치를 증명하지 않는다.

| 이전 항목 | 릴리스 판단 | 남은 검증 근거 |
|---|---|---|
| H25.66 | 오래된 버전 갱신 작업은 철회 상태로 유지한다. H27.2에서 PHP 8.4 플랫폼의 Composer로 PHPUnit을 다시 선택한다. 기록된 후보 13.4.3은 현재의 호환성 또는 버전 선택 결과가 아니다. | Composer의 기본 의존성 해결, 유효한 lock, 플랫폼 검사. |
| H25.71 | preserveSymlinks 구현은 철회 상태로 유지한다. 직접 소스 링크는 provider의 의존성 해석을 사용한다. 릴리스는 설치한 아카이브에서도 빌드되어야 하며 H27.3이 검증한다. | 개발 링크 없는 깨끗한 release consumer 설치와 build bin 실행 성공. |
| H25.73 | 과거 행은 철회 상태로 유지하고 릴리스 lock 정합성 의무를 H27.2에 복원한다. 개발 중 이전 릴리스 기록을 유지했어도 다음 릴리스의 manifest와 lock은 유효해야 한다. | 루트와 board 프로젝트의 composer validate --strict. |
| H26.8 | 개발 lock 재작성은 철회 상태로 유지한다. H27.2는 PHP 8.4를 지원하는 실제 의존성 릴리스를 선택하고 Composer로 릴리스 기록을 다시 생성한다. 과거 PHP 8.5 기록에 맞춰 PHP를 상향하지 않는다. | 플랫폼 요구사항을 무시하지 않고 PHP 8.4에서 두 lock의 Composer 플랫폼 검사. |
| H26.9 | 측정은 미완료로 유지한다. PHP 8.4 확장 준비는 유휴 환경 벤치마크 완료가 아니다. | 전체 make bench 출력, 유휴 환경 조건, 갱신된 영어와 한국어 결과. |

다음 패치 후보는 0.0.18에 이은 0.0.19다. H27.3은 선언된 릴리스 target으로 버전, 아카이브, consumer lock을 준비하고 설치를 검증한다. 이 작업들은 tag를 생성하거나 push하지 않는다. 비공개 루트의 자체 패키지 path repository는 Composer가 관리한다. 형제 소스 override는 배포된 의존성이 PHP 8.4를 지원한다는 근거가 아니다.

활성 체크리스트 작업이 완료되면 최종 전체 검증을 한 번 실행하고, 이후 실패는 소유 검사만 실행한다. 릴리스 커밋에는 ci-passed를 포함한 CI 성공 근거가 있어야 한다. PHP 8.5와 다른 트리의 기존 전체 실행 기록은 이 후보를 증명하지 않는다. 릴리스 검사를 통과한 뒤 maintainer만 릴리스 tag를 생성하거나 push한다.

H27.25는 native package manager와 공유 선택 도구 인터페이스를 사용한 독립 CI 환경을 준비한다. 고정된 kit 0.0.61이 선택 설치기를 제공한다. 격리 worktree에서 앱 선언, 범위를 제한한 toolchain 검증, 명시적인 PHP symbol extractor와 소유 검사를 검증한 뒤 병합하고 한 번 push하여 CI 근거를 수집한다. 앱 전용 도구 설치기는 추가하지 않는다.

H27.26은 모든 runtime test가 provider runner를 사용할 때까지 0.0.21 후보를 공개하지 않는다. Python은 지원되는 Kit 인터페이스를 사용하고 자체 unittest harness를 제거했다. `make e2e`는 `scripts/run-e2e.mts`로 실행의 서버를 띄우고 모든 browser 사례를 Kit test runner의 Playwright 실행(K747)으로 돌리며, 이 실행은 사례마다 자체 timeout과 결과를 보고한다. 로컬에서는 `CASES=<pattern>`으로 사례를 선택한다. 개발 중에는 릴리즈 tag를 만들지 않는다. H27.26은 Verification에서 `make release-consumer TAG=v0.0.21`이 빠진 뒤 e42ac3c에서 잘못 [o]로 닫혔다. runner 작업은 끝났고, 릴리스 부분은 H27.29로 옮긴다. kit이 release-consumer와 그 consumer lock을 삭제하고 consumer는 release된 archive를 자기 package manager로 검증하므로, `make release-consumer`는 H27.29의 Verification에서 빠진다. `make release-candidate-assets VERSION=0.0.21`은 76264f9e3baf에서 0.0.21의 archive 다섯 개를 만들었다. kit이 version 검사를 삭제하므로 `make release-versions`는 H27.29의 Verification에서 빠진다.

고정된 0.0.65(H27.27)는 깨끗한 checkout의 bootstrap과 runtime 범위를 제한한 native link에 대한 0.0.63의 수정을 유지하고, H27.26에 필요한 공유 test runner의 Playwright 실행(K747)을 포함하며, rules check가 gates matrix의 모든 runtime에 닿게 한다(K757). 개발 중에는 0.0.21 후보의 릴리즈 tag를 만들지 않는다.

릴리스 0.0.21(H27.46)은 CI 40983016356과 gates 40983016346을 거쳐 b95d425에서 공개되었고, 릴리스 실행은 40983816897이다. `@polyspec/hyper-client`, `@polyspec/hyper-server`, `@polyspec/hyper-build`의 npm tarball, `polyspec/hyper-server`의 zip, `polyspec-hyper-server`의 wheel과 packages.json(kit K871)을 담는다. template 0.0.14를 그 release의 Composer repository에서 읽고 네이티브 확장을 PIE로 build한다(H27.45). 그 앞의 두 실행은 CI에서 실패했다. dfa6f79는 어떤 TOOLS 목록도 http:pie를 이름 붙일 수 없어 PIE shim을 찾지 못했고(H27.45-1, polyspec/kit#22), dc0b6d0는 GNU make가 출력하지 않는 slash로 재귀 make를 찾았다(H27.45-2). Kit 0.0.75의 무결성을 잠갔으며(H27.47-1), H27.47은 K850-K870을 완성하는 Kit release를 기다린다.
