<!-- doc-id: agents -->
<!-- source-sha256: 045d96c25fc7b82b298d02493ba5441a10fa89e400fad77cb549e56a2db515f6 -->
# 개발

[English](AGENTS.md).

모든 polyspec 저장소의 작업 원칙과, 모든 저장소가 따르는 작업 규칙은 [PRINCIPLES.ko.md](PRINCIPLES.ko.md)에 있다. 이 파일은 이 저장소의 규칙만 적는다.

## 문서

- Own: 기록은 이 저장소만 설명한다. changelog 항목, task, wave 배경, 주석과 commit message는 결함을 이 저장소에 대한 사실로 적는다: 입력, 동작과 기대 동작. 다른 제품, 이 저장소의 사용자, 보고자, 결정의 출처는 적지 않으며, 그런 사실이 없는 문장은 지운다. 식별자는 이 저장소에서의 역할에 따라 이름 짓는다.
  Enforced by: none, 문장이 결정의 출처를 적는지는 어떤 도구도 판단하지 않는 판단이다.
- Own: 주제마다 권위 있는 문서는 하나다. 프로토콜 계약은 `docs/spec/`에 있다. 구현과 검증 상태는 `docs/features.md`에 있다. 계획된 task, 그 검증 명령과 완료는 `docs/plans/execution/checklist.md`에 있다. 현재 절차는 `docs/operations/`에 있다. 실제 변경과 그 검증 결과는 `CHANGELOG.md`에 있다.
  Enforced by: none, 어느 문서가 주제를 맡는지는 판단이다.
- Refines P4: 문서는 현재 동작을 설명한다. 방향이 바뀌면 명세(`docs/spec/`)를 먼저 바꾸고, 구현되지 않은 부분을 표시한다.
  Enforced by: none, 문서가 현재 동작을 설명하는지는 판단이다.
- Own: 동작 변경, 그 문서, `docs/features.md`의 기능 상태 행과 `CHANGELOG.md`의 항목은 한 변경이다.
  Enforced by: none, 네 가지가 한 변경에 있는지는 어떤 도구도 보지 않는다.
- Own: `make docs-check`는 `config/documents.json`이 선언한 대로 문서 쌍, 표지 `doc-id`(두 파일에서 같음)와 `source-sha256`(한국어 파일에서는 영어 파일의 sha256), 링크와 같은 코드 블록을 검증한다. 내용의 정확성은 코드와 test를 읽어 검증한다.
  Enforced by: `make docs-check`

## 구현

- Own: 임시 script나 임시 폴더를 쓰지 않는다. 모든 검사는 Makefile target, `scripts/` 아래의 script 또는 커밋된 test이며, 멱등하다.
  Enforced by: none, script가 임시인지는 판단이다.
- Own: 릴리즈 결과는 tree, manifest와 그 lock이 고정한 template release, 그리고 template 저장소 tag `TEMPLATE_TAG`(`v0.0.12`)의 commit에만 의존한다. 또한 `config/release-assets.json`이 sha256으로 고정하고 `make hyper-install`이 가져와 `make ext`가 build하는, 그 tag의 php-ext release archive에도 의존한다. 저장소 밖의 모든 입력은 추적 파일에 이름이 적히고 쓰기 전에 확인한다. package는 정확한 version과 lock의 integrity 또는 shasum으로, template 저장소는 tag로(Makefile의 `TEMPLATE_TAG`, `config/release-assets.json`의 항목 `template-php`의 version, HR-80), build 출력은 입력의 hash로 확인한다. 의존성은 `package.json`이나 `composer.json`에 선언하고 npm이나 Composer가 lock대로 설치한다(HR-70). Version 0.1 전까지 다른 polyspec 저장소에 대한 의존성은 그 저장소의 GitHub tag나 GitHub Release의 asset이며, branch나 commit이 아니다. 추적 파일은 Git commit을, 이 저장소의 것이든 다른 저장소의 것이든, 이름으로 적지 않는다. 최종 검증은 무시되는 `var/report/` 아래에 tree와 결과를 기록하고 release archive의 선언된 integrity 고정은 유지한다. 어떤 검사도 다른 checkout의 working tree를 그때 있는 그대로 읽지 않는다.
  Enforced by: `make toolchain-check`
