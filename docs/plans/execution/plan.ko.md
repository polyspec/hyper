<!-- doc-id: plan-execution -->
<!-- source-sha256: 4b2160efab785864424343a77f625c39e77f3253c9d54b8197049fa899f1d29c -->
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
| H26.9 | `.github/workflows/bench.yml`이 기록을 낼 때까지 측정은 미완료로 유지한다. PHP 8.4 확장 준비는 그 완료가 아니다. | 한 커밋에서 workflow를 수동으로 두 번 실행한 결과, 그 편차, 갱신된 영어와 한국어 결과. |

다음 패치 후보는 0.0.18에 이은 0.0.19다. H27.3은 선언된 릴리스 target으로 버전, 아카이브, consumer lock을 준비하고 설치를 검증한다. 이 작업들은 tag를 생성하거나 push하지 않는다. 비공개 루트의 자체 패키지 path repository는 Composer가 관리한다. 형제 소스 override는 배포된 의존성이 PHP 8.4를 지원한다는 근거가 아니다.

활성 체크리스트 작업이 완료되면 최종 전체 검증을 한 번 실행하고, 이후 실패는 소유 검사만 실행한다. 릴리스 커밋에는 ci-passed를 포함한 CI 성공 근거가 있어야 한다. PHP 8.5와 다른 트리의 기존 전체 실행 기록은 이 후보를 증명하지 않는다. 릴리스 검사를 통과한 뒤 maintainer만 릴리스 tag를 생성하거나 push한다.

H27.25는 native package manager와 공유 선택 도구 인터페이스를 사용한 독립 CI 환경을 준비한다. 고정된 kit 0.0.61이 선택 설치기를 제공한다. 격리 worktree에서 앱 선언, 범위를 제한한 toolchain 검증, 명시적인 PHP symbol extractor와 소유 검사를 검증한 뒤 병합하고 한 번 push하여 CI 근거를 수집한다. 앱 전용 도구 설치기는 추가하지 않는다.

H27.26은 모든 runtime test가 provider runner를 사용할 때까지 0.0.21 후보를 공개하지 않는다. Python은 지원되는 Kit 인터페이스를 사용하고 자체 unittest harness를 제거했다. `make e2e`는 `scripts/run-e2e.mts`로 실행의 서버를 띄우고 모든 browser 사례를 Kit test runner의 Playwright 실행(K747)으로 돌리며, 이 실행은 사례마다 자체 timeout과 결과를 보고한다. 로컬에서는 `CASES=<pattern>`으로 사례를 선택한다. 개발 중에는 릴리즈 tag를 만들지 않는다. H27.26은 Verification에서 `make release-consumer TAG=v0.0.21`이 빠진 뒤 잘못 [o]로 닫혔다. runner 작업은 끝났고, 릴리스 부분은 H27.29로 옮긴다. kit이 release-consumer와 그 consumer lock을 삭제하고 consumer는 release된 archive를 자기 package manager로 검증하므로, `make release-consumer`는 H27.29의 Verification에서 빠진다. `make release-candidate-assets VERSION=0.0.21`은 0.0.21의 archive 다섯 개를 만들었다. kit이 version 검사를 삭제하므로 `make release-versions`는 H27.29의 Verification에서 빠진다.

고정된 0.0.65(H27.27)는 깨끗한 checkout의 bootstrap과 runtime 범위를 제한한 native link에 대한 0.0.63의 수정을 유지하고, H27.26에 필요한 공유 test runner의 Playwright 실행(K747)을 포함하며, rules check가 gates matrix의 모든 runtime에 닿게 한다(K757). 개발 중에는 0.0.21 후보의 릴리즈 tag를 만들지 않는다.

