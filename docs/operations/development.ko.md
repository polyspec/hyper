<!-- doc-id: development -->
<!-- source-sha256: f365f56ed268d35b0e8078782f3f032a119340cf96d8d3ec3c51e56a24b59bda -->
# 개발

[English](development.md).

## 도구

- pin한 도구(HY-81): `.node-version`의 Node.js, `pdo_sqlite`가 있는 `.php-version`의 PHP, `.python-version`의 Python, GNU Make 3.81 이상, 네이티브 확장을 위한 그 PHP의 phpize, php-config와 C compiler. `make install`은 `packageManager`의 npm과 `config/toolchain.json`의 Composer를 `var/tools`에 설치한다(`make install-tools`). `make toolchain-check`는 pin과 다른 모든 도구를 밝힌다.
- 공유 도구: `scripts/kit/`와 `tests/kit/`는 공유 도구 저장소 `polyspec/kit`의 tag `v0.0.6`의 복사본이며(`kit.json`, `.kit/kit.lock.json`), `config/*.json`이 이를 설정한다. `make kit-sync KIT_TAG=<tag>`가 복사본을 쓰며 복사본을 바꾸는 유일한 명령이다. `make kit-check`는 파일이 lock과 다르거나 `config/*.json`이 schema를 어기면 실패하고, `make kit-test`는 도구의 test를 실행한다.
- template package: npm은 `@polyspec/template`과 `@polyspec/template-compiler`를 template release의 tarball에서, Composer는 `polyspec/template`을 그 zip에서 `package.json`, `composer.json`과 그 lock이 고정한 대로 설치한다(HY-70). `make install`이 이를 download한다.
- `../template`(`TEMPLATE_REPOSITORY`)에 있고 tag `v0.0.4`(`TEMPLATE_TAG`, HY-80)를 가진 template 저장소는 네이티브 확장에만 쓴다. `make template`이 그 C 소스, stub, build script를 `var/products/template`에 복사하고(HY-78), tag가 없으면 `make template-tag`가 실패한다. 이 저장소는 그곳에서 아무것도 build하지 않는다.
- network: `make install-tools`, `make install`, `make install-browser`, `make kit-sync`만 download한다. 다른 모든 recipe는 npm, Composer를 offline으로 실행하므로(`npm_config_offline`, `COMPOSER_DISABLE_NETWORK`) 없는 download는 바로 실패하고 그것을 만드는 설치 target을 밝힌다(HY-89).
- Playwright용 Chromium: `make install-browser`. pin한 Playwright의 Chromium과, Linux에서는 그 system library를 설치한다.

## 타깃