- Own: polyspec 버전이 0.0.x인 동안 개발 checkout은 설치된 polyspec package를 kit의 `docs/operations/local-links.md`가 설명하는 대로 그 source에 연결한다. 연결은 commit하지 않는다.
  Enforced by: none, 연결이 commit에서 빠지는지는 review로 판단한다.
- Own: Composer 소스 개발은 root와 board의 추적된 `composer.local.json` manifest를 선택한다. Composer가 무시되는 각 `composer.local.lock`, 소스 link, 설치 기록과 autoload를 관리한다. `COMPOSER`는 기본 manifest 선택자로 유지하고 `COMPOSER_BIN`은 실행 파일을 가리킨다. `make composer-development`는 설치 lock 아래에서 이 graph를 해석하며 `make composer-development-check`는 lock과 PHP 요구를 검증한다. 릴리즈 manifest와 lock은 분리해 유지한다.
  Enforced by: `make hyper-test-scripts`
- Own: release가 결과를 바꾸는 모든 도구는 추적 파일에 고정하고 쓰기 전에 확인한다(HR-81): `.php-version`, `packageManager`, `mise.toml`과 `mise.lock`, 그리고 `config/toolchain.json`. 도구는 결과가 요구하는 만큼 정확히 고정한다. PHP는 minor로, mise의 도구는 정확한 release로, make는 고정하지 않는다. 도구는 기계가 아니라 checkout(`var/tools`)에 설치하며, 다운로드는 고정된 digest가 있을 때만 쓰고, 처음 쓸 때 다른 도구가 도구를 설치하지 않는다. recipe나 script는 checkout의 도구를 절대 경로로 시작한다. make는 shell 문법이 없는 recipe 줄을 자기 `PATH`에서 찾기 때문이다.
  Enforced by: `make toolchain-check`, `make kit-check`
- Own: PHP 개발, test와 release 검증은 PHP 8.4.27을 기준으로 한다. Windows는 8.4.27-1 package rebuild를 쓰며 runtime version은 8.4.27이다. `.php-version`은 native tool 탐색을 위해 8.4 minor를 선택한다. 검증 결과에는 실제 runtime version을 기록하며 이전 patch의 결과를 이 기준에서의 검증으로 취급하지 않는다.
  Enforced by: none, 검증 근거를 검토할 때 기준과 기록된 runtime을 확인한다.

- Own: 어떤 결과도 live service나 시간에 의존하지 않는다(HR-89). 결과가 시간에 따라 달라지는 registry 조회, 예컨대 latest 조회, version 범위의 해석, outdated package나 새 release의 조회를 하는 검사는 없으며, 다른 live service를 조회하는 검사도 없다. lock이 정확한 version과 integrity로 고정한 package의 다운로드는 설치이므로 허용한다. `npm ci`와 `composer install`이 그렇게 한다. 설치는 audit 없이 lock을 따른다. Test는 사건을 사건이나 주입된 clock으로 정렬하며, 경쟁하는 timer로 정렬하지 않는다. 실행의 server는 시스템이 배정하고 알리는 port에서 듣는다. 모든 recipe는 npm과 Composer를 오프라인으로 실행한다(Makefile의 `npm_config_offline`과 `COMPOSER_DISABLE_NETWORK`). `make composer-development`와 기본 소스 helper를 포함한 명시적 설치 target, `make bootstrap`, `make install-tools`, `make install-packages`, `make hyper-install`, `make hyper-install-php`, `make hyper-install-browser`, `make hyper-install-virtiofs`만 `$(ONLINE)`으로 다운로드하며, 빠진 다운로드는 그것을 만드는 설치 target과 함께 실패하고, 도구에게 온라인으로 다시 시도하라는 안내로 실패하지 않는다. server 시작처럼 오래 걸리는 작업은 시간 제한 없이 기다리며 진행을 출력한다.
  Enforced by: `make kit-check`, `make hyper-test-scripts`
- Own: 성능은 측정하고 보고하며 검사를 실패시키지 않는다. 크기나 시간이 한도를 넘으면 값과 한도를 적은 `WARNING` 줄을 출력하고, GitHub에서는 `::warning::` annotation과 CI 요약의 경고를 남기며, 검사는 통과한다(`make bundle-size`, `make bench`). 측정 script는 사용법 오류나 빠진 입력에서만 실패한다.
  Enforced by: `make hyper-test-scripts`