릴리스 0.0.21(H27.46)은 CI 40983016356과 gates 40983016346을 거쳐 공개되었고, 릴리스 실행은 40983816897이다. `@polyspec/hyper-client`, `@polyspec/hyper-server`, `@polyspec/hyper-build`의 npm tarball, `polyspec/hyper-server`의 zip, `polyspec-hyper-server`의 wheel과 packages.json(kit K871)을 담는다. template 0.0.14를 그 release의 Composer repository에서 읽고 네이티브 확장을 PIE로 build한다(H27.45). 그 앞의 두 실행은 CI에서 실패했다. 첫 실행은 어떤 TOOLS 목록도 http:pie를 이름 붙일 수 없어 PIE shim을 찾지 못했고(H27.45-1, polyspec/kit#22), 둘째 실행은 GNU make가 출력하지 않는 slash로 재귀 make를 찾았다(H27.45-2). Kit 0.0.75의 무결성을 잠갔으며(H27.47-1), H27.47은 K850-K870을 완성하는 Kit release를 기다린다.

## Wave 28 — application의 context와 representation

의존: wave 27의 완료된 row. H28.1은 규칙 HY-116~HY-122, HY-124~HY-128과 HYC-22~HYC-24, 그 규칙이 건드리는 규칙의 변경, contract case를 쓴다. H28.2~H28.7은 각자의 unit test와 함께 이를 구현한다. H28.8은 이를 board example에 넣고 parity를 실행한다. H28.9는 representation의 `HEAD`를 설계하며 찾은 결함으로, 모든 page route에 `HEAD`를 더한다.

application은 configuration과 build가 바뀔 때만 바뀌는 값을 모든 JSON response에 실어 보냈다. shared data(HY-10)가 request마다 만드는 map 하나이기 때문이다. browser는 그 값을 이미 가지고 있었다. context(HY-124~HY-128)는 browser가 hash로 보관하는 shared data의 부분이다. JSON response는 hash가 바뀌었을 때만 context를 담는다. 모든 JSON response가 담는 build id는 deployment 뒤에 browser가 새 document를 load하게 한다(HYC-22). browser는 마지막 region response만 render하고(HYC-23), server가 등록하는 host function을 등록한다(HYC-24).

route는 resource 하나와 그 representation 여럿을 가진다(RFC 9110, section 3.2). 다른 client를 위한 JSON contract는 그 route의 representation이다(HY-118~HY-122). `Accept`로 선택되고(HY-116), page와 같은 router, limit, response 규칙을 거친다. session과 cookie를 읽지 않으므로, session으로 쓰는 요청은 token 검사가 있는 action으로 남는다(HY-24). `application/vnd.hyper+json`(HY-15)은 page data의 media type이므로 `application/json`은 application이 쓸 수 있다. client rendering의 data base path(HY-62)는 남는다. web server가 모든 path에 static shell을 file 하나로 내주고, data request는 그 path 아래에서 application에 닿기 때문이다.

recipe(H28.11)는 세 server를 `contracts/interfaces.json`의 concern으로 나눈다. 각 concern은 규칙, case 파일, unit을 가진다. 모든 HY 규칙은 그것을 구현하는 코드의 concern이 적고, concern은 자기 case 파일이 인용하는 규칙도 모두 적는다. 어떤 server도 구현하지 않는 HYC 규칙은 `outside`에 있다. 다음 결정은 `docs/spec/recipe.md`의 첫 정렬이 열어 둔 것을 정한다.

- HY-62는 그것을 선언하는 concern client-rendering에 속한다. concern media-selection은 HY-116과 HY-119를 가진다. session concern은 HY-45, HY-72, HY-120을 가진다. 앞선 두 나눔은 `contracts/protocol.json`에 없는 규칙(HY-34, HY-96)을 적었다.
- Node server가 HY-54에 따라 browser code에서 가져오는 unit(manifest, region, router, reads, renderer)은 manifest, route, rendering의 규칙과 HY-54를 가진 concern browser-code를 이룬다. 각 unit은 HY-54.3으로 PHP와 Python에만 있다(`only`).
- concern host는 HY-97, HY-99, HY-100을 가진다. delivery는 HY-100.30으로 PHP에만 있다. server는 HY-100.1로 Node와 Python에만 있고, Python pipeline도 그렇다. wsgi는 HY-100.3으로, asgi는 HY-100.15로 Python에만 있다.
- concern native-sessions는 HY-115를 가진다. native session(HY-104.4), Redis Cluster session(HY-115.19), Redis Sentinel session(HY-115.14)은 PHP에만 있다. session record와 file session(HY-104.4), Redis session(HY-115.10)은 Node와 Python에만 있다. flock은 HY-104.6으로 Node에만 있다.
- concern index는 HY-106을 가지며 unit이 없다. HYR-8이 barrel 파일을 public member와 type에 대해 검사하므로 case는 `none`이다.
- 어떤 concern도 `error-code.ts`를 가지지 않는다. error의 `code`를 읽는 일을 정하는 규칙이 없으므로 각 사용처가 자기 코드에서 읽으며, 이 파일은 사용처를 옮기는 concern과 함께 제거된다.
- spec은 unit을 먼저 적고, member는 각 concern을 옮기는 commit에서 적는다. 그래서 마지막 concern을 옮길 때까지 이 branch에서 `make recipe-check`는 실패한다.

H28.15는 각 server의 unit을 concern의 group마다 한 directory에 둔다. 각 server는 한 directory에 파일 약 60개를 가졌고, concern은 `contracts/interfaces.json`에만 있었다. spec은 group 아홉 개와 각 concern의 group을 선언하고, HYR-4의 검사는 자기 group의 directory 밖에 있는 unit 파일을 실패시킨다. Python은 HY-106.18이 말하는 대로 public 이름을 package에서만 import하므로 나중에 group을 바꿔도 public 이름이 바뀌지 않는다. PHP는 같은 이유로 namespace `Polyspec\Hyper`를 유지하고 autoload에 group directory를 나열한다.

## Wave 29 — stream으로 읽는 multipart body

의존: part를 읽는 방법을 정한 H28.11의 폼 값(HY-113.11부터 HY-113.16까지). H29.1이 규칙을 쓰고, H29.2부터 H29.5까지가 각자의 case와 함께 구현하며, H29.6이 문서와 예제를 더한다.

각 server는 요청 body를 한 값으로 읽고 file part마다 내용을 복사하므로 요청 하나가 body의 약 두 배의 메모리를 쓰며, HY-114의 file 제한은 file을 메모리에 두기 때문에 있다. 그래서 큰 upload는 큰 메모리 제한이 필요하고, `contracts/fields.json`의 case는 수백 byte의 입력만 시험한다. 이 wave는 `multipart/form-data` body를 stream으로 읽으며 다음을 정한다.

- 각 server는 자신의 reader를 유지한다. 각 runtime의 parser가 보낸 것을 바꾸거나 버리기 때문이다. PHP의 `$_POST`와 `$_FILES`는 반복된 이름의 마지막 값만 두고, `a.b c`를 `a_b_c`로 쓰고, 대괄호 이름을 중첩하고, filename을 마지막 segment로 자르며, `docs/operations/dependencies.md`는 관리되는 parser들의 같은 종류의 손실을 기록한다. C extension은 쓰지 않는다. `strpos`, `Buffer.indexOf`, `bytes.find`가 이미 native code로 byte를 훑으며, C reader는 네 번째 구현과 메모리 안전성 결함을 더한다.
- 세 언어의 같은 상태 기계가 body를 조각으로 받아 각 part의 시작, 내용, 끝을 알린다. 그 buffer는 body의 크기와 무관하게 boundary의 길이와 header 제한으로 묶인다. PHP의 `main/rfc1867.c`는 그 구조와 제한의 본보기이며 결과의 본보기는 아니다.
- file part의 내용은 요청의 임시 file에 쓰고, server는 요청이 끝나거나 실패하거나 연결이 끊기면 그것을 지운다. `UploadedFile`은 크기를 주고, file을 경로로 옮기며, 내용을 한 값으로도 여전히 준다.
- 모든 제한은 application이 선언할 수 있는 명세의 숫자다: body, file 하나, part의 header, part의 수, text 값의 byte. 제한을 넘거나 닫는 delimiter가 없는 body처럼 형식이 틀린 body는 요청 전체를 실패시킨다. part를 건너뛰지 않는다.
- 세 검사가 증거를 담는다. 모든 case를 모든 위치에서 두 조각으로 나눠 읽어도 body 전체의 결과와 같다. seed로 생성한 body 집합이 세 server에서 같은 결과를 낸다. test가 reader의 buffer 길이를 그 한계와 대조한다.
- 느린 client와 연결 수는 앞단 server(nginx, php-fpm, ASGI server, Node의 `requestTimeout`)의 일이며 운영 문서가 그 설정을 적는다. 이어받기가 필요하거나 수 gigabyte인 upload는 storage로 직접 가며 이 wave의 밖이다.

## Wave 30 — 명령 도구 하나 `hyper`

의존: package 이름(HR-98)과 Rust core의 모든 출력의 build id(HY-125.15~HY-125.20). H30.1이 규칙을 쓰고, H30.2부터 H30.6까지가 각자의 test와 함께 구현하며, H30.7이 모든 호출자를 옮긴다.

build package는 bin 두 개 `hyper-build-assets`와 `hyper-build-server`를 가졌고 호출자는 그것을 이 순서로 실행했다: 앞의 것이 브라우저 출력으로 build id를 계산하고 뒤의 것이 `--build`로 그것을 복사했다. 그래서 서버 출력만 바뀌면 build id가 그대로였고, test는 고정 id를 주어 build 출력을 바꿨으며, `--tailwind`는 stylesheet를 애플리케이션의 고정 경로에 써서 호출자가 build 뒤에 그것을 고쳐 썼다. 이 wave는 package를 명령 도구 하나로 만들며 다음을 정한다.

- bin은 하위 명령 `build`와 `check`를 가진 `hyper`이다. 여러 동사를 가진 명령 도구의 꼴이다. 그 interface는 bin, 인자, 종료 코드이며 문구와 module은 아니다. 설치 없는 `npx hyper`는 무관한 공개 package를 실행하므로 문서는 설치 뒤의 호출을 적는다.
- 입력은 애플리케이션 디렉터리 하나, `app/app.json`, `templates/`, 있을 수도 있는 `client/main.ts`, `public/`이다. 애플리케이션의 에셋은 `client/manifest.json`의 이름으로 build의 입력(`--asset`, `--tailwind`)이 되므로 build 뒤에 바뀌는 출력은 없다.
- 한 번의 실행이 모든 출력을 staging 디렉터리에 쓰고, 그 모두로 build id를 한 번 계산하며, `public/assets`, `client/`, `program/`을 각 `build.json`을 마지막으로 게시한다. build는 `--output`의 `client/`와 `program/`만 소유한다.
- build는 build id를 받지 않는다. 고정 id가 필요한 test는 build가 쓰는 두 조립 module로 프로그램과 셸을 만들며, 그 module은 id를 인자로 받으므로 조립 규칙은 한 번만 있다.
- `hyper check`는 매니페스트와 템플릿 규칙을 검사하고 출력은 읽지 않는다. `make templates-check`가 그것을 부른다.
- 명령 도구가 core를 부를 때까지(H-8) 그것은 browser package와 자기 module의 규칙을 부르고, `program/templates/`는 예약 템플릿을 담으며, Node는 템플릿 색인과 build id를 `client/` 아래에서 읽는다.

## Wave 31 — core의 binding package

의존: Rust core의 interface 계약(`packages/rust/interface.json`)과 lock이 고정하는 binding release. H31.1은 scaffold의 binding crate를 workspace member로 두고 session-store의 지점을 장전한다. H31.2는 binding의 지점 macro로 옮긴다. H31.3은 Python package와 PHP extension에 필요한 binding을 생성한다. H31.4는 명령 도구가 core의 규칙을 부르게 한다(H-8 1단계).

root workspace가 WASM crate를 갖지 않아 binding의 end-to-end 검사가 모든 target을 멈췄고, 생성기는 계약 검사가 finding을 보고하는 동안 소스를 쓰지 않는다. binding crate는 binding scaffold가 쓰는 것이며, lock은 그것을 쓰는 생성기의 binding commit을 고정한다.

core를 부르지 않는 서버와 core는 모두 `contracts/`의 case를 실행하며, 서버는 그 일부에 아직 다르게 답한다. 둘이 다른 곳은 프로토콜이 정하며, 서버는 core를 부를 때(H31.7~H31.9) 정해진 동작을 갖는다.

- token 자리에 다른 값을 가진 session은 요청을 `invalid_session_token`으로 실패시킨다(HY-24.14). 서버는 그 값을 새 token으로 바꾼다.
- session cookie의 field 값은 `<name>=<id>; Path=/; Secure; HttpOnly; SameSite=Lax`다(HY-45.8). Node와 Python 서버는 `path=/; secure`를 쓴다.
- `POST`의 form type은 session을 열기 전에 검사한다(HY-120.2, HY-120.3). 서버는 session을 먼저 연다.
- media type이 아닌 `Content-Type`은 400을 받는다(HY-59.12). 서버는 415로 답한다.
- file limit은 body를 읽는 동안, route와 session과 token 전에 413으로 답한다(HY-114.7, HY-120.2, HY-131.31). 서버는 token 뒤에 file을 다시 검사하고, core의 주석 두 곳이 그 순서를 적었다(H31.19).
- page 응답과 JSON 응답, 그 304는 reply의 `Referrer-Policy`를 가진다(HY-103.5). core가 주는 page의 header에는 그것이 없었다(H31.19).
- 중첩된 container가 256개를 넘는 JSON text는 거부된다(HY-54.20). Python과 PHP 서버는 더 깊은 text를 읽는다.
- 자기 자리의 prefix가 없는 build 출력 경로는 build를 `invalid_build`로 실패시킨다(HY-125.17). command tool의 build id는 core에서 build id를 받을 때까지(H31.4-3) 경로를 검사하지 않는다.

## Wave 32 — 외부 리다이렉트

의존: 없음. H32.1이 HY-133와 HYC-4, HYC-7, HYC-8, HYC-14의 변경을 쓰고, 세 server와 browser code에 그것을 case와 함께 구현하며, board 예제와 browser test에 더한다. H32.2는 region 요청과 대기 중인 server-side rendering의 history 복원의 순서를 정한다. wave 31의 행들은 그 branch가 main 위로 rebase될 때 HY-133를 받는다.

리다이렉트는 자기 애플리케이션의 경로를 지정하므로(HY-46), 애플리케이션은 loader나 action에서 browser를 다른 origin, 예를 들어 사람이 sign in하는 다른 system의 page로 보낼 수 없고, 사람이 누르는 link가 있는 page를 렌더할 수만 있다. 이 wave는 다음 결정으로 외부 리다이렉트를 더한다:

- 규칙은 외부 location의 ASCII 문법 하나를 적고, 모든 server가 자기 코드로 그것을 검사한다. runtime의 URL parser는 ASCII가 아닌 host, `\`, 빈 port에서 서로 다르므로, runtime의 parser를 쓰면 server들이 서로 다른 텍스트를 받는다.
- `origin(text)`는 외부 location의 origin을 준다. 그래서 애플리케이션은 location을 다시 parse하지 않고 그것을 자기가 허용하는 origin과 비교한다.
- `HX-Request: true`가 있는 요청과 문서 요청은 상태 200과 `HX-Redirect`를 받고 body를 받지 않으며, 다른 모든 요청은 `Location`이 있는 303을 받는다. htmx와 browser code는 `fetch`로 요청을 보내고, 거기서 다른 origin으로의 303은 그들이 읽기 전에 network 오류나 CORS로 실패하지만, browser는 자기 문서의 navigation의 303은 따르기 때문이다.
- browser는 문서 요청, location의 render, htmx의 history 복원의 `HX-Redirect`에 대해 page의 location을 바꾼다(replace). 각각의 URL이 현재 history 항목의 URL이고, 그 항목을 남기면 뒤로 가기가 browser를 다시 다른 origin으로 보내기 때문이다. htmx는 region 요청의 URL을 대입한다(assign). htmx는 그 history 항목을 swap에서만 더한다.
- 외부 리다이렉트는 flash 값과 바뀐 topic을 가지지 않고, base path와 data base path를 받지 않으며, `Cache-Control: no-store`와 HY-117.1의 `Vary`를 가진다. 그 응답이 `HX-Request`와 `Accept`에 따라 다르기 때문이다.

## Wave 33 — CI job마다 recipe 하나

의존: 없음. H33.1은 각 CI job의 내용을 Makefile의 recipe `ci-<job>`으로 옮겨 job과 local 실행이 같은 호출을 하게 한다. release job은 `make ci-release`를 실행한다. H33.2는 추적 기록에서 commit hash를 없앤다.

## Wave 34 — WSGI 요청의 끝

의존: 없음. H34.1은 WSGI callable의 body iterable이 write hook과 disconnect hook을 자기 `close()`에서 실행한다고 정한다. PEP 3333은 WSGI server가 모든 응답에 대해 `close()`를 한 번 호출하도록 요구하므로, Node listener의 promise(HY-100.29)와 PHP의 shutdown function(HY-100.30)이 자기 server에서 정하듯이, host는 `close()`가 돌아오면 요청의 두 hook이 모두 실행되었음을 안다.

## Wave 35 — 설치와 검사의 core와 바인딩

Depends on: none. 새 checkout은 core를 부르지 않는 서버만 설치하고 검사한다. `make hyper-install`은 `make bindings`가 소스를 쓰기 전에 바인딩의 Python 패키지를 설치하고(H35.1), 어떤 CI group도 core나 바인딩의 target을 실행하지 않으며(H35.2), Git은 `make bindings`가 쓰는 Python 패키지를 무시하지 않으며(H35.3), `Cargo.lock`의 binding은 session-store의 callback unit과 function result에 대해 Go와 WASM을 생성하지 않으며(H35.4), 다음 binding은 음의 0의 case를 바꾼다(H35.5). core는 사본이 여럿인 kept 값을 첫 릴리스 뒤에 맡는다(H35.6). H35.7은 로컬 provider에 대한 전체 실행이 지목한 결함을 고친다. H35.8은 npm과 Cargo에서 각 provider를 그 release로 받는다.

이 wave의 첫 릴리스의 범위. 첫 릴리스는 다음 행을 가지며, H35.32와 H35.33의 행은 그 뒤에 온다.

- H35.34와 H35.34-1: `hyper build`가 쓰는 `reads.json`의 read path, 그리고 PHP와 Python case runner가 그 파일을 비교하는 일.
- H35.31-2-1: core의 규칙인 파일 limit 검사.
- H35.16-3, H35.16-4, H35.16-5: 새 checkout에서의 확장 설치, checkout의 PHP 검사, 그 PHP가 바뀔 때의 확장 재빌드.
- H35.27-1-1: Node HTTP 테스트에서 `Content-Type` 줄이 둘인 action의 상태.
- H35.9-8: 요청 중 runtime 경고에 대한 Node case.
- H35.35: CI가 실행하지 않는 릴리스 workflow의 각 step의 dry run.
- tag로 하는 pin: template, session-store, orm, json, 그리고 http 저장소 셋은 각각 release의 tag로 받는다(AGENTS.md, 다른 polyspec 저장소에 대한 의존). template은 현재의 conformance case를 자기 JS render engine에 대해 실행하고 그 engine이 Rust core와 다른 점을 없앤 release로 받는다.

첫 릴리스는 template의 그 release를 기다린다. 서버들이 template의 두 engine으로 렌더하기 때문이다. Node 서버와 브라우저는 JS render engine으로, PHP와 Python 서버는 Rust core의 binding으로 렌더한다. 그 release가 없으면 Node 서버와 PHP·Python 서버는 한 template에 대해 다른 결과를 준다.

H35.32 설계의 입력. Node 서버(`packages/ts/src/page/page.ts`, `packages/ts/src/app/app.ts`)와 browser 코드(`packages/client`)는 template의 JS render engine(`@polyspec/template/render`)으로 렌더하고, 서버는 `@polyspec/hyper-client`의 `createApplication`과 `renderDocument`를 거친다. PHP 서버(`packages/php/src/Page/Renderer.php`)와 Python 서버(`packages/python/src/polyspec/hyper/page/_renderer.py`)는 template Rust core의 binding으로 렌더한다. hyper core의 page 렌더(`packages/rust/src/render.rs`의 `render_document`, `packages/rust/src/steps.rs`의 `Pages`와 `PageRequest`, `packages/rust/src/read_paths.rs`의 `route_reads`와 `template_reads`. binding member는 `Pages`, `PageRequest.next`, `routeReads`, `templateReads`)는 어떤 서버도 부르지 않는다. 두 engine은 template 명세가 거부하는 입력에서 다르다. 분수 숫자 인덱스를 JS engine은 렌더하고 core는 `runtime_type`으로 실패시킨다. Node 서버를 core의 page 렌더로 옮기는 일은 한 행이 아니며 첫 릴리스에 들지 않는다. core에 다섯 부분이 없고, 이 이전이 `App.open`의 입력, page 응답, statement 아홉 개를 바꾸기 때문이다. H35.32-2의 설계 문서가 먼저이며, 그 문서는 아래 네 목록을 입력으로 받는다.

차이 목록은 세 서버가 page에 대해 하는 일을 `PageRequest.next`와 `render_document`가 하는 일과 비교한다.

- 그대로 덮는 것: route 영역을 가진 문서의 구성(HY-12, HY-13), kept 값을 가진 문서를 다시 렌더하는 순서와 버려진 kept 값을 내장 데이터에서 빼는 일(HY-38.16, HY-38.17), 내장 데이터의 script(HY-31), build의 meta 요소(HY-125), shared 데이터와 context key의 거부(HY-124.8), 영역 선택(HY-19), route 데이터 위에 합쳐지는 action 데이터(HY-26.2, HY-58.3), read path의 적용(HY-73.29), kept 값의 선택, JSON 값과 그 텍스트(HY-17, HY-54), member `context`(HY-128.2), reply의 상태(HY-69), 바뀐 revision에 대한 상태 409(HY-107).
- 다르게 덮는 것:
  - core는 렌더가 처음 닿을 때 template을 parse하고, 서버들은 애플리케이션이 열릴 때 template을 parse하거나 decode한다.
  - core는 read path를 값으로 받거나(`Pages`) source에서 계산하고(`routeReads`), Node 서버는 browser package로 AST 파일에서 계산한다.
  - `now`는 host가 `PageInput`으로 주는 요청당 한 값이고, PHP와 Python renderer는 렌더마다 시계를 읽는다.
  - host function의 둘째 인자는 binding에서 `{timezone, now}`이고 JS engine에서 `{env: {…}}`이다.
  - 실패한 등록의 오류는 template 언어의 이유 뒤에 텍스트 ` (HYC-24)`를 가진다.
  - 문서에 kept 값이 있는데 template이 없으면 core는 kept 값 없는 렌더를 실행하고(HY-38.16), browser 코드는 오류를 다시 던진다.
  - 자기 영역 하나의 데이터가 없는 문서는 kind `internal`로 실패한다.
  - 분수 숫자 인덱스는 `runtime_type`으로 실패한다.
- core에 없는 것:
  - action이 session을 갱신한 뒤의 token(HY-72.3). `PageInput.csrf`는 `PageRequest`를 만들 때 고정되고 action은 step 안에서 실행된다(H35.32-3).
  - read path가 버리는 값과 native object에 대한, read path를 적용하기 전의 HY-44.3 검사(H35.32-4).
  - PHP `JsonSerializable`의 값(HY-44.6). binding은 그것을 native object로 두고, `packages/php/src/Data/DataModel.php`가 렌더 전에 바꾼다.
  - `contracts/functions.json`의 메시지 `functions.<name> is not a function`(H35.32-5).
  - binding member인, 요청 전체보다 작은 렌더(H35.32-6).
- host가 step이나 입력으로 주는 것: 모든 handler 호출(action, context handler, shared handler, loader), reply의 값(데이터를 내장하는지와 그 상태), `now`, mask된 token, cookie `hy-keep`의 텍스트, `Hyper-Context`의 held hash, 바뀐 topic, 저장된 kept 값, map인 loader 결과.
- host에 남는 것: 파일 읽기, handler 검사, 닫힌 연결에 대한 step 사이의 중단(HY-67), 경고의 guard(HY-74), 결과와 ORM code를 action outcome으로 옮기는 일, 응답 header와 304, cookie, limit, logging, client rendering 선택, representation.

의미가 바뀌어 id를 폐기하는 statement(AGENTS.md, statement는 의미가 유지되는 동안만 id를 유지한다): HY-54.3, HYC-24.2(Node 서버의 절), HY-132.8, HY-48.11, HY-48.12, HYC-12.6(둘째 절), HYC-12.9, HY-128.4, HY-73.23. 의미가 유지되는지 판단이 필요한 statement: HY-132.7, HY-48.1, HY-13.4, HY-14.1.

설계가 답하는 질문:

1. action이 session을 갱신한 뒤 page는 새 token을 어떻게 받는가(HY-72.3)?
2. 렌더가 read path가 남긴 값만 bind하는 문서에 대해 HY-44.3은 어디서 강제되는가?
3. Node 서버의 `App.open`은 PHP와 Python 서버처럼 `program/templates`와 `reads.json`을 받는가?
4. Node 서버에서 host function은 어떤 둘째 인자를 받는가?
5. Node 서버는 `PageRequest`와 함께 `openPage`, `routeRequest`, `computePageHeaders`를 채택하는가? `openPage`는 session-store의 `Store`를 받는다.
6. Node 서버의 part, read path, `withContext` 테스트 step은 무엇을 부르는가?
7. 요청당 하나의 `now`는 모든 서버의 규칙인가?
8. 서버가 Rust engine으로, 브라우저가 JS engine으로 렌더하는 동안 어떤 근거가 HY-13.4를 지탱하는가?

JS engine이나 browser 코드의 `Application`에 의존하는 Node 테스트: `packages/ts/tests/steps/app.ts`의 part와 open, `packages/ts/tests/steps/reads.ts`와 `packages/ts/tests/steps/reads-cases.ts`, `packages/ts/tests/parse-template.ts`, `packages/ts/tests/steps/context-place.ts`, `packages/ts/tests/steps/functions.ts`, `packages/ts/tests/support.ts`의 option `templates`.

H35.11의 입력. H35.11은 H31.11의 산출물을 가지므로, 한 row가 세 서버의 form 읽기와 cookie 읽기를 core로 옮긴다. core는 form을 읽지 않는다. `packages/rust/src/front.rs`의 `front::media_type`은 `polyspec_http_media_type::parse`를 부르고 core의 variant `Error::MalformedContentType`(상태 400)을 내며, `front::file_over`는 서버가 주는 크기를 비교한다. core는 http-cookie의 `set_cookie`로 `Set-Cookie`를 쓰고(`packages/rust/src/cookies.rs`, `packages/rust/src/reply.rs`) `Cookie` field는 읽지 않는다. `cookies::find`는 host가 주는 쌍을 받고, 각 서버는 `packages/ts/src/http/cookies.ts` 같은 자기 코드로 그 field를 읽는다. 그래서 http-cookie의 `parse`로 읽는 HY-129.13의 cookie 읽기는 되어 있지 않으며 H35.11의 일부다.

form 읽기의 객체. http-form 열은 http-form 저장소의 `packages/rust/interface.json`의 unit과 그 줄 번호를, hyper 열은 `contracts/interfaces.json`의 concern `form-values`와 unit `request`를 가리킨다.

| 객체 | 가진 쪽 | hyper의 클래스와 member | http-form의 unit과 member | 차이 | 결론 |
|---|---|---|---|---|---|
| `UploadedFile` | 애플리케이션. `Request.file(name)`과 `Request.files()`가 돌려주고(HY-113.2), constructor가 공개이므로 애플리케이션이나 테스트가 byte로 파일을 만든다. `packages/ts/src/index.ts`와 `polyspec/hyper/__init__.py`가 export하며 PHP 클래스는 `Polyspec\Hyper\UploadedFile`이다 | constructor `(name, filename, contentType, content)`; 바로 돌아오는 method `name()`, `filename()`, `contentType()`(Python은 `content_type()`), `size()`, `content()`, `moveTo(path)`(Python은 `move_to`)(HY-113.8, HY-131.28); internal `stored`와 private `createdFile`, `linkedFile` | `uploaded_file`(1196행부터 1410행): constructor `new(name, filename, content_type, content)`(1208); property `name`(1254), `filename`(1269), `content_type`(1284), `size`(1300); method `content`(1315, WASM은 1345)와 `move_to(path)`(1369), 둘 다 wait `blocking_io` | 네 부분이 http-form에서는 property이고 hyper에서는 method다(HY-113.8). 클래스의 이름과 패키지가 다르다(`Polyspec\HttpForm`, `@polyspec/http-form`, `polyspec.http_form`). 실패가 `HttpFormValueError`와 `HttpFormIoError`인데, HY-132.2와 HY-132.3은 라이브러리의 실패를 그 category의 hyper 클래스로 준다. 인자 오류가 HY-106.8과 HY-106.16의 것이 아니다. `content`와 `move_to`는 blocking I/O를 기다린다 | core의 값 위에 둔 hyper의 타입: 각 서버의 클래스는 이름과 member를 유지하고, hyper 바인딩의 member로 core의 파일을 읽는다. http-form의 언어 패키지는 의존성이 아니다 |
| `Request`의 `form()`, `formString()`, `files()`, `file()`, `fileOver()` | 애플리케이션. hyper의 `Request`의 member다 | `request.form`, `request.formString`, `request.files`, `request.file`, `request.fileOver`; 값은 이름과 그 값들의 쌍 목록이다(HY-56.7) | `fields`와 `files`를 가진 record `form`(842부터 887), 그리고 `forms`의 함수(469부터 840): `parse_urlencoded`, `read_body`, `read_held_body`, `fields_from_body`, `files_from_body`, `file_over` | 둘 다 쌍 목록을 준다. hyper는 이름의 마지막 값과 마지막 파일을 더한다 | core의 값 위에 둔 hyper의 member. 목록은 plain 값이고 http-form의 객체는 애플리케이션에 닿지 않는다 |
| `RequestBody` | 서버. 세 서버에서 internal unit이고 host가 먹인다(`pipeline.readBody`, `asgi.readBody`, `http-host.readBody`) | `Content-Length`를 받지 않는 constructor `(type, limit, stream, valueLimit, partLimit, fileLimit)`; 읽기가 계속되는지를 돌려주는 `feed`, `exceeded`, `size`, `held`, `streamed`, `parts`, `directory`, `remove`, `written` | `request_body`(934부터 1194): static `start(content_type, content_length, stream, limits)`(957), `feed`(1018), `finish`(1053), `parts`(1079), `held`(1108), `size`(1124), `streamed`(1140), `directory`(1156), `remove`(1175); constructor가 없다(`constructible: false`) | constructor 대신 static start; 실패는 `exceeded()`와 null 결과 대신 kind와 상태를 가진 오류; `finish()`가 body를 끝낸다 | 서버 안에 남는다: core의 body 위에 둔 hyper 바인딩의 member이고 host가 먹인다 |
| 한도 | 애플리케이션이 option으로 네 수를 선언하고(`appOptions`의 `bodyLimit`, `valueLimit`, `partLimit`, `fileLimit`) 서버가 가진다 | option의 수, HY-59.1, HY-114.3, HY-131.8, HY-131.10의 기본값과 open 검사 | `limit`, `value_limit`, `part_limit`, `file_limit`를 가진 record `body_limits`(889부터 932) | 형태의 차이 없음 | 서버 안에 남는다: core가 option에서 record를 만든다 |
| `Fields`, `Files`, `Multipart`, `MultipartReader`, `NamedValues` | 서버. internal unit이다 | 각 서버가 가진 reader | crate의 reader(F-20부터 F-24), contract의 unit이 아니다 | 비교하지 않음 | core가 form을 읽을 때 제거한다 |
| 실패 | 애플리케이션은 `moveTo`와 `content`의 실패를 받고, 서버는 body의 실패에 400이나 413으로 답한다 | kind 없는 `InvalidArgumentException`, `ValueError`, `RangeError`, `TypeError`, 메시지는 `(HY-131)`로 끝난다 | `errors.kinds`의 kind(110부터 191), 그리고 property `removal_kind`와 `removal_errno`를 가진 error unit `partial_target_error`(414부터 466) | HY-131.28은 kind `exists`와 `moved`를 정하는데 서버는 kind를 내지 않는다. http-form의 메시지는 `(F-11)`로 끝난다 | kind의 category의 hyper 오류(HY-132.3). http-cookie의 행처럼 `packages/rust/interface.json`의 `errors.kinds`에 라이브러리를 적은 행으로 넘긴다. `errors.wrapped`는 `partial_target_error`의 두 property 각각에 행 하나를 얻고, session-store의 `record_error` 행처럼 hyper의 error unit으로 넘긴다(binding CK-11) |

그래서 hyper는 http-form을 http-cookie의 형태대로 core의 Cargo 의존성으로 받고, http-form의 npm 패키지, wheel, PHP extension은 필요하지 않다. row를 시작할 때 한 가지를 확인한다. binding의 generator 규칙 GN-3e는 `errors.kinds`의 행이 오류를 넘기는 라이브러리마다 Python 패키지의 manifest가 그 패키지를 적는다고 하는데, contract가 그렇게 오류를 넘기는 http-cookie의 패키지를 `packages/python/pyproject.toml`은 적지 않는다.

답이 바뀌는 case. HY-113.23, HY-113.24, HY-113.25, HY-131.30은 http-form의 `contracts/fields.json`의 case가 적는 답을 정하고, 세 case runner가 읽는 `tests/legacy/fields.json`은 그중 열하나에 다른 답을 적는다. case 셋은 읽기에 대해 hyper가 고정 사본의 답을 유지한다(HY-57.15, HY-113.24). recipe에는 명세되었으나 아직 어떤 runner도 통과하지 못하는 case의 형태가 없다(HYR-6은 차이를 요구하는 statement로만 case를 언어에 한정한다). 그래서 이 case들은 `contracts/`에 추가하지 않는다. 명세된 답을 적은 case는 core가 form을 읽을 때까지 세 runner에서 실패하기 때문이다. H35.11이 코드와 함께 추가한다. runner는 http-form의 case를 그 release asset에서 읽고, `contracts/request.json`은 section `values`에 `invalid`로 실패하는 여덟 입력 각각에 대해 case `a_multipart_value_that_is_not_utf8_is_invalid_input`의 형태로 `valid: false`(HY-42.3)인 case 하나를 얻는다.

group `multipart`의 여덟 case와 읽기의 답이 그대로인 case 셋. 행이 달리 적지 않으면 content type은 `multipart/form-data; boundary=XyZ`이고 body는 `--XyZ`와 `--XyZ--` 사이에 내용 `1`을 가진 part 하나다. 행은 그 part의 header 줄을 적는다.

| http-form의 case(고정 사본의 이름이 다르면 그 이름) | 입력 | 고정 사본의 답 | 명세된 답 | Statement |
|---|---|---|---|---|
| `a_multipart_type_without_a_boundary_fails`(`a_multipart_type_without_a_boundary_has_no_values`) | content type `multipart/form-data` | 폼 값도 파일도 없음 | 읽기에는 고정 사본의 답이 그대로다. reader는 시작하지 않고, hyper는 `no_boundary`를 적는 http-form의 함수를 부르지 않는다. route 뒤에, `multipart/form-data`가 form 타입인 곳에서 action으로의 `POST`는 400을 받고, 알 수 없는 경로로의 요청은 404를 받는다 | HY-113.24 |
| `a_quoted_boundary_of_no_character_is_no_boundary` | content type `multipart/form-data; boundary=""`, delimiter는 `--""`와 `--""--` | 폼 값도 파일도 없음 | 위 행과 같다. 읽기의 실패가 아니고, action으로의 `POST`는 route 뒤에 400, 알 수 없는 경로는 404다 | HY-113.24 |
| `a_disposition_of_another_type_fails_the_body`(`a_disposition_of_another_type_is_neither_a_value_nor_a_file`) | `Content-Disposition: attachment; name="a"` | 폼 값도 파일도 없음 | `invalid`, 400 | HY-113.23 |
| `a_disposition_that_only_starts_with_form_data_is_another_disposition` | `Content-Disposition: form-dataX; name="a"` | 폼 값도 파일도 없음 | `invalid`, 400 | HY-113.23 |
| `a_part_without_a_name_fails_the_body`(`a_part_without_a_name_is_neither_a_value_nor_a_file`) | `Content-Disposition: form-data; filename="x.txt"`, 내용 `X` | 폼 값도 파일도 없음 | `invalid`, 400 | HY-113.23 |
| `a_part_without_header_lines_fails_the_body`(`a_part_without_header_lines_is_neither_a_value_nor_a_file`) | header 줄이 없고 내용이 `alone`인 첫 part, 그다음 내용 `1`의 part `Content-Disposition: form-data; name="a"` | 폼 값 `a` = `1` | `invalid`, 400 | HY-113.23 |
| `a_lone_carriage_return_does_not_end_a_header_line` | `X-Note: a`, line feed 없는 carriage return, 그다음 `Content-Disposition: form-data; name="b"` | 폼 값도 파일도 없음 | `invalid`, 400 | HY-113.23 |
| `a_no_break_space_before_a_parameter_separates_nothing` | `Content-Disposition: form-data;`, byte C2 A0, 그다음 `name="a"` | 폼 값도 파일도 없음 | `invalid`, 400 | HY-113.23 |
| `a_name_given_twice_fails_the_body`(`the_first_parameter_of_a_name_counts`) | `Content-Disposition: form-data; name="a"; name="b"; filename*=x` | 폼 값 `a` = `1` | `invalid`, 400 | HY-113.23 |
| `a_quoted_string_without_its_end_fails_the_body`(`a_quoted_string_without_its_end_is_the_rest_of_the_text`) | 닫는 따옴표가 없는 `Content-Disposition: form-data; name="a; x` | 폼 값 `a; x` = `1` | `invalid`, 400 | HY-113.23 |
| `an_urlencoded_type_followed_by_a_line_feed_is_no_media_type`(`an_urlencoded_type_followed_by_a_line_feed_is_another_type`) | line feed가 뒤따르는 content type `application/x-www-form-urlencoded`, body `a=1` | 폼 값도 파일도 없음 | 읽기에는 고정 사본의 답이 그대로다. body는 byte로 보유되어 폼 값도 파일도 없고, hyper는 이 입력에 `malformed_content_type`을 적는 http-form의 reader를 부르지 않는다. 이 type으로 action에 보내는 `POST`는 route 뒤에 HY-59.12의 400을 받고, 알 수 없는 경로로의 요청은 404를 받는다 | HY-57.15, HY-59.12 |

group `streamed`의 세 case. body는 5 byte 조각으로 읽는 part 셋이다. 내용 `1`의 `name="a"`, 내용 `x`의 `name="n"`, 내용 `z`의 `name="f"; filename="y"`. 고정 사본에서 둘째 part는 `Content-Disposition: attachment; name="n"`인데 HY-113.23이 이를 실패시키므로, http-form은 그 part를 `form-data`로 적은 case를 가지며 body는 186 byte가 아니라 185 byte다.

| Case | 제한 | 고정 사본의 답 | 명세된 답 | Statement |
|---|---|---|---|---|
| `a_body_of_exactly_the_part_limit_is_read` | part 제한 3, 조각 단위로 읽음 | 폼 값 `a` = `1`, 파일 `f`, 디렉터리에 파일 하나 | 폼 값 `a` = `1`과 `n` = `x`, 파일 `f`, 디렉터리에 파일 하나 | HY-131.9, HY-113.23 |
| `a_third_part_more_than_the_part_limit_stops_the_reading_and_leaves_no_file` | part 제한 2, 조각 단위로 읽음 | 읽기가 멈추고 제한을 넘었으며 kind는 없음 | `part_limit`, 413. 읽기는 셋째 part의 delimiter 뒤 line feed에서, 그 파일 전에 멈추고 디렉터리에는 파일이 없다 | HY-131.30, HY-131.26 |
| `a_multipart_body_that_is_one_value_has_the_value_limit_and_no_part_limit` | 한 값으로 보유, value 제한 185(고정 사본은 186), part 제한 1, file 제한 1 | 폼 값 `a` = `1`, 파일 `f` | 폼 값 `a` = `1`과 `n` = `x`, 파일 `f`. 정확히 value 제한만큼인 body는 읽힌다 | HY-131.27, HY-113.23 |

두 파일의 다른 차이. 상태는 바꾸지 않는다. 파일을 옮기는 `streamed`의 다섯 case는 http-form에서 메시지 `the file was moved (F-11)`, `the path exists (F-11)`, `a path is not a string (F-11)`을 적고 고정 사본에서는 같은 텍스트를 `(HY-131)`로 적는다. hyper의 어떤 규칙도 이 실패의 메시지를 정하지 않으므로(HY-132.4), statement가 그것을 정할지는 H35.11이 결정한다. 이름이나 값이 UTF-8이 아닌 `urlencoded`의 세 case는 http-form에서 상태 400의 `invalid`를, 고정 사본에서 null 결과를 적으며 둘 다 HY-42.3의 400이다. http-form은 또 `multipart`의 `a_malformed_content_type_fails`, `fields.json`의 group `uploaded_file.move_to`, `uploaded_file.content`, `uploaded_file.move_to.stored`, `uploaded_file.content.stored`, `request_body.remove`, 그리고 `forms.json`을 가지며 고정 사본에는 이것들이 없다.

body와 route의 순서. body의 byte는 모든 요청에서 route가 정해지기 전에 제한 아래에서 읽는다. 제한의 413과 실패하는 body의 400은 route 전에 답한다(HY-59.15, HY-131.31, HY-113.25). 세 host와 `packages/rust/src/pipeline.rs`의 `ORDER`가 그렇게 하며, 그 step `DeclaredLength`와 `Body`는 `Route` 앞에 온다. `Content-Type`은 route 뒤에 판정한다. action과 `/_hyper/keep`은 HY-59.12로(step `MediaType`과 `FormType`), representation은 HY-121.11로 판정한다. route 전에 body를 form으로 읽는 것은 `application/x-www-form-urlencoded`나 `multipart/form-data`로 읽히는 type뿐이고, 조각 단위 body에 대한 http-form의 reader는 지금 `packages/ts/src/form/multipart.ts`의 `Multipart.boundary`가 정하듯 boundary를 가진 `multipart/form-data`에만 시작한다. 다른 type의 body와 media type이 아닌 `Content-Type`의 body는 byte로 보유한다. 그래서 media type이 아닌 `Content-Type`은 읽기를 실패시키지 않고, 알 수 없는 경로로의 요청은 `Content-Type`이 무엇이든 404를 받으며(HY-57.15), `malformed_content_type`은 HY-132.3의 표에서 HY-59.12와 HY-59.13의 hyper의 kind로 남는다. hyper는 그런 `Content-Type`을 그 kind로 실패하는 http-form의 함수에 주지 않는다.

boundary가 없거나 빈 `multipart/form-data` type도 같은 방식으로 판정한다(HY-113.24). boundary는 `Content-Type`의 매개변수이므로 reader는 시작하지 않고, body는 byte로 보유되며, type은 route 뒤에 판정한다. 이것은 media type이므로 지금의 HY-59.12는 `multipart/form-data`가 form 타입이 아닌 곳에서 415를 주고, form 타입인 곳에서는 거절하지 않는다. HY-113.24는 둘째 경우에 HY-59.12의 자리에서, 그 415 뒤에 400을 더하며, kind는 HY-132.3의 표가 HY-113.24에 주는 hyper의 `malformed_content_type`이다. 어떤 statement도 http-form의 kind `no_boundary`를 주지 않는다. 이는 서버의 답을 바꾸며, 이 점에 대한 H35.11의 Red다. `packages/ts/src/app/app.ts`의 `refusedMedia`(789행부터 794행)와 PHP, Python의 같은 것은 `multipart/form-data`가 form 타입인 곳에서 그런 type을 거절하지 않으므로, action으로의 `POST`는 token 검사로 넘어가 403을 받는다. token이 폼 값 `_csrf`이고(809행) body가 폼 값을 주지 않기 때문이다. 명세된 답은 400이다. case는 form 타입에 `multipart/form-data`가 있는 application의 action으로 `Content-Type: multipart/form-data`와 `Content-Type: multipart/form-data; boundary=""`를 보내는 `POST`이며, `contracts/app.json`에서 텍스트 `Bad Request`의 400을 기대한다. 세 runner에서 실패하므로 지금은 추가하지 않는다.

body를 route 뒤에만 읽는 것은 두 조건에서 다시 검토한다. CSRF token이 header로 옮겨져 body를 읽기 전에 판정되는 경우, 또는 core의 구조가 reader의 호출을 route 뒤에만 허용하는 경우다. 지금 하지 않는 이유는 셋이다. token이 폼 값이므로 action으로의 요청의 body는 어느 순서에서든 token을 판정하기 전에 읽히고, 그래서 유효한 token이 없는 요청이 서버에 읽게 하는 byte는 줄지 않는다. `around`와 hook은 route 전에 폼 값을 읽은 요청을 받는다. body를 읽지 않고 답하는 host는 답을 보내기 전에 연결의 읽지 않은 byte를 버려야 한다.

H35.36의 입력. 아래 case는 아직 어떤 runner도 내지 않는 명세된 답을 적으므로, 위 H35.11의 case처럼 `contracts/`에 추가하지 않는다. 각각은 그 row의 Red이며, row의 host 코드와 함께 case `a_content_length_over_the_body_limit_is_refused_without_a_body`의 형태로 `contracts/app.json`에 들어간다.

H35.36-2, 수가 아닌 `Content-Length`(HY-131.29). case `a_content_length_that_is_no_number_is_refused`: application `a_board`, header `Content-Type: application/x-www-form-urlencoded`와 `Content-Length: abc`, body `name=a`를 가진 `/add`로의 `POST`. 기대하는 상태는 400이고 `actions`는 0이다. 지금 세 서버는 그런 값의 선언된 크기를 0으로 읽고 token 검사로 넘어간다. WSGI host의 Red는 host 테스트다. `CONTENT_LENGTH`가 `abc`이고 `wsgi.input`에 body가 있는 environ은 400을 기대하는데, host는 body를 읽지 않고 body 없는 요청으로 답한다(`packages/python/src/polyspec/hyper/host/_pipeline.py`의 `declared_length`, 173행부터 175행, 그리고 `wsgi.py`의 166행부터 168행).

H35.36-5, byte가 먼저 오는 실패(HY-131.26, HY-59.15). 세 서버의 `RequestBody.feed`는 제한을 넘지 않고 multipart reader를 실패시키는 조각에 true를 돌려준다(`packages/ts/src/form/request-body.ts` 42행, `_request_body.py` 57행, PHP의 `RequestBody::feed`). 그래서 host는 계속 먹이고, byte의 수가 body 제한을 넘으며, `App`의 `dispatch`는 byte의 실패를 보기 전에 413으로 답한다. 명세된 답은 400이다. case는 form case의 section `streamed`의 것으로 `a_body_that_passes_the_limit_stops_the_reading_and_leaves_no_file`의 형태다. `an_invalid_byte_before_the_body_limit_fails_the_body_also_when_later_bytes_pass_the_limit`: type `multipart/form-data; boundary=XyZ`, body는 `--XyZ!`와 그 뒤의 `a` 200 byte, `chunk` 7, `limit` 150, 다른 제한은 100000, `stream` true. `exceeded` false, `fields`와 `files` null, `removed` true를 기대한다. 지금은 `exceeded`가 true다. 세 runner에서 실패하므로 `tests/legacy/fields.json`에 추가하지 않는다. 같은 입력의 host 테스트는 그 body를 `Content-Length` 없이 `Transfer-Encoding: chunked`로 각 서버에 보내며, `tests/scripts/upload-servers.test.mts`의 chunked body 테스트 옆에 두고, 텍스트 `Bad Request`의 400을 기대한다. 지금 각 서버는 413으로 답한다. `contracts/app.json`의 case로는 이를 적을 수 없다. runner는 body를 한 값으로 주고, 그런 body에는 body 제한이 먼저 오기 때문이다(http-form의 F-25.6).