| 타깃 | 동작 |
|---|---|
| `make install-tools` | `packageManager`의 npm과 `config/toolchain.json`의 Composer를 `var/tools`에 설치하고 `var/tools/bin`의 명령을 쓰며, 각 download를 pin한 digest로 확인한다(HY-81) |
| `make toolchain-check` | Node.js, npm, PHP, Python, Composer가 pin과 다르면 실패하고 각각의 기대값과 실제값을 밝힌다(HY-81) |
| `make kit-sync` | `KIT_TAG`의 공유 도구를 `scripts/kit/`와 `tests/kit/`에 복사하고 `.kit/kit.lock.json`을 쓴다. 같은 tag에서 두 번째 실행은 `unchanged`를 출력한다 |
| `make kit-check` | vendor한 파일이 `.kit/kit.lock.json`과 다르거나 없거나 lock에 없으면, 또는 `config/*.json`이 schema를 어기면 실패한다 |
| `make kit-test` | `tests/kit`의 공유 도구 test를 실행한다 |
| `make install` | template 저장소의 네이티브 확장 소스의 선언한 복사본과 `packages/hyper-php`의 사본을 쓰고, template release의 template package(HY-70)를 포함한 npm과 Composer 의존성을 bin link 없는 사본으로 설치한다(HY-79) |
| `make hyper-php-copy` | `packages/hyper-php`의 추적 파일 사본 `var/products/hyper-php`를 쓰고 board의 Composer 사본에 publish한다(HY-79, HY-82). `make server`가 먼저 실행한다 |
| `make template` | `scripts/copy-template.mjs`로 template tag `TEMPLATE_TAG`의 commit의 네이티브 확장 소스를 선언한 복사본 `var/products/template`에 쓰고(복사본이 그 commit을 담고 있으면 아무것도 쓰지 않는다, HY-78, HY-80, HY-82) 아무것도 설치하지 않는다. `make ext`, `make test-php`, `make analyse-php`가 먼저 실행한다 |
| `make template-tag` | template 저장소 `TEMPLATE_REPOSITORY`에 tag `TEMPLATE_TAG`가 없으면 기대한 tag와 저장소가 가진 tag를 밝히며 실패한다. `make template`이 복사 전에 실행한다(HY-80) |
| `make ext` | template 저장소의 선언한 복사본의 C 소스에서 그 build script, phpize, `PATH`의 php-config로 네이티브 템플릿 확장을 `build/ext/polyspec_template.so`에 빌드하며, 소스나 PHP build가 바뀐 때만 다시 빌드한다(HY-48, HY-78) |
| `make packages` | `@polyspec/hyper`와 `@polyspec/hyper-server`의 JavaScript module과 type 선언을 각 package가 선언한 build(`scripts/tsc.mjs`를 실행하는 `npm run build`)로 각자의 `dist` 디렉터리에 build하고 build와 각 npm 사본을 파일 단위로 publish한다(HY-79, HY-82). Node 서버 test, board 에셋 build, `make package-check`, `make test-scripts`는 package를 exports로 가져오므로 이것을 먼저 실행한다(HY-61). build script는 `data-template.json`, `checkManifest`, `templateReferences`를 script 옆 `packages/hyper-js`의 소스에서 읽으므로 `dist`가 필요 없고 어느 작업 디렉터리에서도 실행된다 |
| `make package-check` | 두 package를 그 `package-lock.json`에서 `npm ci --offline --install-links`로 `tests/package-install`에 offline 설치하고(HY-89), 그 test를 `erasableSyntaxOnly`로 선언에 대해 type 검사한 뒤 `node`로 실행한다(HY-61) |
| `make server` | 게시판 서버 프로그램을 `examples/board/build/server`에 빌드한다(아래 참조) |
| `make server-fixtures` | PHP 테스트 픽스처의 서버 프로그램을 빌드한다 |
| `make node-fixtures` | `scripts/build-templates.mjs`와 설치한 template package로 Node 서버 test에 쓸 PHP test fixture의 템플릿 파일을 빌드한다(HY-70) |
| `make node-server` | board Node 서버를 타입 검사하고 `examples/board/build/node/server.mjs`로 bundle한다(아래 참조) |
| `make assets` | 게시판 클라이언트 번들과 CSR 셸을 빌드한다(아래 참조) |
| `make test-js` | 라우터 적합성 사례를 포함한 브라우저 코드 테스트와 타입 검사를 실행한다 |
| `make test-node` | Node 서버 test를 실행한다. 같은 fixture로 PHP 서버 test의 사례, `conformance/json.json`의 JSON 사례, session, HTTP 서버, 타입 검사를 실행한다 |
| `make test-php` | 라우터 적합성 사례를 포함한 서버 패키지 테스트를 generated 프로그램으로 한 번, 네이티브 확장으로 한 번 실행한다 |
| `make lint` | PHP 형식을 검사한다 |
| `make analyse-php` | `packages/hyper-php/phpstan.neon`으로 `packages/hyper-php`의 소스와 테스트에 레벨 `max`의 PHPStan을 실행한다. 기준선(baseline)과 무시하는 오류는 없다. PHPStan은 네이티브 template 확장의 시그니처를 `var/products/template/packages/template-php-ext/src/polyspec_template.stub.php`에서 읽고(HY-78), 캐시를 `build/phpstan`에 쓴다. 그 캐시가 없는 실행은 worker에서 기본 PHP 한도 128M보다 큰 132 MB를 쓰므로 `--memory-limit=256M`으로 실행한다 |
| `make templates-check` | 레이아웃 템플릿만 `hx-` 속성을 가지는지(HC-6), 레이아웃이 `{# title}`과 `{# data}`를 한 번씩 배치하는지, 레이아웃과 각 라우트 템플릿의 모든 영역이 블록 인자 없이 `id`가 영역 이름인 요소 바로 안에 한 번씩 배치되는지(HY-3, HY-30) 검사한다 |
| `make test-scripts` | 검사 스크립트의 테스트를 실행한다. 예: 잘못된 픽스처 애플리케이션으로 영역 배치 검사를 시험한다 |
| `make virtiofs-check` | 출력이 virtiofs bind mount에 있는 Apple `container`에서 server build와 출력 복사를 실행한다(HY-68). Darwin에서만 `make check`의 target이며(`DARWIN_TARGETS`), `container`가 없으면 실패한다 |
| `make parity` | PHP 문서와, 문서 JSON과 영역 JSON의 브라우저 렌더 결과를 비교한다. generated 프로그램으로 한 번, 네이티브 확장으로 한 번 실행한다 |
| `make server-parity` | parity 단계를 PHP 서버와 board Node 서버에 실행해 모든 응답의 상태, header, body를 비교하고, `make parity`의 브라우저 비교도 수행한다(HY-55) |
| `make bundle-size` | SSR 스크립트, CSR 셸, 가장 큰 템플릿의 크기를 `config/bundle-size.json`의 gzip 상한과 함께 출력한다. 상한을 넘는 크기는 `WARNING` 줄을, GitHub에서는 annotation `::warning::`과 CI 요약의 warning도 내고, target은 통과한다 |
| `make e2e` | SSR, CSR, JavaScript 없는 흐름, 비교 흐름을 Chromium에서 실행한다(실행의 서버와 database에서, `scripts/run-e2e.mjs`) |
| `make owner-check` | `config/owner-checks.json`이 선언한 바뀐 경로의 owner를 실행한다. `PATHS`는 경로를 밝히고 `BASE`는 그 revision 이후의 변경을 가져온다(HY-88) |
| `make owner-validate` | 추적 경로에 owner가 없거나 `config/owner-checks.json`이 없는 target이나 test 파일을 밝히면 실패한다(HY-88) |
| `make documents-check` | `config/documents.json`의 문서를 검사한다: 문서 쌍, marker `doc-id`와 `source-sha256`, 링크, 코드 블록, changelog, checklist |
| `make commits-check` | `RANGE`(기본은 마지막 commit)의 commit message를 `config/commits.json`으로 검사한다 |
| `make hooks` | `core.hooksPath`를 `.githooks`로 설정하고 pre-push hook을 쓰며 `make hooks-check`를 실행한다([Push](#push) 참조) |
| `make hooks-check` | `core.hooksPath`가 `.githooks`가 아니거나 `.githooks/pre-push`가 없거나 실행할 수 없거나 바뀌었으면 실패한다 |
| `make push-gate-commit` | commit `COMMIT`(기본 `HEAD`)에 진행 중인 checklist 작업이 있거나 그 commit이 `.githooks/pre-push`를 mode 100755로 추적하지 않으면 실패한다([Push](#push) 참고) |
| `make ci-targets` | make target `TARGETS`를 끝까지 실행하고 보고서 `CI_REPORT`를 쓴다([CI](#ci) 참고) |
| `make ci-summary` | 보고서 `CI_REPORT`의 요약과 job summary를 쓴다([CI](#ci) 참고) |
| `make ci-passed` | `RESULTS`, 곧 `needs`의 JSON의 모든 job의 결과가 `success`가 아니면 실패한다([CI](#ci) 참고) |
| `make install-browser` | pin한 Playwright의 Chromium과, Linux에서는 그 system library를 설치한다. `$(ONLINE)`을 거친 download다(HY-89) |
| `make serve-demo` | lock `/tmp/hyper-serve-demo.lock`을 잡은 채 고정 port 8080 ~ 8082에서 SSR, CSR, 비교 페이지를 실행한다. 두 번째 demo는 holder를 밝히며 실패한다([배포](deployment.ko.md) 참조) |
| `make serve-demo-unlock` | process가 끝난 demo의 lock을 지운다. demo가 실행 중이면 실패한다 |
| `make bench-server-smoke` | PHP 측정기를 측정마다 한 번씩 실행한다. 측정기를 깨는 변경이 실패하도록 `make check`에 들어 있다 |
| `make bench` | 서버와 브라우저 성능을 보고하는 `make bench-server`와 `make bench-browser`를 실행한다([성능 측정](benchmark.ko.md) 참조). `make check`에는 포함하지 않는다 |
| `make check` | 위의 모든 검사를 전체 실행의 guard를 거쳐 실행한다(아래 참조) |
| `make rerun-failed` | 현재 tree에서 통과하지 못한 `make check`의 target만 다시 실행한다(아래 참조) |

## 전체 실행

전체 suite는 `main`의 push 뒤에 GitHub에서 실행하며([CI](#ci) 참고), 커밋이나 push 전에 local 전체 실행은 필요하지 않다. Darwin에서만 full suite에 속하는 `make virtiofs-check`는 local `make check`에서만 실행되므로, HY-68의 virtiofs case는 누군가 Mac에서 `make check`를 실행할 때만 실행된다.

`make check`는 `docs/plans/execution-checklist.md`의 작업 중 `[~]`인 것이 없을 때, 커밋된 tree와, 그 실행이 네이티브 확장 소스를 build하는 template tag `TEMPLATE_TAG`의 commit마다 한 번 실행된다(HY-80). 어떤 단계보다 먼저 `scripts/kit/full-run.mjs run --key template=<tag의 commit> <targets>`를 시작하며, 이 guard는 판단을 이유와 함께 출력하고(`[full-run] run: ...` 또는 `[full-run] refuse: ...`) 상태 1로 거부한다.

- checklist(`config/checklist.json`)의 작업 행이 `[~]`일 때. 거부 메시지는 활성 ID를 작업과 함께 나열한다.
- 추적 파일에 커밋되지 않은 변경이 있거나 무시되지 않는 untracked 파일이 있을 때(`git status --porcelain --untracked-files=all`). 전체 실행은 커밋된 tree를 검증하기 때문이다.
- `var/full-run.json`이 현재 tree(`git rev-parse HEAD^{tree}`)와 같은 key `template`, 곧 Makefile이 `TEMPLATE_REPOSITORY`와 `TEMPLATE_TAG`에서 읽는 template tag의 commit의 전체 실행을 기록하고 있을 때. 거부 메시지는 그 실행을 tree, key, 시작 시각, 결과와 함께 밝힌다.
- pre-push hook이 설치되지 않았을 때(`make hooks-check`). 거부 메시지는 `make hooks`를 밝힌다.
- `incomplete` record의 process가 아직 실행 중이거나 다른 전체 실행이 `var/full-run.lock`을 잡고 있을 때.

guard는 `CHECK_TARGETS`의 각 target을 `make -k <target>`으로 끝까지 실행하며, target이 실패한 뒤에도 계속하고, `[full-run] start <target> (<n>/<total>)`와 `[full-run] <target> passed|failed in <seconds>`를 출력한다. 어떤 target에도 시간 제한이 없다. 각 target의 출력은 `var/report/full-run/targets/<target>.log`에도 쓴다. guard는 각 target 앞뒤에 `var/full-run.json`을 쓴다: tree, commit, key, process, 시작과 끝 시각, 결과(마지막 target이 끝날 때까지 `incomplete`, 그다음 `passed` 또는 `failed`), 실패한 target, 각 target의 상태(`pending`, `running`, `passed`, `failed`), 시각, 경과 밀리초, 실패한 target은 마지막 20줄의 출력(`lastLines`)이며, guard는 이를 결과 전에 실패한 target과 함께 출력한다(HY-84). 그래서 멈춘 실행은 실행 중이던 target과 함께 `incomplete`로 기록된 채 남는다. `var/`는 Git이 무시하므로 checkout과 worktree마다 자기 record를 가진다. tree를 바꾸는 commit이나 다른 commit의 template tag는 `[~]` 작업이 없을 때 새 전체 실행을 허용한다.

`make rerun-failed`는 현재 tree와 template commit에서 통과하지 못한 target, 즉 실패한 target과 `incomplete` 실행이 끝내지 못한 target만 다시 실행한다. 진행 중인 작업, 커밋되지 않은 변경, 실행 중인 process에 대해서는 `make check`와 같이 거부되고, record가 없을 때, record가 다른 tree나 template commit의 것일 때, 그 tree의 전체 실행이 통과했을 때도 거부된다. 다시 실행한 결과는 record의 `reruns`에 쓰고, 모든 target이 통과하면 tree의 결과가 `passed`가 된다.

새 checkout에는 record가 없으므로, 그곳에서 `make check`는 `[~]` 작업이 없고 tree가 깨끗하면 실행된다.

## Push

push는 push하는 commit에도 working tree에도 checklist의 `[~]` 작업이 없을 때만 한다. 추적하는 pre-push hook `.githooks/pre-push`는 `make hooks`가 쓰며 `node scripts/kit/push-gate.mjs hook`을 실행한다. 이 script는 입력에서 push의 ref를 읽고, push하는 모든 commit의 checklist(`git show <sha>:docs/plans/execution-checklist.md`)와 working tree의 checklist를 `config/checklist.json`의 tracker로 파싱하고, 상태 1로 push를 거부한다. 거부 메시지는 활성 ID를 작업, ref와 commit 또는 그것을 가진 working tree와 함께 밝히고, 규칙을 말하며, 각 작업을 완료하거나 원인과 재시도 조건과 함께 `[!]`로 표시하라고 알린다. checklist가 없는 push된 commit과 파싱할 수 없는 checklist도 push를 거부한다.

Git은 clone에서 hook을 설치하지 않는다. 그래서 `.githooks/pre-push`를 추적하는 checkout에서는 모든 `make` 실행이 `core.hooksPath`를 `.githooks`로 설정하고, `make hooks`는 이를 명시적으로 설정하며 hook을 쓴다. `make hooks-check`와 전체 실행의 guard는 `core.hooksPath`가 `.githooks`가 아니거나 hook이 없거나 실행할 수 없거나 도구의 hook과 다르면 실패한다. `make push-gate-commit COMMIT=<sha>`는 hook을 건너뛴 push를 위해 같은 gate를 commit에 실행하고, CI group `docs`가 push된 commit에 이를 실행한다.

## main 공개

버전 0.1 전까지 이 저장소에는 pull request, merge queue, GitHub ruleset이 없다(HY-94). 변경은 그것을 소유한 unit test로 검사하고, checklist의 각 작업은 자기 commit에서 `[o]`가 되며, `main`은 모든 작업이 `[o]`일 때 한 번 push한다.

```sh
git push origin main
```

`main`의 push는 `.github/workflows/ci.yml`, 곧 전체 suite를 실행한다([CI](#ci) 참고). 그 마지막 job `ci-passed`는 다른 모든 job이 통과했을 때만 통과한다. release tag는 그 commit에서 `ci-passed`가 성공한 뒤에만 `main`의 commit에 붙인다([Tag 릴리스](#tag-릴리스) 참고).

## Tag 릴리스

릴리스는 `main`의 commit에 붙인 tag `vX.Y.Z`이다(HY-95, 절차는 `AGENTS.md`). tag의 push는 `.github/workflows/release.yml`을 실행하며, 그 step은 다음 순서로 `config/release.json`으로 설정한 `scripts/kit/release.mjs`를 실행하고 첫 실패에서 멈춘다.

```sh
make release-verify
make release-versions
make release-assets
make release-publish
```

`make release-verify`는 tag된 commit이 `origin/main`에 있고 그 commit의 최신 check run `ci-passed`(`gh api repos/<repository>/commits/<sha>/check-runs`)가 결론 `success`로 완료되었는지 확인한다. `make release-versions`는 `config/release.json`이 `manifests`에 나열한 모든 manifest(`package.json`, npm 패키지 셋, `packages/hyper-php/composer.json`, `packages/hyper-python/pyproject.toml`)에 X.Y.Z가 있고 `CHANGELOG.md`와 `CHANGELOG.ko.md`에 section `## X.Y.Z`가 있는지 확인하며, 다른 파일마다 그 버전과 tag의 버전을 적는다. `make release-assets`는 패키지를 빌드하고(`make packages`) `polyspec-hyper-npm-X.Y.Z.tgz`, `polyspec-hyper-server-npm-X.Y.Z.tgz`, `polyspec-hyper-build-npm-X.Y.Z.tgz`, `polyspec-hyper-php-X.Y.Z.zip`을 `var/release/assets`에 쓴다. archive 이름은 `<package>-<language>-<version>.<ext>`이며 `@scope/`와 `vendor/`는 `scope-`와 `vendor-`로 쓴다. `make release-publish`는 archive를 붙이고 section을 notes로 하여 GitHub Release를 만든다. section이 GitHub의 한도인 125000자 이하일 때만 notes가 되며, 더 긴 section은 한 줄 `The changes of X.Y.Z are listed in [CHANGELOG.md](https://github.com/polyspec/hyper/blob/<tag>/CHANGELOG.md#<anchor>).`가 되고, 이 줄은 tag의 `CHANGELOG.md`를 section의 anchor로 링크한다. anchor는 제목 위의 `<a id="...">` 줄의 id이거나, 없으면 점을 뺀 버전이다. Python 패키지 `packages/hyper-python`은 archive가 없다. consumer는 `pip install "polyspec-hyper @ git+https://github.com/polyspec/hyper@vX.Y.Z#subdirectory=packages/hyper-python"`로 tag에서 설치하며, `make release-proof`가 릴리스가 생긴 뒤 이를 실행한다. job은 `ci.yml`의 job `check`처럼 Node.js, Python, PHP, `TEMPLATE_TAG`의 template 저장소, `make install`을 준비하며, tag는 환경 변수 `TAG`로 step에 전달된다. `make release-coverage`는 `config/release.json`이 `manifests`에도, 이유와 함께 `notReleased`에도 나열하지 않은 tracked manifest가 있으면 실패한다. 여기서 `notReleased`는 `tests/package-install/package.json`, `tests/release-install`의 consumer 프로젝트 둘, `examples/board/composer.json`, private root `composer.json`이다.

공개되는 manifest는 tree의 manifest이고, `make release-assets`는 그것을 바꾸지 않고 pack한다(HY-95). 공개되는 manifest는 모든 polyspec 패키지를 정확한 버전으로 적는다. `packages/hyper-js/package.json`, `packages/hyper-node/package.json`, `packages/hyper-build/package.json`은 `@polyspec/template`을(`packages/hyper-build/package.json`은 `@polyspec/template-compiler`도) template release의 버전으로, `@polyspec/hyper`를 릴리스의 버전으로 요구하고, `packages/hyper-php/composer.json`은 `version`을 선언하고 `polyspec/template`을 template release의 버전으로 요구하며 `repositories`가 없다. packed manifest가 polyspec 패키지를 `file:`, `link:`, `workspace:` 경로, git, `github:`, ssh source, URL, range 또는 `@dev`로 적거나, zip이 `repositories`를 선언하거나 tag의 버전이 없거나, packed manifest가 source manifest와 다르면 `make release-assets`는 실패하고 archive, field, 패키지와 그 값을 적는다. 이 동작의 test는 `tests/kit/release.test.mjs`에 있다.

`make release-consumer TAG=vX.Y.Z`는 consumer처럼 저장소 밖의 임시 디렉터리에서 `tests/release-install`의 commit된 프로젝트로 `var/release/assets`의 archive를 빈 cache로 설치한다. 이 저장소의 릴리스 tarball을 `file:`로, template release의 tarball을 URL로 의존하는 `npm/package.json`과 그 `package-lock.json`은, scope `@polyspec`을 닿지 않는 registry `http://127.0.0.1:9/`로 돌린 `npm ci`로 설치하므로 이 저장소의 polyspec 패키지는 그 tarball에서만 오고 template tarball과 third-party 패키지는 lock이 pin한 대로 download된다. 이 저장소의 릴리스 zip의 `artifact` repository `artifacts`와 template release의 zip의 `package` repository를 둔 `composer/composer.json`과 그 `composer.lock`은 `composer install`로 설치한다. 설치한 각 패키지는 `config/release.json`의 smoke 명령을 실행한다. npm 패키지는 import하고, `@polyspec/hyper-build`의 bin `hyper-build-server`와 `hyper-build-assets`는 모든 import를 불러 첫 인자 검사에서 멈추며, Composer 패키지의 class `Polyspec\Hyper\App`은 불러와진다. `make release-consumer-lock TAG=vX.Y.Z`는 archive로 두 manifest와 lock을 쓴다. archive는 같은 실행에서 build되므로 lock은 이 저장소의 tarball이나 zip을 integrity나 shasum 없이 적고, 따라서 lock은 릴리스 버전이나 의존성이 바뀔 때만 바뀌며 릴리스 commit이 이 target을 실행한다.

npm 12.2.0은 `allow-remote=root`에서 npm consumer 프로젝트의 lock을 쓰지 못한다. lock을 만드는 동안 `bundleDependencies`를 가진 패키지, 여기서는 `@tailwindcss/oxide` 아래의 `@tailwindcss/oxide-wasm32-wasi`의 registry tarball을 remote 패키지로 세고 `EALLOWREMOTE`로 실패하기 때문이다([npm/cli#9818](https://github.com/npm/cli/pull/9818)). npm에는 URL별 허용 목록이 없으므로 Makefile은 `make release-consumer-lock`을 `npm_config_allow_remote=all`로 실행하고, consumer 설치는 설정이 필요 없으며 lock이 integrity로 pin한 것만 설치한다. 이 설정은 `packageManager`의 npm 릴리스가 npm/cli#9818을 담으면 제거한다(H13.5-14). consumer 설치에서 npm은 esbuild의 `postinstall` script를 막는다. consumer가 install script를 허용하지 않기 때문이다. esbuild는 npm이 optional 의존성으로 설치하는 platform 패키지(예: `@esbuild/darwin-arm64`)로 실행되고, `@tailwindcss/oxide`에는 install script가 없다.

### 개발 구성

private root는 checkout 안의 패키지를 찾아 주며 공개되지 않는다. root `package.json`은 `@polyspec/hyper`, `@polyspec/hyper-server`, `@polyspec/hyper-build`를 `packages/hyper-js`, `packages/hyper-node`, `packages/hyper-build`의 `file:` 사본으로, `@polyspec/template`과 `@polyspec/template-compiler`를 template release의 tarball URL로 선언하고, 패키지의 정확한 버전이 이 사본과 template tarball로 풀리게 하는 `overrides`를 둔다. npm 12는 기본으로 URL 의존성을 설치하지 않으므로 `.npmrc`가 `allow-remote=root`를 둔다. npm은 workspace를 언제나 link하므로 npm workspace는 두지 않는다(HY-79). root `composer.json`은 path repository `var/products/hyper-php`와, sha1 `shasum`을 가진 template release의 zip의 `package` repository에서 root `vendor`로 설치하고 `packages/hyper-php`의 namespace를 tree에 연결한다. `composer.lock`이 그 lock이다. 두 root는 template release v0.0.4를 받는다(HY-70). 그 tag는 `make template`이 네이티브 확장 소스를 복사하는 Makefile의 `TEMPLATE_TAG`이다(HY-80).

### 릴리스 에셋 설치

consumer는 필요한 릴리스의 에셋을 내려받아 함께 설치한다. registry는 필요 없다. npm에서는 모든 tarball을 `file:` 의존성으로 적고, packed manifest의 각 정확한 버전은 옆에 설치된 tarball이 충족한다.

```json
{
  "dependencies": {
    "@polyspec/hyper-server": "file:polyspec-hyper-server-npm-X.Y.Z.tgz",
    "@polyspec/hyper-build": "file:polyspec-hyper-build-npm-X.Y.Z.tgz",
    "@polyspec/hyper": "file:polyspec-hyper-npm-X.Y.Z.tgz",
    "@polyspec/template": "file:polyspec-template-T.T.T.tgz",
    "@polyspec/template-compiler": "file:polyspec-template-compiler-T.T.T.tgz"
  }
}
```

Composer에서는 zip `polyspec-hyper-php-X.Y.Z.zip`과 `polyspec-template-T.T.T.zip`을 한 디렉터리에 두고 그 디렉터리를 `artifact` repository로 선언한다. zip들은 이름과 버전으로 서로를 찾는다.

```json
{
  "repositories": [{ "type": "artifact", "url": "release-assets" }],
  "require": { "polyspec/hyper": "X.Y.Z" }
}
```

T.T.T는 그 릴리스의 `packages/hyper-js/package.json`이 요구하는 `@polyspec/template`의 버전이다. 애플리케이션을 빌드하는 consumer는 `@polyspec/hyper-build`를 설치하고 그 bin을 `node_modules/.bin`에서 실행한다(HY-96, 아래 서버 빌드와 에셋 빌드).

## CI

workflow `.github/workflows/ci.yml`은 `main`의 push와 모든 수동 실행(`workflow_dispatch`)에 대해 전체 suite를 실행한다(HY-91, [main 공개](#main-공개) 참고). 그 job `check`는 CI group마다 matrix 항목 하나를 `fail-fast: false`로 가지며, 각 항목은 자기가 실행하는 target을 밝힌다.

| 항목 | Target | 준비 |
|---|---|---|
| `docs` | `kit-check`, `kit-test`, `documents-check`, `hooks-check`, `push-gate-commit`, `commits-check`, `owner-validate` | Node.js, Python |
| `php` | `bench-server-smoke`, `lint`, `analyse-php`, `test-php` | Node.js, Python, PHP, template checkout, `make install` |
| `node` | `templates-check`, `test-scripts`, `test-js`, `test-node`, `package-check` | Node.js, Python, PHP, template checkout, `make install` |
| `board` | `parity`, `server-parity`, `bundle-size`, `e2e` | Node.js, Python, PHP, template checkout, `make install`, `make install-browser` |
| `python-3.11`, `python` | `test-python` | Node.js, Python 3.11과 `.python-version`의 Python |

각 step은 make target 하나를 실행하고(HY-90), 첫 step 뒤의 모든 step은 실패한 step 뒤에도 실행한다. workflow는 `.node-version`, `.python-version`, `.php-version`에서 Node.js, Python, PHP를 준비하고 template 저장소를 Makefile의 tag `TEMPLATE_TAG`로 `../template`에 checkout하며, `make install`은 그곳에서 네이티브 확장 소스를 복사한다. `make ci-targets TARGETS="<targets>" CI_REPORT=var/ci/<name>`은 항목의 모든 target을 자기 `make -k <target>`으로 끝까지 실행하고 보고서를 쓴다. `make ci-summary CI_REPORT=var/ci/<name>`은 job summary를 쓴다. job은 artifact `ci-<name>-<run id>-<attempt>`, 곧 디렉터리 `var/ci/<name>/`을 upload한다.

- `summary.md`: tree, Node.js, npm, patch를 포함한 PHP, Composer, make의 실행 중인 release, 각 setup step의 결과, target의 상태, 시간, 첫 실패 줄의 표, 그리고 실패한 각 target의 첫 실패 줄;
- `record.json`: 같은 내용의 data이며 각 target 앞뒤에 쓰므로, 멈춘 runner는 실행 중이던 target을 남긴다;
- `targets/<target>.log`: 각 target의 명령, 전체 출력, make가 끝난 방식.

마지막 job `ci-passed`는 다른 모든 job 뒤에 실행되고 `make ci-passed RESULTS='<needs의 JSON>'`을 실행한다. 이 target은 필요한 모든 job의 결과를 출력하고 하나라도 `success`가 아니면 실패한다. `ci.yml`에 추가한 job은 `needs`에 나열한다. `tests/scripts/ci-workflow.test.mjs`는 `ci-passed`가 없거나, 마지막 job이 아니거나, `if: ${{ always() }}`가 없거나, 다른 모든 job을 need하지 않거나, 다른 runner에서 실행하거나, 다른 step을 실행하면 실패한다.

## Test 실행

`scripts/kit/run-tests.mjs <node|vitest|go|cargo|phpunit> [--timeout <seconds>] [--cwd <directory>] [--php-extension <file>] [--] [<arguments>]`는 test 도구를 실행하고, `make test-js`, `make test-node`, `make test-php`, `make test-scripts`, `make package-check`는 이것으로 test를 실행한다. PHPUnit은 `COMPOSER_VENDOR_DIR`의 vendor 디렉터리의 것이며 `make test-php`가 이를 root `vendor`로 설정한다. 모든 test는 시작할 때 한 줄, 실행 중에는 5초마다 한 줄, 끝나면 결과와 경과 시간을 담은 한 줄을 출력하고, 실행은 개수와 경과 시간을 담은 줄로 끝난다. 모든 test는 자기 timeout을 가지며, `--timeout`이 다른 값을 주지 않으면 30초다. vitest와 `node --test`는 timeout에서 그 test를 실패시키고, `--teamcity`로 test마다 보고하는 PHPUnit은 runner가 PHPUnit을 멈추고 그 test를 이름으로 실패시킨다. `--php-extension`은 PHPUnit에 PHP extension을 불러온다. `tests/kit/run-tests.test.mjs`가 runner와 reporter를 시험한다.

변경을 소유한 test만 실행하려면 그 파일이나 filter를 넘긴다. 예: `node scripts/kit/run-tests.mjs vitest --cwd packages/hyper-js tests/router.test.ts`, `COMPOSER_VENDOR_DIR=$PWD/vendor node scripts/kit/run-tests.mjs phpunit --cwd packages/hyper-php -- --filter RouterTest`.

## 한 실행의 서버

`make parity`와 `make server-parity`는 `scripts/board-servers.mjs`로 자기 서버를 띄운다. 모든 서버는 system이 배정하는 port에서 listen하고, 검사는 서버가 출력에 알리는 주소로 요청을 보낸다(PHP의 `Development Server (http://127.0.0.1:<port>) started`, board Node 서버의 `board on http://127.0.0.1:<port>`, `scripts/serve-edge.mjs`의 `edge http://127.0.0.1:<port>`). 따라서 다른 checkout이나 session의 실행이 도는 동안에도 요청은 같은 실행의 서버에 닿는다. 서버를 띄우는 일은 시간 제한이 없는 단계다. 시작, `[<name>]`을 붙인 서버의 모든 출력 줄, 경과 시간이 붙은 주소를 출력하고, 서버가 먼저 종료하면 실패한다. 한 실행의 database와 session 디렉터리는 임시 디렉터리에 있으며, `scripts/check-parity.mjs`는 그 디렉터리를 `run directory: <path>`로 출력하고 지운다.

`make e2e`도 같은 방식으로 `scripts/run-e2e.mjs`를 실행한다. 이 script는 board 예제를 두 rendering 방식(API origin, edge, SSR origin)으로 실행 디렉터리의 빈 database 위에 띄우고, `tests/e2e/origins.ts`가 요구하는 `HYPER_E2E_SSR`과 `HYPER_E2E_CSR`에 주소를 담아 `playwright test`를 실행한다. 인자는 Playwright에 넘긴다. 예: `node scripts/run-e2e.mjs -g 'stylesheet'`. Playwright는 서버를 직접 띄우지 않는다. `make bench-browser`도 같은 방식으로 서버와 데이터베이스를 띄운다.

## 서버 빌드

build 패키지 `@polyspec/hyper-build`의 bin `hyper-build-server --manifest <app.json> --templates <directory> --output <directory> --php-namespace <namespace>`는 서버 프로그램을 만든다(HY-48, HY-96). `make server`는 checkout에서 `node packages/hyper-build/bin/hyper-build-server.mjs`로 실행한다.

1. `templates/`: 애플리케이션의 모든 템플릿과 예약 템플릿 `hyper/data.tpl`. 네이티브 확장이 이 파일을 읽는다.
2. `program.php`: 같은 템플릿을 `@polyspec/hyper-build`가 요구하는 compiler package `@polyspec/template-compiler`로(HY-70), 주어진 PHP 네임스페이스(게시판은 `Polyspec\Hyper\Examples\Board\Program`)에 컴파일한 generated PHP 프로그램. `program.json`은 그 네임스페이스를 기록하며, 렌더러가 이 파일을 읽는다. 서버가 각 영역을 단독으로 렌더하므로, 모든 템플릿은 대상으로 렌더되고 모든 정의는 HTML이다.
3. `reads.json`: `@polyspec/hyper`의 `routeReads`로 계산한 모든 라우트의 read path(HY-73).

PHP가 `polyspec_template`을 불러왔으면 네이티브 확장으로, 그렇지 않으면 `program.php`로 렌더한다. 두 출력은 같은 원본에서 만들어지므로, 서버는 확장을 불러오는지 여부만으로 엔진을 바꿀 수 있다.

## Node 서버

`make node-server`는 `examples/board/node/main.ts`를 esbuild로 `examples/board/build/node/server.mjs`에 bundle한다. board Node 서버는 `examples/board/public/index.php`와 같은 애플리케이션을 게시글 저장에 `node:sqlite`를 써서 제공하고, `examples/board/public`의 파일도 제공한다.

```sh
make node-server
BOARD_DB=$PWD/examples/board/var/node.db BOARD_SESSIONS=$PWD/examples/board/var/sessions BOARD_PORT=8084 node examples/board/build/node/server.mjs
```

`BOARD_PORT=0`이면 system이 port를 배정하고, 서버는 listen하는 port를 담아 `board on http://127.0.0.1:<port>`를 출력한다. `BOARD_SESSIONS`는 절대 경로의 session 디렉터리이고, `BOARD_BASE_PATH`, `BOARD_HTTPS`, `BOARD_FRAME_ANCESTORS`는 PHP에서와 같은 뜻이다. 두 서버의 `BOARD_TIME`은 새 게시글의 생성 시각을 Unix 초로 고정하므로, `make server-parity`는 같은 게시글을 비교한다. Node 서버는 `make assets`의 템플릿 파일로 렌더한다(HY-54).

## 에셋 빌드

`@polyspec/hyper-build`의 bin `hyper-build-assets --app <디렉터리> --api <기본 경로> --output <디렉터리>`는 build 패키지가 요구하는 template package `@polyspec/template`으로 다음을 쓴다(HY-70, HY-96). `make assets`는 checkout에서 `node packages/hyper-build/bin/hyper-build-assets.mjs`로 실행한다. `public/assets/` 아래에는 이름에 내용의 해시가 들어간 파일을 더하기만 하고 지우지 않으며, 해시가 없는 출력은 `--output`의 디렉터리에 둔다(HY-34). `make assets`는 `examples/board/build`를 넘긴다.

1. `public/assets/templates/<name>.<hash>.json`: `templates/` 아래 템플릿마다 AST 파일 하나, 그리고 예약 템플릿 `hyper/data.tpl`의 파일 하나(HY-34).
2. `<output>/templates.index.json`: 각 템플릿 이름과 그 파일 URL(HY-34). 클라이언트는 이를 `@polyspec/hyper/templates-index`로 import한다.
3. `public/assets/hyper-<hash>.js`, `public/assets/hyper-chunk-<hash>.js`, `<output>/manifest.json`(HY-76).
   - 클라이언트 진입 파일. htmx, hyper 브라우저 코드, template 렌더 런타임, `app/app.json`, 색인이 들어 있고 템플릿은 없다.
   - 진입 파일이 `import()`로만 불러오는 코드마다 조각 파일 하나. 브라우저는 그 코드가 처음 실행될 때 조각을 불러온다.
   - 진입 파일의 URL을 `hyper`로 담은 매니페스트. 서버가 레이아웃에 넘긴다.
   - 빌드는 애플리케이션이 이름을 정하는 파일을 쓰지 않는다. 애플리케이션은 자기 스타일시트를 직접 두고 링크한다.
4. `--tailwind <source>=<output>`이 있으면 output stylesheet. source를 Tailwind CSS의 theme과, `templates/`와 `client/` 아래 file이 쓰는 utility class로 compile하고, source의 rule은 layer `components`에 두며 layer `base`의 rule은 두지 않는다(HY-77). Tailwind CSS는 `@polyspec/hyper-build`의 의존성이므로, npm 12.2.0으로 기본값 `allow-remote=none`에서 lock을 쓰는 애플리케이션은 Tag 릴리스 절의 npm 결함을 만난다. npm 릴리스가 수정을 담을 때까지 npm은 `@tailwindcss/oxide-wasm32-wasi`의 tarball을 `EALLOWREMOTE`로 거부한다([npm/cli#9818](https://github.com/npm/cli/pull/9818)).
5. `<output>/csr/`: CSR 배포물.
   - `index.html`은 `<meta name="hyper-api">`와 인라인한 진입 파일을 담고 스타일시트는 담지 않는다. 브라우저가 렌더한 레이아웃의 스타일시트 링크를 적용하기 때문이다(HY-64, HY-76).
   - `assets/templates/`는 이 build의 템플릿 파일을 담는다.
   - `assets/`는 이 build의 조각 파일을 담는다. 배포물은 `--static`이 밝히는 `public/` 아래 파일을 같은 경로에 담는다. 애플리케이션은 렌더한 layout이 link하는 스타일시트를 밝히며, `make assets`는 board 예제의 `public/assets/app.css`와 `public/assets/reader.css`를 밝힌다. 배포물은 파일 단위로, `index.html`을 마지막으로 publish한다(HY-82).
   - 진입 파일에 `</script`가 들어 있으면 빌드는 실패한다. 빌드는 인라인한 진입 파일의 해시를 담은 Content Security Policy를 출력한다.

빌드는 이전 결과를 교체하므로, 반복해서 빌드해도 결과마다 파일이 하나만 남는다. 빌드 결과는 커밋하지 않는다.

## PHP, Node.js, 브라우저가 같게 동작한다는 증거

| 동작 | 근거 |
|---|---|
| 유지 값 | `conformance/keep.json`을 `make test-php`와 `make test-js`가 실행한다(HY-38). |
| JSON 텍스트 | `conformance/json.json`을 `make test-php`와 `make test-node`가 실행한다. Node 서버는 PHP `json_encode`의 바이트를 쓰고 유지 값을 PHP `json_decode`처럼 읽는다(HY-54). |
| 라우팅 | `conformance/routes.json`을 `make test-php`와 `make test-js`가 실행한다. 렌더할 때 브라우저는 자기 라우트가 서버가 보고한 라우트와 같은지도 확인한다(HY-20). |
| Node 서버 | `make server-parity`는 parity 단계의 모든 요청을 각자 데이터베이스와 session을 가진 PHP 서버와 board Node 서버에 보내고, session 식별자, 응답마다 가린 CSRF token, `ETag` 값을 placeholder로 바꾼 뒤 상태, header, body가 같은지 확인한다(HY-55). |
| 문서 렌더 | `make parity`는 비교 단계마다 같은 세션에서 HTML 문서, 문서 JSON, 영역 JSON을 요청한다. 라우트 영역, 내장 데이터, `server`와 `cookie` 유지 값(HY-30, HY-31, HY-38)을 포함한 문서 JSON의 브라우저 렌더 결과는 응답마다 다른 가린 CSRF 토큰(HY-24)을 각 응답에서 `<csrf>`로 바꾼 뒤 PHP 문서와 바이트 단위로 같아야 하고, 영역 JSON의 모든 부분이 그 문서에 나타나야 한다. 검사는 단계가 시작할 때 한 줄을, 끝나면 결과와 경과 밀리초를 출력한다. 10초 안에 응답이 없는 요청은 그 단계의 이름으로 실패하고 검사를 끝낸다. |
| 브라우저에서의 동작 | `make e2e`는 SSR과 CSR에서 같은 흐름을 실행한다. 이동, 액션, 데이터 요청 없는 `hy-set` 변경, 새로고침과 새 탭에서의 유지 종류 네 가지, 라우트에 필요한 템플릿만 불러오기, 페이지를 보이기 전에 불러오고 다른 페이지가 link하지 않으면 제거하는 layout의 stylesheet link(HY-64), SSR body와 CSR body가 같은지 확인하는 비교 페이지를 포함한다. |

## 측정한 크기

2026-10-05에 `make bundle-size`로 측정했다(htmx 4.0.0, esbuild 0.28.2, 게시판 템플릿 10개와 `hyper/data.tpl`).

| 출력 | 원본 바이트 | gzip 바이트 | brotli 바이트 | gzip 상한 |
|---|---:|---:|---:|---:|
| SSR 스크립트 `hyper-<hash>.js` | 99,580 | 33,080 | 29,549 | 33,500 |
| CSR 셸 `build/csr/index.html` | 99,819 | 33,224 | 29,551 | 33,600 |
| 가장 큰 템플릿 파일(`board/rows.tpl`) | 5,583 | 1,334 | 1,084 | 4,096 |
| 템플릿 파일 11개 합계 | | 5,818 | | |

`config/bundle-size.json`의 SSR 스크립트와 CSR 셸 상한은 측정한 gzip 크기에 약 1%를 더하고 100바이트 단위로 올린 값이다. 상한을 넘는 크기는 실패가 아니라 warning이다(AGENTS). 출력이 상한보다 커지는 변경은 같은 변경 안에서 상한을 고치고 그 증가가 필요한 이유를 적는다. 출력이 작아지는 변경은 같은 규칙으로 상한을 낮춘다.

브라우저는 렌더가 닿는 템플릿만 불러오고(HY-35), 템플릿 파일은 해시가 붙은 이름으로 캐시된다.
- 템플릿 AST는 노드마다 소스 위치를 기록하므로 압축 후 크기가 소스의 약 2배다.
- `config/bundle-size.json`은 템플릿 파일 하나를 4,096 gzip 바이트로 제한한다. 이보다 커지는 템플릿은 블록으로 나눈다.