- Own: 모든 GitHub workflow는 job을 `ubuntu-26.04-arm`에서 실행하고, 각 action을 commit으로 고정하며, `timeout-minutes`를 두지 않고, step의 모든 명령을 하나의 make target으로 실행한다. script나 도구를 직접 실행하지 않는다. 그래야 Makefile의 설정과 검사가 적용된다(HR-90).
  Enforced by: `make hyper-test-scripts`
- Own: 다른 process가 읽을 수 있는 출력은 다시 쓰는 동안에도 파일이 없거나 일부만 쓰인 상태로 공개되지 않는다(HR-82). 파일은 rename 한 번(`writeFileAtomic`)으로, 디렉터리는 쓰는 process의 staging 디렉터리에서 파일 단위로 공개한다(`scripts/publish.mts`). 어떤 recipe도 출력을 지운 뒤 다시 쓰지 않는다. package manager 설치나 전체 실행처럼 두 process가 동시에 쓸 수 있는 자원은 `@polyspec/kit`의 `holder-lock`으로 잠근다. port, database, 임시 디렉터리 같은 실행의 다른 자원은 그 실행만 소유한다.
  Enforced by: none, 어떤 쓰기가 원자적인지는 코드를 읽어 판단한다.
- Own: 검사는 도구 출력을 실행의 맥락과 고정되지 않은 release가 바꾸지 않는 형태로 읽는다(HR-83). `tests/scripts/make-dry-run.mts`의 `dryRun`을 통한 make dry run, 도구가 가진 기계 판독 형식, 그리고 HR-81로 고정된 도구의 다른 text 출력만 쓴다.
  Enforced by: none, 검사가 어떤 출력 형식을 읽는지는 코드를 읽어 판단한다.
- Own: 검사는 검사한 것이 있을 때만 통과한다(HR-84). 실행된 test가 없는 test 실행, 아무것도 고르지 않는 선택이나 목록, 최상위에서 기다리는 node test 파일은 각각 실패한다. 실패는 어디서 보고되었는지, 기대한 것, 실제로 일어난 것, 원인을 보여 주는 출력을 적는다. 시간 초과는 단계의 이름을 적으며, 전체 실행은 실패한 target마다 마지막 줄을 출력한다.
  Enforced by: none, 각 생태계의 runner는 빈 선택을 실패로 보고하지 않는다.
- Own: Test는 자기가 읽는 것을 만든다(HR-85). fixture의 추적 파일을 자기 임시 디렉터리에 복사한다. 설치나 build처럼 다른 target이 쓰는 입력은 test가 읽기 전에 `requireBuilt`로 그 target과 함께 적는다. build 출력은 checkout의 절대 경로를 담지 않으며, build 디렉터리는 checkout 사이에 공유하지 않는다.
  Enforced by: `make hyper-test-scripts`
- Own: 여러 검사를 하는 실행은 모든 검사를 끝까지 실행한 뒤 실패하며, 실패한 검사의 이름을 모두 적는다(HR-86). recipe는 `$(call check,...)`와 `$(checks_result)`를 쓰고, 검사 목표가 여럿인 make는 `-k`로 실행하며, CI step은 앞선 step이 실패해도 `if: ${{ !cancelled() }}`로 실행한다. 앞선 step의 출력을 읽는 step만 실패에서 멈춘다.
  Enforced by: `make hyper-test-scripts`
- Own: 실행의 process나 파일은 실행이 끝난 뒤에 남지 않는다(HR-87). 실행은 자기 server와 임시 디렉터리를 만들 때부터 소유하며, 끝날 때, 실패할 때, SIGINT와 SIGTERM을 받을 때 그것을 멈추고 기다리고 지운다. Test는 그 디렉터리를 쓰는 process가 끝난 뒤에만 지운다.
  Enforced by: none, 실행보다 오래 남는 process는 코드를 읽어 찾는다.
- Own: 추적하는 모든 경로는 `config/owner-checks.json`에 owner를 가진다(HR-88). 경로를 추가하는 변경은 그 owner 규칙도 추가하며, 저장소의 일부를 복사하는 test는 그 일부가 import하는 것을 함께 복사한다.
  Enforced by: `make owner-validate`
- Own: 공유 도구는 npm package `@polyspec/kit`이며 `package.json`의 release asset URL과 `package-lock.json`의 integrity로 고정한다. 깨끗한 checkout은 `make bootstrap`으로 `packageManager` version의 기본 npm을 호출해 lock을 설치한 뒤 `make install-tools TOOLS=npm`과 `make install-packages`를 실행한다. Makefile은 설치 package의 `node_modules/@polyspec/kit/scripts/kit/kit-bootstrap.mk`를 include하고 기본 로컬 package link는 선택 사항이다. `PRINCIPLES.md`, 그 짝, `.editorconfig`, `.claude/settings.json`을 포함한 package의 `kit.copies` 파일은 설치 package에서 `make kit-sync`가 원자적으로 쓰는 일반 파일 복사본이다. 설치 package의 소스 link는 로컬 개발 상태로 유지한다. 복사본은 kit에서만 바꾼다. 이 저장소는 `config/*.json`과 자기 script에서만 다른 저장소와 다르다. 앱 작업을 완료하기 위해 Kit checkout을 직접 수정하지 않는다. 공유 도구 결함이나 빠진 기능은 재현 방법, 기대 동작, 실제 동작과 앱 영향을 담아 polyspec/kit GitHub issue로 등록하고 개선을 요구한다. 모든 로컬 및 CI runtime test는 설치된 Kit runner를 사용한다. 이를 대체하거나 guard를 끄거나 필수 coverage를 줄이거나 우회 결과를 릴리즈 근거로 삼지 않는다. 별도 결함은 보고하면서 지원되는 Kit 선택 방식을 사용할 수 있다. 릴리즈 공개에는 Kit을 통한 필수 CI와 native archive 증명의 성공이 필요하다.
  Enforced by: none, `make kit-sync`가 설치 package에서 복사본을 갱신한다.
- Own: 코드와 test는 각 package 안에서 서로 다른 디렉터리에 둔다.
  Enforced by: `make layout-check`
- Own: 이 저장소가 만드는 경로와 추적 파일에 이름을 적는 경로에는 저장소 상대 경로를 쓴다. 경로는 선언적으로, 추적 파일의 이름으로, 또는 문서나 script가 밝힌 탐색 규칙에 따른 탐색으로 해석한다. 외부 입력에는 명시적인 경로를 요구한다.
  Enforced by: none, 경로가 선언된 것인지 탐색된 것인지는 코드를 읽어 판단한다.
- Own: recipe나 script는 symbolic link를 만들지 않는다. npm과 Composer는 자기 기본값으로 설치하며, 그 link는 받아들인다. 이 저장소의 npm package는 npm workspace이고 npm이 link하며, recipe는 npm의 bin link로 도구를 절대 경로로 시작한다. Composer는 이 저장소의 PHP package를 source 디렉터리로 link하며, `vendor` 아래의 각 polyspec package는 그런 link다(HR-79).
  Enforced by: none, recipe가 만든 symbolic link는 코드를 읽어 찾는다.
- Own: Template 문법과 렌더링 규칙은 template 언어에 속한다. 이 저장소는 그것을 쓰며 바꾸지 않는다.
  Enforced by: none, template 언어의 변경은 review로 찾는다.

## 결정과 수락 규칙

- Refines P3: 구현을 바꾸기 전에 불변식, 수락 조건과 실패 조건을 `docs/spec/protocol.md`에 정한다. Test는 규칙 식별자(`HY-n`)를 인용한다.
  Enforced by: none, test가 규칙 식별자를 인용하는지는 review로 판단한다.
- Own: 같은 영역의 서버 렌더링과 브라우저 렌더링은 같은 바이트를 만든다. `make parity`가 그 불변식의 근거다.
  Enforced by: `make parity`
- Refines S4: 선언된 런타임 범위를 지원하는 최신 안정 의존성 release를 쓴다. 정확한 고정은 모두 그 이유와 제거 조건을 `docs/operations/dependencies.md`에 적는다.
  Enforced by: none, 의존성의 최신 여부와 고정 기록은 review로 판단한다.

## 변경과 기록

- Own: 문서와 번역은 직접적인 문장으로 쓴다. 행동을 명시하고, 주체와 대상을 밝히며, 원인은 한 문장으로 설명하고, 비유나 구어체는 피한다.
  Enforced by: none, 문장이 직접적인지는 review로 판단한다.
- Own: 모든 변경은 항목을 `CHANGELOG.md`와 `CHANGELOG.ko.md`의 맨 위 `## Unreleased` 아래에 추가한다.
  Enforced by: none, 변경마다 항목이 있는지는 어떤 도구도 확인하지 않는다.

## 필수 검사

- Own: commit 전에는 `make docs-check`를 실행한다. `make owner-check`, `make check`나 end-to-end 검사(Apple `container`, browser, parity, run의 server 등)는 commit이나 push 전에 local에서 실행하지 않는다. CI가 push 뒤에 실행한다.
  Enforced by: `make docs-check`, `make check`(checklist의 작업이 끝나기 전에는 guard가 실행을 거부한다)
- Refines P26: `docs/plans/execution/checklist.md`에서 task를 `[o]`로 표시하기 전에, 커밋된 tree에서 그 task의 검증 명령을 실행한다. Verification 열은 `make check`가 아니라 task를 맡는 명령을 적는다. 이미 `[o]`인 행은 명령을 그대로 둔다.
  Enforced by: `make docs-check`
- Own: commit이나 push 전에 local `make check`는 필요하지 않다. 체크리스트 개발이 끝나면 요청된 로컬 최종 모음을 정확히 한 번 실행하며, 수정이나 task마다 실행하지 않는다. `make check`는 `FINAL_RUN=1`로 kit 기본 보고 실행기를 사용한다. 실행기는 활성 `[~]` 항목과 변경되었거나 commit되지 않은 tree를 거부한다. 한 번 실행 절차는 작업 규칙이며 실행기 guard가 아니다. 보고서를 보존하고 수정 후 실패한 소유 부분만 다시 검사한다(`docs/operations/development.md`). 기능은 CI나 로컬 최종 모음에서 그 target 전체 실행이 통과한 뒤에만 implemented로 표시한다.
  Enforced by: `make check`
- Own: `main`의 push와 모든 수동 실행(`workflow_dispatch`)에 대해 GitHub은 `.github/workflows/ci.yml`의 job에서 CI group마다 하나씩 전체 suite를 각 target 끝까지 실행한다. 각 job은 job summary를 쓰고, 상태, 시간, 처음 실패한 줄과 각 target의 전체 로그를 담은 보고서 `var/ci/<name>/`을 올린다(HR-91). 전체 suite와 end-to-end 검사는 여기서 실행한다. 다음 push 전에 그것이 적는 실패를 모두 고친다. 알려진 한계: CI runner는 Linux라서, Darwin에서만 full suite에 속하는 `make virtiofs-check`(`DARWIN_TARGETS`, HR-68)는 Mac에서 local `make check`를 실행할 때만 실행된다.
  Enforced by: `make ci-passed`
- Own: 모든 `make` 실행은 `core.hooksPath`를 `make hooks`가 쓰는 hook인 `.githooks`로 설정한다. `make hooks-check`는 그것이 설정되지 않았거나 hook이 다르면 실패한다. push는 검사하지 않는다. message 규칙은 commit에서 실행되고, CI는 release에서 읽는다(`docs/operations/development.md`).
  Enforced by: `make hooks-check`
- Own: Version 0.1 전까지 변경은 그것을 소유한 unit test로 검사하고, checklist의 모든 task가 `[o]`일 때 `main`을 한 번 push한다(HR-94). Pull request, merge queue, GitHub ruleset은 없으며, push는 `git push origin main`이다. `main`의 push는 `.github/workflows/ci.yml`을 실행하고, 그 마지막 job `ci-passed`는 workflow의 다른 모든 job이 통과했을 때만 통과한다. 그 push의 CI 실행이 commit의 근거이며, release tag는 태그된 commit에 대해 `ci-passed`가 성공한 뒤에만 정한다(`docs/operations/development.md`).
  Enforced by: `make ci-passed`

- Own: 각 애플리케이션 CI group은 실행할 도구와 잠긴 package 환경을 선언하고 공유 도구 선택 및 native package manager로 자신의 job에 설치하며 build 입력도 직접 준비한다. Parity group은 비교하는 모든 구현을 독립적으로 준비하고 다른 언어 job의 설치 환경이나 build 산출물을 사용하지 않는다. 최종 job은 필수 job의 결과만 판정한다.
  Enforced by: `make hyper-test-scripts`

## 릴리스

- Own: Version 0.1 전까지 `main`은 모든 task가 끝났을 때 한 번 push하며, 그 push의 CI 실행이 commit들의 근거다. release는 CI 실행이 `ci-passed` 성공으로 끝난 `main`의 commit에 붙인 tag다(HR-95). tag를 만들고, 옮기고, push하는 것은 maintainer만 한다.
  Enforced by: `make release-verify`
- Own: 버전을 올리는 commit `chore(release): Release X.Y.Z (#<task>)`는 `package.json`, `packages/client/package.json`, `packages/server/ts/package.json`, `packages/build/package.json`, `packages/server/php/composer.json`과 `packages/server/python/pyproject.toml`의 버전을 X.Y.Z로 정한다. `packages/server/ts/package.json`과 `packages/build/package.json`의 `@polyspec/hyper-client` 요구와, private root `composer.json`과 `examples/board/composer.json`의 `polyspec/hyper-server` 요구를 정하며, 그 lock도 쓴다. 두 changelog의 `## Unreleased`를 `## X.Y.Z`로 바꾸고, 그 위에 빈 `## Unreleased`를 새로 둔다. private test package `tests/package-install`은 자기 버전을 유지한다. 그것은 아무것도 공개하지 않기 때문이다(`config/release.json`의 `notReleased`). 버전 올림 commit은 그 lock을 다시 쓰므로, lock이 로컬 package의 버전을 기록한다.
  Enforced by: none, the version-bump commit is a judgement; the package managers resolve the versions.
- Own: maintainer는 CI 실행이 `ci-passed` 성공으로 끝난 뒤 `main`의 commit에 `vX.Y.Z` tag를 붙이고 push한다. 그 push는 `.github/workflows/release.yml`을 실행하며, 그 workflow는 `main`에 태그된 commit이 있고 `ci-passed` 검사가 통과했는지 확인한다. 그다음 `<package>-<language>-<version>.<ext>` 이름의 package 아카이브를 만들고 GitHub Release를 만든다(`docs/operations/development.md`).
  Enforced by: `make release-verify`

## 생성 파일

생성 파일은 Git에 추적하지 않는다. 여기에는 의존성 설치(`node_modules/`, `vendor/`, 가상 환경), build 출력(`dist/`, `target/`, `*.tsbuildinfo`), 캐시(`.cache/`, `__pycache__/`, `.pytest_cache/`), test 실행 산출물(`test-results/`, `playwright-report/`, PHPUnit 캐시)과 도구 다운로드(`var/`)가 속한다. 예외는 저장소가 의도적으로 필요로 하는 파일뿐이며, 추적하는 것은 이것뿐이다: lock 파일(`package-lock.json`, `composer.lock`, `Cargo.lock`, uv lock, `mise.lock`), 이 파일이 이름을 적는 커밋된 생성 문서, test fixture. 각 `.gitignore`가 이 경로들을 덮는다. 새 생성기는 같은 commit에서 자기 ignore 항목을 추가한다.
  Enforced by: `make staged-generated-hook`

## 체크리스트

- Refines P24: 이 저장소의 checklist는 `docs/plans/execution/checklist.md` 하나다. task는 sub-item으로 나누거나 그 checklist에 추가하며, 다른 checklist를 만들지 않는다.
  Enforced by: `make docs-check`
- Own: task ID는 `H<wave>.<number>` 형태이며, task 행은 그 ID로 시작한다. `docs/plans/execution/plan.md`는 각 wave의 의존과 배경을 담는다. wave는 그것이 의존으로 적은 wave들이 끝나면 시작한다.
  Enforced by: `make docs-check`
- Refines P25: `[!]`로 우회한 task(`docs/plans/execution/checklist.md`)는 다음 task가 그것을 우회하지 않고는 진행할 수 없을 때만 쓴다. 재시도 조건이 성립하면 task는 승인을 기다리지 않고 재개한다. 감사는 우회한 task만, 그 원인과 재시도 조건과 함께 다루며, 관계없는 전체 test 실행을 되풀이하지 않는다.
  Enforced by: none, 다음 task가 진행할 수 있는지는 판단이다.
- Own: 받은 지시는 먼저 분류한다. checklist의 task, 이 파일의 규칙, agent memory의 메모, 또는 답만 필요한 것이다. agent memory에는 요청자와 agent가 세션 사이에 필요로 하는 것만 둔다. 프로젝트가 지켜야 하는 것은 저장소(문서, 주석, commit message)에 둔다. 지시가 긴급하다고 밝히지 않았다면, 우선순위와 함께 task로 기록하고 진행 중인 task를 계속한다. 규칙은 이 파일에 중복 없이 두며, checklist나 changelog에는 두지 않는다.
  Enforced by: none, 지시의 분류는 판단이다.
