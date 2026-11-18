<!-- doc-id: development -->
<!-- source-sha256: 23adca736a3f70a27f985c86c5a045497729feee0c0dbacb00eed9bf13d930cc -->
# 개발

[English](development.md).

## 도구

- pin한 도구(HR-81): `mise.toml`의 Node.js와 Python(mise가 `mise.lock`의 digest에 맞춰 설치한다. Node.js는 `make install-tools TOOLS=npm`이, Python은 `make install-tools`가 설치한다), `pdo_sqlite`가 있는 `.php-version`의 PHP, GNU Make 3.81 이상, 네이티브 확장을 위한 그 PHP의 phpize, php-config와 C compiler. `make hyper-install`은 `package.json`의 `devEngines`가 이름하는 `mise.toml`의 npm과 `config/toolchain.json`의 Composer를 `var/tools`에 설치한다(`make install-tools`). 없는 도구는 그것을 실행하는 target을 실패시킨다(kit K854).
- checkout의 PHP: `make install-tools`는 그 시점에 PATH에서 처음 나오는 php의 wrapper인 `var/tools/bin/php`를 쓰고 그 옆에 `php-config`와 `phpize`의 wrapper를 쓰며, 이후의 `make install-tools`는 이미 있는 wrapper를 그대로 둔다. `make php-check`는 그 wrapper가 `.php-version`의 minor release를 실행하지 않으면 실패한다. recipe가 PHP, Composer, PIE, PHPUnit, PHPStan, phpcs, Pint, PHP 서버 또는 PHP header에 대한 build를 시작하는 모든 target(Makefile의 `PHP_TARGETS`)의 선행 조건이고, `make install-tools`는 설치 후 같은 검사를 `make php-check-installed`로 실행하며, 이것은 wrapper가 없는 checkout에서 통과한다. checkout의 PHP를 바꾸려면 pin한 minor의 php를 PATH의 처음에 두고(Homebrew: `php@<minor>`) `var/tools/bin/php`를 지운 뒤 `make install-tools`를 실행하고, 이어서 그 PHP에 맞게 확장을 build하는 `make hyper-install-php`와 `make hyper-ext`를 실행한다.
- 공유 도구: `@polyspec/kit`은 `package.json`의 릴리즈 URL과 `package-lock.json`의 integrity로 고정한다. 깨끗한 checkout은 `make bootstrap`으로 `devEngines`가 이름하는 정확한 version의 기본 npm을 checkout 밖에서 `--prefix`로 사용해(kit K938) download를 명시적으로 허용한 채 `npm ci --ignore-scripts`를 실행한다. 이어 `make install-tools TOOLS=npm`, `make install-packages`, `make install-tools`로 checkout 도구를 준비한다. Makefile은 kit의 파일을 include하지 않고 hyper의 모든 레시피를 담는다. 각 레시피는 설치 package의 유틸리티를 명시적 인자로 실행한다. 기본 로컬 package link도 같은 경로를 사용하고 형제 checkout을 필수로 요구하지 않는다. Makefile은 link에서는 소스(`scripts/kit/*.mts`)를, pack된 archive에서는 dist(`dist/*.mjs`)를 실행한다. 도구의 설정은 hyper의 기본 파일이다: `.npmrc`(와 `tests/package-install/.npmrc`)의 `allow-remote=root`, mise와 uv를 위한 `mise.toml`의 `[settings]`와 `[env]`, 린트 설정 `knip.json`, `.oxlintrc.json`, `ruff.toml`, `phpcs.xml.dist`, `phpstan.dist.neon`. kit의 각 유틸리티는 실행할 때 자기가 읽는 `config/*.json`을 schema로 확인한다.
- template package: npm은 `@polyspec/template`과 그 platform package를 template release의 tarball에서 `package.json`과 그 lock이 고정한 대로, uv는 platform의 wheel을 `packages/python/pyproject.toml`과 `uv.lock`이 고정한 대로 설치한다(HR-70). `make hyper-install`이 이를 download한다.
- 네이티브 template 확장: template release 0.0.32(`TEMPLATE_VERSION`, tag `TEMPLATE_TAG`)의 php-ext package `polyspec/template`이며, PIE(`make install-tools TOOLS=pie`가 설치하는 `mise.toml`의 `http:pie`)가 release의 Composer repository `https://github.com/polyspec/template/releases/download/v0.0.32/packages.json`에서 build한다(H14.1-7, H27.45, H31.5). `make hyper-install`이 `$(ONLINE)`을 거쳐 `make template-ext`를 실행한다. 그 recipe가 빈 `var/pie/polyspec/template`에서 `pie repository:add`와 `pie build`를 직접 실행하고, PIE가 거기에 기록한 library 하나를 `scripts/pie-binary.mts`로 가져와 `build/ext/polyspec_template.so`에 게시한다(H27.51). `pie install`은 기기의 PHP에 쓰므로 쓰지 않는다. `make ext`는 아무것도 build하지 않고 그 library만 요구한다. Composer manifest는 확장을 `ext-polyspec_template`으로 요구하며 template package를 lock하지 않는다.
- network: `make install-tools`, `make install-packages`, `make hyper-install`, `make hyper-install-browser`만 download한다. 다른 모든 recipe는 npm, Composer를 offline으로 실행하므로(`npm_config_offline`, `COMPOSER_DISABLE_NETWORK`) 없는 download는 바로 실패하고 그것을 만드는 설치 target을 밝힌다(HR-89).
- Playwright용 Chromium: `make hyper-install-browser`. pin한 Playwright의 Chromium과, Linux에서는 그 system library를 설치한다.

## 기본 Composer 개발

개발 checkout은 polyspec provider(kit, template)를 자기 `.links`의 항목과 `make link`로만 link한다. min-0-max/json-schema는 opis/json-schema의 유지되는 fork이고, 그 FORK.md가 fork를 유지하고 소비하는 방법을 적는다. `composer.json`과 `examples/board/composer.json`은 그 VCS repository `https://github.com/min-0-max/json-schema`를 선언하고 범위 `^2.6.0-p2`로 요구하며, 두 lock은 release `v2.6.0-p2`를 commit과 dist로 고정한다. `packages/php/composer.json`은 repository를 적지 않으므로 polyspec/hyper의 소비자는 자기 root에 fork를 선언한다. fork를 편집하는 checkout은 fork의 checkout을 가리키는 `.links` 항목과 `make link`로 provider처럼 그것을 link한다.

## 타깃

| 타깃 | 동작 |
|---|---|
| `make install-tools` | `devEngines`가 이름하는 `mise.toml`의 npm과 `config/toolchain.json`의 Composer를 `var/tools`에 설치하고 `var/tools/bin`의 명령을 쓰며, 각 download를 pin한 digest로 확인한다(HR-81) |
| `make install-packages` | `var/tools`의 npm으로 `@polyspec/kit`과 npm workspace를 포함한 `package-lock.json`과 `scripts/recipe/typescript`의 고정된 TypeScript를 `$(ONLINE)`으로 설치한다 |
| `make layout-check` | `config/layout.kit.yml`을 extend하는 `config/layout.yml`에 대해 `var/tools`의 alint로 폴더 배치를 검사한다 |
| `make hyper-install` | pin한 도구를 설치하고, `$(ONLINE)`을 거쳐 template release의 Composer repository에서 PIE로 네이티브 확장을 build하며(`make template-ext`; H14.1-7, H27.45), `make hyper-install-python`을 실행하고, template release의 template package를 포함한 Composer 의존성을 설치한다(HR-70) |
| `make hyper-install-python` | kit의 `python-venv` 유틸리티로 `mise.toml`의 Python에서 Python 서버 package의 venv `.venv`를 새로 만들고, release의 template wheel을 포함한 의존성과 함께 package를 non-editable로 설치한다. Python test와 board Python 서버는 그 Python을 실행하며 source 경로를 읽지 않는다(S5) |
| `make npm-lock` | 요구가 바뀐 뒤, checkout의 npm의 `npm install --package-lock-only --ignore-scripts`로 `$(ONLINE)`을 통해 root와 `tests/package-install`의 `package-lock.json`을 그 manifest에서 쓴다. 아무것도 설치하지 않는다. 이 실행은 실행 시점에 range를 해석하지 않는다. manifest는 모든 polyspec 패키지를 release asset의 URL이나 정확한 버전으로, 다른 모든 패키지를 정확한 버전으로 적으며, npm은 manifest가 여전히 허용하는 lock된 버전을 그대로 둔다. range는 root의 `ajv` `^8.20.0` 하나이며, 그 lock된 버전은 manifest가 배제할 때까지 남는다(H35.41) |
| `make python-lock` | Python package의 요구가 바뀐 뒤, checkout의 uv의 `uv lock`으로 `$(ONLINE)`을 통해 `pyproject.toml`에서 `packages/python/uv.lock`을 쓴다. uv는 manifest가 여전히 허용하는 lock된 버전을 그대로 둔다(H35.41) |
| `make composer-lock PACKAGES="<vendor/package> ..."` | manifest에서 pin이 바뀐 뒤, checkout의 Composer의 `composer update --no-install`로 `$(ONLINE)`을 통해 적은 패키지에 대해서만 `composer.lock`과 `examples/board/composer.lock`을 쓴다. 모든 패키지의 update는 실행 시점에 각 range를 해석하므로 `PACKAGES` 없이는 실패한다(HR-89, H35.41) |
| `make hyper-php-install` | `packages/php`를 가리키는 symbolic link로 `polyspec/hyper`를 설치하는 board의 Composer 의존성을 설치한다(HR-79). 의존성을 설치할 때 이 target을 명시적으로 실행한다 |
| `make ext` | `make hyper-install-php`의 `make json-ext`와 `make template-ext`가 json과 template release의 Composer repository(`packages.json`)에서 PIE로 가져온 json 확장 `build/json-ext/polyspec_json.so`와 template 확장이 없으면 실패한다. 링크된 실행에서 template 확장은 `vendor/polyspec/template`이 링크하는 template checkout의 `target/release/libpolyspec_template`이다. offline으로 실행하며 아무것도 build하지 않는다(HY-48.23, H27.45) |
| `make hyper-ext` | `packages/php/native`의 PHP 확장 `polyspec_hyper`를 checkout의 php와 php-config에 대해 Cargo로 build하고, 그 PHP가 확장을 load하는지 확인한 뒤 `build/hyper-ext`에 publish한다. PHP는 build의 입력이고, `PHP`와 `PHP_CONFIG`에 주는 wrapper의 경로는 그 뒤의 PHP가 바뀌어도 같으므로, 출력이 자기 입력을 이름으로 밝힌다(HR-80). Cargo는 확장의 crate를 그 PHP의 API가 정하는 target 디렉터리 `target/php-<headers><build>`에서 build한다. `<headers>`는 header의 release(`php-config --vernum`)이고 `<build>`는 `release-php-ext`가 PHP의 build를 쓰는 형식인 `-nts`, `-zts`, `-debug-nts`, `-debug-zts` 중 하나다. 예를 들면 `target/php-80427-nts`이다. recipe는 그 디렉터리를 `CARGO_TARGET_DIR`로 Cargo에 주고, `make lint-bindings`와 `make test-bindings`도 그 crate의 clippy와 test를 같은 디렉터리에서 실행한다. 다른 PHP는 다른 디렉터리에서 build하므로 다른 API의 library가 복사되는 일이 없고, 어떤 recipe도 target 디렉터리를 지우지 않는다. checkout이 더 이상 build하지 않는 API의 디렉터리는 손으로 지운다. `build/hyper-ext`는 마지막 build의 library를 담는다. `hyper-ext`는 그것을 load하는 모든 target의 선행 조건이므로, 각 실행은 library를 load하기 전에 checkout의 PHP에 맞는 library를 publish한다(HY-132.2) |
| `make packages` | `@polyspec/hyper-client`와 `@polyspec/hyper`의 JavaScript module과 type 선언을 각 package가 선언한 build(npm의 bin link인 `tsc`를 실행하는 `npm run build`)로 각자의 `dist` 디렉터리에 build하고 각 build를 파일 단위로 publish한다. npm은 workspace를 link하므로 `node_modules`는 build를 바로 보여 준다(HR-79, HR-82). Node 서버 test, board 에셋 build, `make package-check`, `make hyper-test-scripts`는 package를 exports로 가져오므로 이것을 먼저 실행한다(HR-61). build script는 `data-template.json`, `checkManifest`, `templateReferences`를 script 옆 `packages/client`의 소스에서 읽으므로 `dist`가 필요 없고 어느 작업 디렉터리에서도 실행된다 |
| `make package-check` | 두 package를 그 `package-lock.json`에서 `npm ci --offline`으로 `tests/package-install`에 offline 설치해 그 디렉터리에 link하고(HR-89), `npm pack`이 publish하는 파일을 확인하며, 그 test를 `erasableSyntaxOnly`로 선언에 대해 type 검사한 뒤 `node`로 실행한다(HR-61) 테스트는 `NPM_BIN`으로 고정된 npm을 받으며 `tests/package-install/var/`에는 ignore된 기본 링크 상태를 저장한다. |
| `make server-fixtures` | PHP 테스트 픽스처의 서버 프로그램을 그 `build.json`의 고정 build id로 빌드한다([빌드](#빌드) 참조) |
| `make node-fixtures` | `scripts/fixture-program.mts`와 PHP test fixture의 `build.json`의 build id로 Node 서버 test에 쓸 그 fixture의 서버 프로그램을 빌드한다(HY-48.19, HY-125.21) |
| `make node-server` | board Node 서버를 타입 검사하고 `examples/board/build/node/server.mjs`로 bundle한다(아래 참조) |
| `make board` | 설치된 소스 패키지로, 의존성을 설치하거나 링크를 다시 연결하지 않고 `hyper build` 한 번으로 board를 빌드한다: `public/assets`, CSR 셸을 담은 `examples/board/build/client`, `examples/board/build/program`([빌드](#빌드) 참조) |
| `make test-js` | 라우터 적합성 사례를 포함한 브라우저 코드 테스트와 타입 검사를 실행한다 |
| `make hyper-test-node` | Node 서버 test를 실행한다. 같은 fixture로 PHP 서버 test의 사례, `contracts/json.json`의 JSON 사례, session, HTTP 서버, 타입 검사를 실행한다 |
| `make test-php` | 라우터 적합성 사례를 포함한 서버 패키지 테스트를 json 확장, template 확장, `polyspec_hyper`를 이 순서로 불러와 실행한다 |
| `make lint` | PHP 형식을 검사한다 |
| `make analyse-php` | `packages/php/phpstan-max.neon`으로 `packages/php`의 소스와 테스트에 레벨 `max`의 PHPStan을 실행한다. 기준선(baseline)과 무시하는 오류는 없다. PHPStan은 cache를 `build/phpstan`에 쓴다. cache가 없는 실행은 worker에서 132 MB가 필요해 PHP의 기본 한도 128M을 넘으므로 `--memory-limit=256M`으로 실행한다. 먼저 `make ext`를 실행한다 |
| `make templates-check` | board에 `hyper check`를 실행한다: 매니페스트(HY-2), 레이아웃 템플릿만 `hx-` 속성을 가지는지(HC-6), 레이아웃이 `{# title}`과 `{# data}`를 한 번씩 배치하는지, 레이아웃과 각 라우트 템플릿의 모든 영역이 블록 인자 없이 `id`가 영역 이름인 요소 바로 안에 한 번씩 배치되는지(HY-3, HY-30) 검사한다 |
| `make typecheck` | `node_modules`의 tsc와 root `tsconfig.json`(strict, `erasableSyntaxOnly`)으로 `scripts/`, `tests/`, `benchmarks/`의 TypeScript type을 검사한다. Node는 이 `.mts` 파일을 type stripping으로 실행하며 검사하지 않는다(S9). `scripts/check-parity.mts`가 `@polyspec/hyper-client`의 build가 쓰는 type을 import하므로 먼저 `make packages`를 실행한다 |
| `make lint-ts` | kit의 oxlint(`.oxlintrc.json`, type-aware)로 TypeScript를 검사하고, knip(`knip.json`)으로 쓰이지 않는 파일, 의존성, export를 검사한다. `make check`와 CI 항목 `gates`의 target이다(H23.13) |
| `make hyper-test-scripts` | 검사 스크립트의 테스트를 실행한다. 예: 잘못된 픽스처 애플리케이션으로 영역 배치 검사를 시험한다 |
| `make virtiofs-check` | 출력이 virtiofs bind mount에 있는 Apple `container`에서 `hyper build`의 프로그램 조립이 하는 쓰기를 host에서 계산한 내용으로 실행하고, 출력 복사를 실행한다(HR-68). Darwin에서만 `make check`의 target이며(`DARWIN_TARGETS`), `container`가 없으면 실패한다. Darwin에서만 실행하는 이유는, 시험하는 virtiofs bind mount가 Apple `container`에만 있고 CI의 Linux target 중 이 증상을 검사하는 것이 없기 때문이다. 원인은 모든 platform에서 `tests/scripts/output-files.test.mts`가 시험한다 |
| `make parity` | PHP 문서와, 문서 JSON과 영역 JSON의 브라우저 렌더 결과를 json 확장과 template 확장을 불러와 비교한다 |
| `make server-parity` | parity 단계를 PHP 서버와 board Node 서버에 실행해 모든 응답의 상태, header, body를 비교하고, `make parity`의 브라우저 비교도 수행한다(HR-55) |
| `make bundle-size` | SSR 스크립트, CSR 셸, static 배포의 chunk 파일 합계, 가장 큰 템플릿의 크기를 `config/bundle-size.json`의 gzip 상한과 함께 출력한다. 상한을 넘는 크기는 `WARNING` 줄을, GitHub에서는 annotation `::warning::`과 CI 요약의 warning도 내고, target은 통과한다 |
| `make e2e` | SSR, CSR, JavaScript 없는 흐름, 비교 흐름을 Chromium에서 실행한다(실행의 서버와 database에서, `scripts/run-e2e.mts`) |
| `make owner-check` | `config/owner-checks.json`이 선언한 바뀐 경로의 owner를 실행한다. `PATHS`는 경로를 밝히고 `BASE`는 그 revision 이후의 변경을 가져온다(HR-88) |
| `make owner-validate` | 추적 경로에 owner가 없거나 `config/owner-checks.json`이 없는 target이나 test 파일을 밝히면 실패한다(HR-88) |
| `make rules-check` | `PRINCIPLES.md`나 `AGENTS.md`의 규칙이 `.github/workflows`의 workflow step이 닿지 않는 검사를 적거나 검사를 적지 않으면 실패한다(P3) |
| `make docs-check` | `config/documents.json`의 문서를 검사한다: 문서 쌍, marker `doc-id`와 `source-sha256`, 링크, 코드 블록, changelog, checklist |
| `make hooks` | changelog와 checklist의 merge driver를 선언한다([Hooks](#hooks) 참조) |
| `make hooks-check` | `make hooks`의 merge driver가 선언되지 않았으면 실패한다 |
| `make ci-check` | CI group `NAME`을 `ci.yml`의 job처럼 실행한다. setup, 끝까지 실행하는 target, 보고서 `var/ci/<name>`이다([CI](#ci) 참고) |
| `make ci-targets` | make target `TARGETS`를 끝까지 실행하고 보고서 `CI_REPORT`를 쓴다([CI](#ci) 참고) |
| `make ci-summary` | 보고서 `CI_REPORT`의 요약과 job summary를 쓴다([CI](#ci) 참고) |
| `make ci-passed` | `RESULTS`, 곧 `needs`의 JSON의 모든 job의 결과가 `success`가 아니면 실패한다([CI](#ci) 참고) |
| `make hyper-install-browser` | pin한 Playwright의 Chromium과, Linux에서는 그 system library를 설치한다. `$(ONLINE)`을 거친 download다(HR-89) |
| `make serve-demo` | lock `/tmp/hyper-serve-demo.lock`을 잡은 채 고정 port 8080 ~ 8082에서 SSR, CSR, 비교 페이지를 실행한다. 두 번째 demo는 holder를 밝히며 실패한다([배포](deployment.ko.md) 참조) |
| `make serve-demo-unlock` | process가 끝난 demo의 lock을 지운다. demo가 실행 중이면 실패한다 |
| `make bench-server-smoke` | PHP 측정기를 측정마다 한 번씩 실행한다. 측정기를 깨는 변경이 실패하도록 `make check`에 들어 있다 |
| `make bench` | 서버와 브라우저 성능을 보고하는 `make bench-server`와 `make bench-browser`를 실행한다([성능 측정](benchmark.ko.md) 참조). `make check`에는 포함하지 않는다 |
| `make check` | 위의 모든 검사를 기본 최종 검증 실행기를 거쳐 실행한다(아래 참조) |
| `make preflight` | checkout이 자기 process로 실행하는 CI group의 target을 끝까지 실행하고, CI만 실행하는 것을 이름한다([Preflight](#preflight) 참조) |

Darwin virtiofs 검사는 Makefile의 digest로 고정한 `VIRTIOFS_IMAGE`를 읽는다. `make hyper-install-virtiofs`가 그 image를 명시적으로 설치한다. 검사는 로컬 image를 먼저 확인하고 없으면 해당 설치 target을 밝히고 실패한다. 검사는 이 checkout과 외부 소스 제공 저장소를 원래 경로에 읽기 전용으로 mount한다. 제공 저장소 root는 설치된 template과 compiler 모듈 진입점에서 `git rev-parse --show-toplevel`로 찾는다. 컨테이너 안에서도 기본 package 소스 link와 그 의존성 해석을 유지한다.

`lint-ts`는 검사 전에 `packages`로 workspace 선언을 build한다.

Script 검사는 runner 전에 `assets`와 `server`를 요구한다. `package-check`는 고정 설치와 호환 source link를 native npm에 맡긴 뒤 editor hook 설정 없이 type 검사와 설치된 package 실행을 검증한다.

## 의존성 추가

다른 polyspec 저장소의 의존성은 release asset의 URL로 선언한다(HR-70). 사람이 checkout의 npm으로 `npm_config_offline=false`와 함께 `var/tools/bin/npm install --save-dev <release asset url>`을 실행해 더하고, integrity를 기록하는 `package-lock.json`과 함께 `package.json`을 커밋한다. 이것은 check가 아니라 설치이므로 어떤 target도 실행하지 않는다. 그 release가 없는 동안 개발 checkout은 `.links`와 `make link`로 provider를 연결한다.

## 전체 실행

전체 모음은 `main` push 뒤 GitHub에서 실행한다. commit이나 push 전에 로컬 전체 실행은 필요하지 않다. 체크리스트 개발 중에는 변경을 소유한 unit 검사만 실행한다. 체크리스트 개발이 끝나면 `make check`를 정확히 한 번 실행한다. 실패하면 그 소유 부분만 수정하고 다시 검사한다. 새 commit이 생겼다고 전체를 다시 실행하지 않는다.

`make check`는 모든 `CHECK_TARGETS`, Darwin에서는 `DARWIN_TARGETS`를 더해 kit의 기본 `ci-targets` 실행기를 호출한다. 활성 `[~]` 체크리스트 항목이 없는 commit된 tree에서 실행한다. 실행기는 아무것도 거부하지 않으며(kit K1053) `var/report/full-run.lock`을 잡고 실패해도 모든 target을 끝까지 실행한다. kit의 검사기 `GATE_TARGETS`도 이 모음의 target이다. Darwin은 `virtiofs-check`를 포함하고 Linux CI는 포함하지 않는다.

실행기는 tree, runtime version, target 상태와 시간을 `var/report/full-run/record.json`에, 요약을 `summary.md`에, 전체 log를 `targets/<target>.log`에 쓴다. 요약에는 실패 target의 근거를 포함한다. 실행기는 tree당 한 번 제한을 강제하지 않으며, 위의 한 번 실행 절차가 작업 규칙이다. 설치된 소스 link는 개발 입력으로 유지하고, `make link-check`가 그것을 link 선언 `.links`와 비교한다(kit K869).

호스트가 절전하면 실행이 멈춘 동안 test 제한 시간을 넘길 수 있다. 실패와 겹치는 절전 구간을 보존하고 재개 후 영향받은 소유 검사만 다시 실행한다. 제한 시간을 늘리거나 코드 결함을 재현하지 않고 코드 수정으로 보고하지 않는다.

보고서에서 실패 target 이름을 읽는다. 소유 검사를 직접 실행하거나, 수정을 commit하고 활성 항목이 없을 때 `make ci-targets TARGETS="<failed targets>" CI_REPORT=var/report/failed-owners`로 그 target만 묶어 실행한다. 원본 보고서를 보존하고 수정 검사는 별도 보고서에 기록한다. 소유 검사 재실행은 해당 수정의 근거이며 원본 전체 실행을 다른 tree의 성공으로 바꾸지 않는다.

## Preflight

`make preflight`는 checkout이 자기 process로 제공하는 CI suite 부분을 로컬에서 실행하므로(H35.92), 기본 결함이 push 전에 드러난다. 그 목록은 `CI_GROUPS_MEASURE`에 없는 `CI_GROUPS`의 모든 group의 `CI_TARGETS_<group>` target에서 필요를 선언하는 target(아래)을 뺀 것이므로, CI group이 얻는 target은 다른 선언 없이 그 목록에 오른다. kit의 report runner로 `var/report/preflight`에 모든 target을 끝까지 실행하고, 그 뒤 실패한 각 target을 이름하며 실패한다(HR-86).

먼저 CI만 실행하므로 건너뛰는 것을 출력한다.

- checkout이 마련할 수 없는 것을 `CI_NEEDS_<target> := browser|container|redis`로 선언하는 각 target. `e2e`, `bench-browser`, `bench`는 browser가, `bench-sessions`는 Redis server가, `virtiofs-check`는 Apple container가 필요하다. `tests/scripts/preflight.test.mts`는 target의 dry run이 닿지 않는 선언과, 선언 없이 playwright, `container`, bay나 Redis server에 닿는 검사 target을 실패시킨다. `make parity`는 browser code를 Node에서 render하므로 아무것도 선언하지 않는다
- 보고만 하고 실패하지 않는 측정 group의 target `bench`와 `bench-sessions`
- Redis server를 시작하는 `tests/scripts`의 test 파일이며, 그것은 `./session-redis-server.mts`에서 import하는 파일이다. `hyper-test-scripts`는 나머지 파일을 실행한다

release asset(`ci-assets-*`)은 어떤 CI group에도 없으므로 목록에 오르지 않는다. AGENTS.md가 밝히듯, test가 자기 process에서 system이 정하는 port로 시작하는 server는 실행된다.

## Hooks

hyper는 Git hook을 두지 않는다. `make hooks`는 `CHANGELOG.md`, checklist와 그 한국어 짝의 merge driver를 `.git/info/attributes`와 git 설정에 선언하고, git은 각 driver를 `make twin-merge`로 실행한다. `make commit`은 commit message를 쓰며 그것을 판정하지 않는다(kit K1053). push는 검사하지 않는다. commit의 CI 실행은 release에서 읽는다.

## main 공개

버전 0.1 전까지 이 저장소에는 pull request, merge queue, GitHub ruleset이 없다(HR-94). 변경은 그것을 소유한 unit test로 검사하고, checklist의 각 작업은 자기 commit에서 `[o]`가 되며, `main`은 모든 작업이 `[o]`일 때 한 번 push한다.

```sh
git push origin main
```

`main`의 push는 `.github/workflows/ci.yml`, 곧 전체 suite를 실행한다([CI](#ci) 참고). 그 항목 `gates`가 kit의 검사기를 실행하고, 마지막 job `ci-passed`는 다른 모든 job이 통과했을 때만 통과한다. 릴리스는 그렇게 성공한 실행의 id를 받아 그 commit에 tag를 단다([Tag 릴리스](#tag-릴리스) 참고).

## Tag 릴리스

릴리스는 `main`에서 `.github/workflows/ci.yml`의 실행이 성공한 commit에 붙인 tag `vX.Y.Z`이다(HR-95, 절차는 `AGENTS.md`). `.github/workflows/release.yml`은 맨 끝 commit이 버전 올림 commit인 push의 CI 실행이 성공하면 스스로 시작하고(kit K987), maintainer는 그 실행의 id만으로 그것을 다시 시작할 수 있으며(`gh workflow run release.yml -f run=<id>`), 버전은 그 실행의 commit에 있는 `CHANGELOG.md`의 첫 section `## X.Y.Z`이며(kit K924), tag의 push는 그것을 시작하지 않는다. release의 section `## X.Y.Z`는 버전 올림 commit에서 표시 `unimplemented`를 가진 `contracts/protocol.json`의 모든 statement를 id로, 그것을 구현하는 행과 함께 이름한다. 그래서 release를 읽는 사람이 그 release가 명세의 어떤 statement를 따르지 않는지 안다. 그 section을 표시와 비교하는 검사는 없다. workflow는 세 job을 가지며, 각 job의 run step은 Makefile의 recipe 하나이다.

| Job | Run step | recipe가 이 순서로 실행하고 첫 실패에서 멈추는 것 |
|---|---|---|
| `tag` | `make ci-release-tag RUN=<id> AUTO=<1 for a workflow_run>` | `release-tag`, 그다음 뒤 job에 `TAG`와 `VERSION`을 주는 `release-tag-output`. tag를 만들지 않았으면 뒤 job은 실행하지 않는다 |
| `assets` | tag와 `release: true`로 `.github/workflows/assets.yml`을 부른다 | 그 workflow의 job `platform`, `php`, `npm`. 각각 `make ci-assets-<job> RELEASE=true`이다([릴리스만 실행하는 step](#릴리스만-실행하는-step) 참조) |
| `release` | `make ci-release-release TAG=<tag> VERSION=<version>` | `release-tools`, `release-assets`, `release-publish`, job `assets`의 download된 asset을 폴더와 함께 `var/release/assets`로 복사(`cp -R`), `release-recipes`, `binding-cases`, `release-go-module`, `release-go-module-push`, `release-platform-assets`, `release-undraft` |

`make release-tag`는 `origin/main`에 commit이 있는, `main` 위 ci.yml의 완료되고 성공한 push 또는 수동 실행을 요구하고, 그 commit에 있는 `CHANGELOG.md`의 첫 section `## X.Y.Z`에서 X.Y.Z를 읽으며(kit K924), 그 commit에 annotated tag `vX.Y.Z`를 만들어 push한다. 뒤 job은 그 tag를 checkout한다. `make release-tools`는 릴리스의 도구를 설치한다. `make release-assets`는 패키지를 빌드하고(`make packages`) `config/release.json`이 `packages`에 적는 각 패키지의 archive와 Composer 패키지의 `packages.json`을 `var/release/assets`에 쓴다. archive는 packer가 주는 이름을 그대로 쓰고, `config/release.json`이 그 패키지에 선언한 product와 runtime으로 GitHub label `<vendor>-<product>-<runtime>-<version>`을 붙인다(kit P39). `make release-publish`는 archive를 붙이고 section을 notes로 하여 draft GitHub Release를 만든다. section이 GitHub의 한도인 125000자 이하일 때만 notes가 되며, 더 긴 section은 한 줄 `The changes of X.Y.Z are listed in [CHANGELOG.md](https://github.com/polyspec/hyper/blob/<tag>/CHANGELOG.md#<anchor>).`가 되고, 이 줄은 tag의 `CHANGELOG.md`를 section의 anchor로 링크한다. anchor는 제목 위의 `<a id="...">` 줄의 id이거나, 없으면 점을 뺀 버전이다. `make release-go-module`은 생성된 Go 파일과 각 platform의 static library를 실행의 actor의 identity로 tag의 tree 위에 commit하고 그 commit의 tag `packages/go/vX.Y.Z`를 push한다(binding GN-19f). `make release-platform-assets`는 각 platform의 asset을 label과 함께 draft에 upload하며 하나라도 없으면 실패한다(binding GN-19g). 그다음 `make release-undraft`가 릴리스를 공개한다. `make release-coverage`는 `config/release.json`이 `manifests`에도, 이유와 함께 `notReleased`에도 나열하지 않은 tracked manifest가 있으면 실패한다. 여기서 `notReleased`는 `tests/package-install/package.json`, `examples/board/composer.json`, private root `composer.json`이다.

공개되는 manifest는 tree의 manifest이고, `make release-assets`는 그것을 바꾸지 않고 pack한다(HR-95). 공개되는 manifest는 모든 polyspec 패키지를 정확한 버전으로 적는다. `packages/client/package.json`, `packages/ts/package.json`, `packages/cli/package.json`은 `@polyspec/template`을 template release의 버전으로, `@polyspec/hyper-client`를 릴리스의 버전으로 요구하고, `packages/php/composer.json`은 `version`을 선언하고 `ext-polyspec_template`을 요구하며 `config.platform`에 그 template release의 버전을 선언하고 `repositories`가 없다.

consumer는 자기 package manager로 archive를 설치해 릴리스를 확인하며, 릴리스의 어떤 step도 archive를 설치하지 않는다.

### 릴리스만 실행하는 step

`.github/workflows/release.yml`은 `main`에서 완료된 `ci`의 `workflow_run`이 push 또는 수동 실행이고 결론이 `success`일 때, 또는 id `run`을 준 `workflow_dispatch`로 시작한다. job `tag`와 `release`는 `ubuntu-26.04-arm`에서 실행하고, `contents: write`와 `actions: read`를 가진 workflow의 token인 `GH_TOKEN`을 받는다. `assets.yml`의 job은 `contents: read`로 실행하며, job `platform`과 `php`는 자기 platform의 runner(`ubuntu-26.04`, `ubuntu-26.04-arm`, `macos-15`)에서 실행한다.

`make release-tag`는 job `assets`와 `release`가 실행되기 전에 tag를 만들어 push하며, tag는 옮기지 않는다. 그 뒤의 step이 실패하면 공개된 GitHub Release 없이 tag `vX.Y.Z`가 remote에 남고, 수정은 그 tag가 담지 않는 새 commit이므로 버전 X.Y.Z를 잃는다. step의 어떤 순서도 이것을 막지 못한다. CI는 릴리스가 tag 뒤에 실행하는 것을 tag 없이 실행한다: `ci.yml`의 모든 실행이 자기 commit으로 `assets.yml`을 부르고, group `node`가 `make release-candidate-assets`를 실행한다. 이 target은 commit된 HEAD에서 `CHANGELOG.md`의 첫 section `## X.Y.Z`의 버전으로 kit의 archive를 `var/release-candidate/assets`에 build한다(kit K1286). kit는 변경된 경로나 untracked 경로가 있거나 밖에서 link된 의존성이 있는 checkout을 거부한다. 그래서 `.links` 선언이 있고 그 패키지가 link된 checkout은 릴리스의 candidate가 아니다. 전체 suite의 target인 `make release-candidate-assets`는 거기서 link를 적는 kit의 거부로 실패하고, 어떤 checkout에도 link가 없는 CI에서는 통과한다. 버전 커밋을 push하기 전에, 그 commit의 깨끗한 clone에서 `make release-rehearsal VERSION=X.Y.Z`가 kit의 `release-run prepare`로 그 버전의 같은 archive를 build한다. 표는 tag 뒤에 실행되는 것, CI에서 같게 실행되는 것, 릴리스만 보여 주는 것을 나열한다.

| Job과 recipe | recipe가 순서대로 시작하는 make | 도구와 그것을 설치하는 것 | CI에서 같은 것 | 릴리스만 보여 주는 것 |
|---|---|---|---|---|
| `tag`: `ci-release-tag` | `release-tag`(kit의 `release-run tag`: `gh api`가 실행을 읽고, `git fetch`, `git tag -a`, tag의 `git push`), `release-tag-output` | Node.js와 kit: bootstrap action. `gh`와 `git`: runner image | 없음 | token이 실행을 읽고 tag를 push하는지, output `tag`와 `version`이 뒤 job에 닿는지 |
| `assets.yml`의 `platform`: `ci-assets-platform RELEASE=true` | `install-tools TOOLS="rust uv python go"`, `release-recipes`, `binding-cases`, `musl-cc-check`, `release-binding-check`, `release-assets-platform`(`release-go-static`, `release-wheel`, `release-npm-platform`) | Rust, uv, Python, Go: `install-tools` 줄. napi CLI: `node_modules/.bin/napi`. musl target의 C를 build하는 LLVM 21의 clang과 llvm-ar: Linux runner image | `ci.yml`의 job `assets`가 같은 runner에서 `RELEASE` 없이 같은 recipe를 실행하므로, `release-binding-check` 자리에 `bindings-check`를 실행한다 | `release-binding-check`의 결과 |
| `assets.yml`의 `php`: `ci-assets-php EXPECTED_PHP_MINOR=<minor> RELEASE=true` | `install-tools TOOLS="rust go"`, `release-recipes`, `binding-cases`, `release-binding-check`, `release-assets-php`(`release-php-ext`) | Rust와 Go: `install-tools` 줄. PHP: matrix entry의 minor를 받는 setup-php. LLVM 21: Linux runner image, macOS에서는 install-llvm-action이며 recipe가 그 `LLVM_PATH`를 `LLVM_ROOT`로 넘긴다 | `platform`과 같다 | `release-binding-check`의 결과 |
| `assets.yml`의 `npm`: `ci-assets-npm RELEASE=true` | `install-tools TOOLS="rust go"`, `release-recipes`, `binding-cases`, `release-binding-check`, `packages`, `release-assets-npm`(`install-wasm-bindgen`, `release-npm`) | Rust와 Go: `install-tools` 줄. wasm-bindgen: `install-wasm-bindgen` | `platform`과 같다 | `release-binding-check`의 결과 |
| `release`: `ci-release-release` | `release-tools`, `release-assets`, `release-publish`, `cp -R var/release/downloaded/. var/release/assets/`, `release-recipes`, `binding-cases`, `release-go-module`, `release-go-module-push`, `release-platform-assets`, `release-undraft` | checkout의 모든 도구: `release-tools`. `gh`, `git`, `tar`, `unzip`: runner image | group `node`의 `release-candidate-assets`가 `release-assets`의 packer를 실행한다. 다른 make는 어떤 job도 실행하지 않는다 | artifact의 download, draft와 그 notes, `GITHUB_ACTOR`의 identity로 하는 Go module의 commit과 tag, 하나라도 없으면 실패하는 platform asset의 upload, 공개된 릴리스 |

binding의 두 check는 모두 `go mod download`로 `packages/go/go.mod`의 `go.sum`을 계산하므로, 각 recipe는 check 전에 Go를 설치한다. check의 도구가 없는 job은 CI에서 실패한다. release check는 `Cargo.toml`의 개발 형태 의존성을 보고하는 규칙 CK-70을 더한다. 개발 형태는 branch나 Go version `v0.0.0` 같은 것이다. core와 각 binding crate의 `Cargo.toml`은 `polyspec-template`을 tag `v0.0.32`로 받고, `packages/go/go.mod`는 template module을 `v0.0.32`로 require하므로(H31.5), template의 의존성 중 개발 형태인 것은 없다. CI는 release check를 릴리스의 `assets.yml`에서 tag 뒤에만 실행하므로, checkout에서 `make release-binding-check`를 실행하면 릴리스 전에 그 결과가 보인다.

`tests/scripts/ci-workflow.test.mts`는 `release.yml`의 세 job, `ci.yml`과 `release.yml`의 `assets.yml` 호출, 각 platform의 runner, 각 recipe의 make의 순서를 검사한다. `tests/scripts/ci-group-tools.test.mts`는 job `release`와 `assets.yml`의 각 job의 make의 dry run을 `RELEASE=true`가 있을 때와 없을 때 모두 읽고, 어떤 명령 줄이 도구를 설치하는 줄보다 먼저 그 도구를 시작하면 실패한다. `binding check`와 `binding release-go-module`은 Go를 시작하는 것으로 센다. 이 test는 CI group, `assets.yml`의 job 또는 릴리스의 명령 줄이 `rust-toolchain.toml`에 없는 Rust target이나 Rust component를 필요로 하면 실패한다. 곧 WASM target, `release-go-static`의 musl target, 그리고 그 target이 `llvm-strip`을 시작하는 component `llvm-tools`이다. kit의 utility가 자기 process 안에서 시작하는 것, 곧 `npm pack`, `git archive`, `gh`는 어떤 dry run에도 없고 어떤 test도 판정하지 않는다.

`make ci-release-tag`, `make ci-release-release`와 `assets.yml`의 job은 어떤 릴리스에서도, GitHub의 어떤 CI 실행에서도 실행된 적이 없다.

Python 패키지 `packages/python`은 `release-wheel`이 각 platform의 runner에서 maturin으로 build하는 platform wheel `polyspec_hyper-X.Y.Z-cp314-abi3-<platform>.whl`로 릴리스하며, `config/release.json`은 그 `pyproject.toml`을 버전을 담는 manifest로 나열한다. 이 패키지는 kit의 kind `wheel`인 패키지가 아니다. kit는 그 kind를 그 디렉터리만의 `git archive`에서 순수 Python wheel로 build하는데, 그 archive에는 `native/Cargo.toml`이 경로 `../../rust`로 받는 core의 crate도, 생성된 source도 없다.

`packages/ts`의 npm 패키지 `@polyspec/hyper`는 `polyspec-hyper-X.Y.Z.tgz`와 platform 패키지 `polyspec-hyper-<platform>-X.Y.Z.tgz`로 릴리스한다. 앞의 것은 job `npm`의 `release-npm`이 addon을 build하지 않은 checkout에서 `npm pack`이 나열하는 파일의 복사본에 WASM module을 더해 pack하고, 뒤의 것은 `release-npm-platform`이 `package.json`의 devDependency인 napi CLI로 build한다. 이 패키지는 kit의 npm 패키지가 아니다. kit의 `npm pack`은 checkout의 파일을 받으며, 그 가운데에는 `make node-addon`의 debug addon이 있다. `config/release.json`은 그 `package.json`을 버전을 담는 manifest로 나열한다. kit는 native 파일이 없는 `@polyspec/hyper-client`와 `@polyspec/hyper-cli`를 pack한다.

`polyspec/hyper`가 `ext-polyspec_hyper`로 require하는 PHP extension `polyspec_hyper`는 archive `php_polyspec_hyper-vX.Y.Z_php<minor>-<platform>-nts.zip`과 `packages/php/native`의 Composer 패키지 `polyspec/hyper-native`로 릴리스한다. archive는 job `php`의 `release-php-ext`가 각 platform과 `config/toolchain.json`의 `phpExtension.minors`의 각 PHP minor(8.4와 8.5)로 build하고, Composer 패키지는 kit가 그 source zip `polyspec-hyper-php-ext-X.Y.Z.zip`을 pack해 `packages.json`에 적으며, PIE는 거기서 platform의 archive를 찾는다. `release-php-ext`는 archive 이름을 crate `polyspec-hyper-php-ext`의 버전으로 짓고 `release-platform-assets`는 tag의 버전의 이름을 요구하므로, 버전 커밋은 core crate의 버전을 정하고 binding crate는 거기서 자기 버전을 받는다. `config/release.json`은 이 `Cargo.toml` 파일들을 버전을 담는 manifest로 나열한다. crate는 그 commit 전까지 버전 0.0.0을 가진다.

### 개발 구성

private root는 checkout 안의 패키지를 찾아 주며 공개되지 않는다. root `package.json`은 npm이 link하는 npm workspace `packages/client`, `packages/cli`, `packages/ts`(HR-79)와, `@polyspec/template`을 template release의 tarball URL로, 그 platform package 세 개를 각자의 URL로 `optionalDependencies`에 선언한다. npm은 workspace가 요구하는 정확한 버전을 이 tarball로 해석하므로 manifest는 `overrides`를 두지 않는다. npm 12는 기본으로 URL 의존성을 설치하지 않으므로 `.npmrc`가 `allow-remote=root`를 둔다. root `composer.json`은 path repository `packages/php`에서 root `vendor`로 설치하고, template release의 Composer repository `packages.json`을 선언하며, template 확장 `ext-polyspec_template`을 `config.platform`의 그 version과 함께 요구하고, `packages/php`의 namespace를 tree에 연결한다. `composer.lock`이 그 lock이다. 두 root는 template release v0.0.32를 받는다(HR-70). 그 tag는 `make template-ext`가 php-ext package `polyspec/template`을 build하는 Makefile의 `TEMPLATE_TAG`이다(HR-80).

### 릴리스 에셋 설치

consumer는 필요한 릴리스의 에셋을 내려받아 함께 설치한다. registry는 필요 없다. npm에서는 모든 tarball을 `file:` 의존성으로 적고, packed manifest의 각 정확한 버전은 옆에 설치된 tarball이 충족한다.

```json
{
  "dependencies": {
    "@polyspec/hyper": "file:polyspec-hyper-X.Y.Z.tgz",
    "@polyspec/hyper-cli": "file:polyspec-hyper-cli-X.Y.Z.tgz",
    "@polyspec/hyper-client": "file:polyspec-hyper-client-X.Y.Z.tgz",
    "@polyspec/template": "file:polyspec-template-T.T.T.tgz"
  }
}
```

Composer에서는 두 release의 Composer repository, 곧 각 release가 archive 옆에 게시하는 `packages.json`을 선언하고 `polyspec/hyper`를 요구하며, `polyspec/hyper`는 template 확장 `ext-polyspec_template`을 요구한다. template release의 repository가 PIE가 설치하는 php-ext package `polyspec/template`을 제공한다.

```json
{
  "repositories": [
    { "type": "composer", "url": "https://github.com/polyspec/hyper/releases/download/vX.Y.Z/packages.json" },
    { "type": "composer", "url": "https://github.com/polyspec/template/releases/download/vT.T.T/packages.json" }
  ],
  "require": { "polyspec/hyper": "X.Y.Z" }
}
```

T.T.T는 그 릴리스의 `packages/client/package.json`이 요구하는 `@polyspec/template`의 버전이다. 애플리케이션을 빌드하는 consumer는 `@polyspec/hyper-cli`를 devDependency로 설치하고 `hyper build`를 `package.json` script나 `npm exec --package=@polyspec/hyper-cli -- hyper build`로 실행한다(HR-96, [빌드](#빌드)). 설치 없는 `npx hyper`는 npm의 무관한 공개 package `hyper`를 실행한다.

릴리스는 Go module `github.com/polyspec/hyper/packages/go`도 생성된 소스와 platform의 static library를 더한 commit에 tag `packages/go/vX.Y.Z`로 게시한다(binding GN-15g, GN-19f). `make ci-release-release`가 `release-go-module`과 이어 `release-go-module-push`를 실행하며, 뒤의 것이 tag를 한 번의 `git push --atomic`으로 push한다(H35.35-7, binding B2.488). Go consumer는 그 module을 `vX.Y.Z`로 요구하며, 그 `go.mod`가 요구하는 template, json, session-store의 tag가 함께 온다. `packages/release.mk`의 module recipe가 module을 게시하므로 `config/release.json`은 json과 session-store처럼 `"goModules": {}`를 둔다.

## CI

workflow `.github/workflows/ci.yml`은 `main`의 push와 모든 수동 실행(`workflow_dispatch`)에 대해 전체 suite를 실행한다(HR-91, [main 공개](#main-공개) 참고). 그 job `check`는 CI group마다 matrix 항목 하나를 `fail-fast: false`로 가진다. 항목은 Makefile의 `CI_GROUPS`를 적고, 각 항목은 run step 하나 `make ci-check NAME=<group>`을 가진다(HR-90). Makefile이 각 group을 선언한다. 설치할 도구(`CI_TOOLS_<group>`), 순서대로의 setup step(`CI_SETUP_<group>`), 실행할 target(`CI_TARGETS_<group>`)이다.

| Group | Bootstrap 이후 선택 도구 | 잠긴 package 환경 | 검사 |
|---|---|---|---|
| `gates` | Node/npm, PHP/Composer, PIE, Python/uv, ruff, vulture, alint, phpcs, phpstan | Root npm, root와 board Composer lock. Python package와 crate는 없다. 어느 gate도 그것을 시작하지 않기 때문이다 | kit의 검사기: 설정, 배치, 문서, owner, rebuild 분류, 언어, 중복, suppression, TypeScript, PHP, Python 린트(`GATE_TARGETS`) |
| `docs` | Node/npm, PHP/Composer, PIE, Python/uv | Root와 board Composer lock | 타입 검사와 script 검사 |
| `php` | Node/npm, PHP/Composer, PIE | Root와 board Composer lock | PHP 정책, benchmark smoke, formatting, analysis와 test |
| `node` | Node/npm | Root npm lock | Template, browser unit, Node server와 npm consumer |
| `board` | Node/npm, PHP/Composer, PIE, Python/uv | Root npm, root와 board Composer, Python uv lock | Browser parity, Node/Python server 비교, bundle 크기와 E2E |
| `python` | Node/npm, Python/uv | Root npm과 Python uv lock | Python unit과 rendering |
| `core` | Node/npm, Rust, PHP, Python/uv, Go | Cargo lock과 `package-lock.json`의 binding generator(`make install-packages`) | Rust core 시험, clippy, format, contract 검사, 바인딩의 clippy와 시험, Node, WASM, Go의 생성된 시험(H35.2). `test-bindings`의 prerequisite인 `make test-node-addon`은 Node binding의 생성된 시험 `packages/ts/native/generated/tests/generated.test.mjs`를 node --test로 실행한다. 이 시험은 checkout의 생성된 entry와, `make node-addon`이 crate의 모든 test feature로 build한 addon을 쓴다. `packages/ts`의 vitest 실행은 `native/`를 제외한다(H35.9-10). kit의 `install-tools`에는 `test-bindings`가 시작하는 wasm-bindgen CLI의 selector가 없으므로, group의 setup은 `make release-recipes`로 `packages/release.mk`를 쓰고 그 target인 `make install-wasm-bindgen`을 실행한다. 이 target은 checkout의 mise로 그 CLI만 `mise.lock`의 digest에 맞춰 설치한다. `tests/scripts/ci-group-tools.test.mts`는 모든 group의 setup step과 target의 dry run을 읽고, group이 시작하는데 그 setup이 설치하지 않는 tool이 있으면 실패한다 |

group의 local 실행은 그 job의 호출과 같은 `make ci-check NAME=<group>`이다. bootstrap action처럼 `make bootstrap`, `make install-tools TOOLS=npm`, `make install-packages`를 실행한 checkout에서 실행한다. 어떤 group도 가리키지 않는 `NAME`은 어떤 step보다 먼저 실패하고 group들을 적는다.

recipe `ci-check`는 group의 setup step을 순서대로 각각 별도의 make로 실행하고 첫 실패에서 멈춘다. 뒤의 step과 target이 그 step이 설치하는 것을 읽기 때문이다. 첫 step은 `make install-tools TOOLS="<CI_TOOLS of the group>"`이다. Kit은 선택, 필수 도구 의존성, version과 hash 검증, 일치하는 설치 도구 재사용을 소유한다. Hyper는 별도 도구 설치기를 선언하지 않는다. `make hyper-install-php`가 네이티브 template 확장을 build하는 `docs`, `php`, `board` group은 `pie`를 선택한다. npm은 별도 bootstrap을 사용하고 `gates` group은 `make lint-php`가 php-parser를 읽는 PHP symbol extractor를 `make install-symbols EXTRACTORS="php"`(`CI_SYMBOLS_gates`)로 설치한다. kit의 lint 도구(phpcs, phpstan, ruff, alint, vulture)는 그 target이 실행하는 `gates` group만 설치하고, `make hyper-lint`와 `make analyse-php`는 `vendor`의 pint와 PHPStan을 실행한다.

`make hyper-install-crates`는 `Cargo.lock`이 고정한 crate, 곧 polyspec crate의 git tag와 crates.io의 crate를 lock의 모든 target에 대해 `cargo fetch --locked`로 가져온다. `gates`를 뺀 모든 CI group의 두 번째 setup step이다. 그 group들이 각각 cargo, maturin, binding 생성기를 시작하고 이들은 crate를 offline으로 읽기 때문이다. 그 밖의 모든 recipe는 cargo를 `--offline`으로 시작하며, 그런 target 각각의 prerequisite인 `make crates-check`는 `crates-check: a crate that Cargo.lock pins is not fetched, or the lock does not match the manifests; run make hyper-install-crates`로 실패한다(HR-89). `make hyper-install-php`는 기존 설치 lock 안에서 고정 PHP archive와 root 및 board Composer lock만 설치한다. `make hyper-install-python`은 `uv sync --locked`를 실행하는 kit의 `uv-install` 유틸리티로 Python 환경만 설치한다(kit K850). `make hyper-install-redis`는 `docs`를 위해 session test의 Redis server를 build하고, `make hyper-install-browser`는 `board`를 위해 Chromium을 설치한다. Node 의존성은 기존 npm lock 설치를 사용한다. Native source 개발 link는 별도 로컬 설치 선택으로 유지한다.

Build 선행 조건은 각 job의 검사가 소유한다. 언어 job은 다른 언어 job을 기다리거나 설치 환경 또는 build 산출물을 다운로드하지 않는다. 설치는 online이고 build와 검사는 offline 환경을 유지한다.

각 구현의 자기 test가 `contracts/`의 공유 vector를 실행하며, 언어 간 test 이름을 맞추는 gate는 없다(H27.91). Browser가 필요한 server 간 비교는 세 구현과 Chromium을 직접 설치하는 `board`가 소유한다. Python 렌더링 검사는 Python job이 소유한다. Matrix 집계는 `ci-passed`에 모든 group 결과를 요구한다.

job의 나머지 step은 `uses:` step이다. hyper를 history와 함께 workspace root에 checkout하고, checkout 바로 다음에 `mise.toml`의 Node를 사용하는 hyper의 bootstrap action(`./.github/actions/bootstrap`)을 실행하며, 도구에 PHP가 있는 group(항목의 `php: true`)은 setup-php로 `.php-version`의 PHP를 준비하고, 앞 step이 실패해도 보고서를 upload한다(`if: ${{ !cancelled() }}`). 어떤 job도 다른 저장소를 checkout하지 않으며, 고정 release asset이 template package와 확장 소스를 준다. setup 뒤에 `make ci-targets TARGETS="<CI_TARGETS of the group>" CI_REPORT=var/ci/<name>`이 group의 모든 target을 자기 `make -k <target>`으로 끝까지 실행하고 보고서를 쓰며, 이어 `make ci-summary CI_REPORT=var/ci/<name>`이 항상 각 setup step의 결과(`success`, `failure`, `skipped`)와 함께 요약과 job summary를 쓴다. `make ci-check`의 상태는 setup과 target의 상태이며, 요약을 쓰지 못하면 실패한다. job은 artifact `ci-<name>-<run id>-<attempt>`, 곧 디렉터리 `var/ci/<name>/`을 upload한다.

- `summary.md`: tree, Node.js, npm, patch를 포함한 PHP, Composer, make의 실행 중인 release, 각 setup step의 결과, target의 상태, 시간, 첫 실패 줄의 표, 그리고 실패한 각 target의 첫 실패 줄;
- `record.json`: 같은 내용의 data이며 각 target 앞뒤에 쓰므로, 멈춘 runner는 실행 중이던 target을 남긴다;
- `targets/<target>.log`: 각 target의 명령, 전체 출력, make가 끝난 방식.

마지막 job `ci-passed`는 다른 모든 job 뒤에 실행되고 `make ci-passed RESULTS='<JSON of needs>'`을 실행한다. 이 target은 필요한 모든 job의 결과를 출력하고 하나라도 `success`가 아니면 실패한다. 다른 job의 결과를 판정하므로 CI에만 있다. `ci.yml`에 추가한 job은 `needs`에 나열한다. `tests/scripts/ci-workflow.test.mts`는 `ci-passed`가 없거나, 마지막 job이 아니거나, `if: ${{ always() }}`가 없거나, 다른 모든 job을 need하지 않거나, 다른 runner에서 실행하거나, 다른 step을 실행하면 실패하고, `ci.yml`의 job이 make 변수를 받는 `make ci-<job>` 하나 말고 다른 run step을 가지면 실패한다.

`ci.yml`의 group `bench`는 모든 실행에서 benchmark를 실행한다. `make ci-check NAME=bench`는 Redis를 설치하는 그 setup, 이어 `make ci-targets`로 `var/ci/bench`에 `make bench`와 `make bench-sessions`, 그리고 요약을 실행하고, job은 보고서를 upload한다. 한도를 넘는 측정은 `WARNING` 줄을 출력하고 통과하므로, job은 benchmark를 실행할 수 없을 때만 실패한다([성능 측정](benchmark.ko.md) 참고).

## Test 실행

`node node_modules/@polyspec/kit/dist/run-tests.mjs <node|vitest|go|cargo|phpunit> [--cwd <directory>] [--php-extension <file>] [--] [<arguments>]`는 test 도구를 실행하고, `make test-js`, `make hyper-test-node`, `make test-php`, `make hyper-test-scripts`, `make package-check`는 이것으로 test를 실행한다. PHPUnit은 `COMPOSER_VENDOR_DIR`의 vendor 디렉터리의 것이며 `make test-php`가 이를 root `vendor`로 설정한다. 모든 test는 시작할 때 한 줄, 실행 중에는 5초마다 한 줄, 끝나면 결과와 경과 시간을 담은 한 줄을 출력하고, 실행은 개수와 경과 시간을 담은 줄로 끝난다. runner는 시간 제한을 두지 않는다. 도구를 실행하고 그 출력과 exit code를 그대로 전한다. `--php-extension`은 PHPUnit에 PHP extension을 불러온다. kit이 runner와 reporter를 시험한다.

변경을 소유한 test만 실행하려면 그 파일이나 filter를 넘긴다. 예: `node node_modules/@polyspec/kit/dist/run-tests.mjs vitest --cwd packages/client tests/router.test.ts`, `COMPOSER_VENDOR_DIR=$PWD/vendor node node_modules/@polyspec/kit/dist/run-tests.mjs phpunit --cwd packages/php -- --filter RouterTest`.

### Case 선택

`make hyper-test-js`, `make hyper-test-node`, `make hyper-test-php`, `make hyper-test-python`은 make 변수 `CASES`를 받는다. 이 변수는 그 target의 case runner(HYR-7)가 실행할 case를 선택한다. 값은 이름 하나이거나 공백으로 나눈 여러 이름이며, 네 runner가 같은 문법으로 읽는다.

| 이름 | 선택하는 것 | 예 |
| --- | --- | --- |
| `#`이 있는 이름: `<file>#<section>` | 그 case 파일의 그 section의 case | `app.json#opens` |
| `.json`으로 끝나는 이름 | 그 case 파일의 case | `reads.json` |
| 그 밖의 이름 | 모든 case 파일에서 그 id의 case | `a_missing_header_is_the_any_range` |

runner는 이름이 선택한 case를 전체 실행의 순서대로 한 번씩 실행하며, 전체 실행에서 자기가 실행하는 case만 선택한다. `make hyper-test-js CASES="accept.json"`은 아무것도 선택하지 않는다. `accept.json`의 어떤 section도 browser runner를 적지 않기 때문이다. 어떤 이름이 runner의 case를 하나도 선택하지 않으면 실행은 case를 실행하기 전에 실패하고 결과 파일을 쓰지 않는다. 그 메시지는 선택과 그런 이름을 각각 밝힌다. 예: `the selection "reads.json no-such.json" of the php runner selects no case for no-such.json`(HR-84).

선택이 있으면 target의 recipe는 명령 하나, 곧 case runner뿐이다. PHPUnit의 `CaseRunnerTest`, package의 `tests/case-runner.test.ts`, 또는 `test_case_runner.py`이다. target의 다른 test, `hyper-test-js`와 `hyper-test-node`의 type check, `hyper-test-python`의 package data test는 실행하지 않는다. target의 prerequisite은 전체 실행과 같이 build한다. 따라서 case가 소유하는 체크리스트 행은 그런 명령을 검증으로 적는다. 예: `make hyper-test-php CASES="reads.json"`.

선택한 실행은 `var/recipe/results/<runner>.selected.txt`를 쓴다. 첫 줄은 `SELECTION <names>`이고 나머지 줄은 선택한 case의 결과 줄이다. 전체 실행의 파일이며 `make recipe-check`가 읽는 `var/recipe/results/<runner>.txt`는 쓰지 않는다. `make recipe-check`와 target `recipe-run-*`는 runner에 선택을 주지 않으므로 `CASES`의 값과 무관하게 모든 case를 실행한다. Makefile은 선택을 환경 변수 `RECIPE_CASES`로 runner에 준다. 빈 `CASES`는 전체 실행이다.

`make e2e`의 `CASES`는 이름만 같은 다른 변수이다. Playwright가 case의 제목과 맞춰 보는 pattern이다.

### Test 파일 선택

`make hyper-test-php`, `make hyper-test-node`, `make hyper-test-python`은 `make hyper-test-js`가 `JS_TESTS`를 받듯이 자기 package의 unit test 파일 선택을 make 변수 `PHP_TESTS`, `NODE_TESTS`, `PYTHON_TESTS`로 받는다. 값은 경로 하나 또는 공백으로 구분한 여러 경로이고, 각 경로는 target의 package 아래에 있다:

| Target | 변수 | 예 |
| --- | --- | --- |
| `make hyper-test-php` | `PHP_TESTS` | `make hyper-test-php PHP_TESTS="tests/CoreRulesTest.php"` |
| `make hyper-test-node` | `NODE_TESTS` | `make hyper-test-node NODE_TESTS="tests/http.test.ts"` |
| `make hyper-test-python` | `PYTHON_TESTS` | `make hyper-test-python PYTHON_TESTS="tests/test_core_rules.py"` |

선택이 있으면 recipe는 그 파일들만 target의 test runner로 실행한다. PHPUnit과 vitest는 경로를 받고, unittest는 각 파일을 그 디렉터리 아래에서 이름으로 찾으며 파일마다 명령 하나를 실행한다. `hyper-test-node`의 type check, `hyper-test-python`의 package data test, 그 밖의 test 파일은 실행하지 않는다. target의 prerequisite는 전체 실행과 같이 빌드한다. recipe는 runner를 시작하기 전에, 경로가 package의 파일을 가리키지 않으면 실패하고(예: `hyper-test-node: the selection NODE_TESTS="tests/no-such.test.ts" names no test file packages/ts/tests/no-such.test.ts (HR-84)`), `CASES`도 설정되어 있으면 실패한다. 한 실행은 case나 test 파일 중 하나를 선택하기 때문이다. unit test 파일이 소유하는 checklist 행은 이런 명령을 검증으로 적는다.

`make hyper-test-scripts`는 `tests/scripts`의 파일 선택을 `TESTS`로 받는다. 예: `make hyper-test-scripts TESTS=tests/scripts/php-ext-requires.test.mts`. 전체 실행은 먼저 `packages`, `board`, `node-server`, `ext`, `hyper-ext`를 build한다. 선택은 그중에서 그 파일들과 그것이 상대 경로로 import하는 module이 `requireBuilt`(또는 `ext`와 `hyper-ext`를 지정하는 `phpServerExtensions`)로 지정한 것만, `scripts/test-inputs.mts`가 읽는 대로 build하므로, build된 입력을 읽지 않는 선택은 아무것도 build하지 않는다(HR-85, H35.55).

선택 실행은 전체 실행의 파일인 `var/recipe/results/<runner>.txt`를 쓰지 않는다. 선택한 파일에 case runner가 있으면 `var/recipe/results/<runner>.files.txt`를 쓴다. `make recipe-check`는 세 변수 중 어느 것도 읽지 않는다. 빈 값은 전체 실행이다.

## 한 실행의 서버

`make parity`와 `make server-parity`는 `scripts/board-servers.mts`로 자기 서버를 띄운다. 모든 서버는 system이 배정하는 port에서 listen하고, 검사는 서버가 출력에 알리는 주소로 요청을 보낸다(PHP의 `Development Server (http://127.0.0.1:<port>) started`, board Node 서버의 `board on http://127.0.0.1:<port>`, `scripts/serve-edge.mts`의 `edge http://127.0.0.1:<port>`). 따라서 다른 checkout이나 session의 실행이 도는 동안에도 요청은 같은 실행의 서버에 닿는다. 서버를 띄우는 일은 시간 제한이 없는 단계다. 시작, `[<name>]`을 붙인 서버의 모든 출력 줄, 경과 시간이 붙은 주소를 출력하고, 서버가 먼저 종료하면 실패한다. 한 실행의 database와 session 디렉터리는 임시 디렉터리에 있으며, `scripts/check-parity.mts`는 그 디렉터리를 `run directory: <path>`로 출력하고 지운다.

`make e2e`도 같은 방식으로 `scripts/run-e2e.mts`를 실행한다. 이 script는 board 예제를 두 rendering 방식(API origin, edge, SSR origin)으로 실행 디렉터리의 빈 database 위에 띄우고, `tests/e2e/origins.ts`가 요구하는 `HYPER_E2E_SSR`과 `HYPER_E2E_CSR`에 주소를 담아 `--` 뒤의 명령을 실행한다. `make e2e`는 공유 test runner의 Playwright 실행을 넘기며, 이 실행은 사례마다 자체 timeout과 결과를 보고한다(H27.26). `make e2e CASES=stylesheet`는 제목이 맞는 사례를 실행하고, 선택 없는 실행은 CI에서만 한다. Playwright는 서버를 직접 띄우지 않는다. `make bench-browser`도 같은 방식으로 서버와 데이터베이스를 띄운다. 이 target들, `make parity`, `make serve-demo`, `make hyper-test-scripts`의 test가 띄우는 모든 PHP 서버는 Makefile의 `PHP_SERVER_EXTENSIONS`를 그 순서대로, 곧 json, template, hyper extension을 load한다. template extension은 json extension을 요구하고, 서버는 hyper extension을 통해 core의 규칙을 부르기 때문이다. script는 이것을 `--extension` 인자로 받고, test는 `HYPER_PHP_EXTENSIONS`에서 읽는다.

## 빌드

명령 도구 `@polyspec/hyper-cli`의 `hyper build`(HR-96)는 애플리케이션 디렉터리 하나를 한 번의 실행으로 build한다. `make board`는 그것을 checkout에서 board의 `--static` 파일 넷과 함께 `node packages/cli/bin/hyper.mjs build --app examples/board --output examples/board/build --api /api`로 실행한다. build는 무엇이든 쓰기 전에 모든 option, 매니페스트, 템플릿 규칙을 검사하고, 명령 도구가 요구하는 template package를 읽는다(HR-70). HR-34의 출력을 쓴다.

1. `public/assets/` 아래, 이름에 내용의 해시가 들어간 파일. 더하기만 하고 지우지 않는다: `templates/`에 `templates/` 아래 템플릿마다 AST 파일 하나와 예약 템플릿 `hyper/data.tpl`의 파일 하나, 클라이언트 진입 파일 `hyper-<hash>.js`와 진입 파일이 `import()`로만 불러오는 코드마다 조각 파일 `hyper-chunk-<hash>.js` 하나(HYC-16), 그리고 `--asset <name>=<path>`와 `--tailwind <source>=<name>`의 각 에셋(HR-77). 진입 파일에는 htmx, hyper 브라우저 코드, template 렌더 런타임, `app/app.json`, 템플릿 색인이 들어 있고 템플릿은 없다.
2. `<output>/client/manifest.json`: 레이아웃 코드가 읽는, `hyper`로 진입 파일의 URL과 이름마다 각 에셋의 URL(HYC-16.12). `<output>/client/assets.json`: 이 build가 쓴 모든 경로 `public/assets/...`. `<output>/client/assets.previous.json`: 그 앞에서 달랐던 마지막 build의 파일. 다음 build가 둘을 읽어 어느 목록도 남기지 않는 파일을 지운다(HR-34, HYC-16.18). 클라이언트 번들이 담는 템플릿 파일의 색인 `<output>/client/templates.index.json`.
3. `client/main.ts`가 있고 `--api`가 주어지면 `<output>/client/csr/`: CSR 배포물. `index.html`은 `<meta name="hyper-api">`, `<meta name="hyper-build">`, 진입 파일의 URL을 담은 `<meta name="hyper-entry">`, 인라인한 진입 파일을 담고 스타일시트는 담지 않는다. 브라우저가 렌더한 레이아웃의 스타일시트 링크를 적용하기 때문이다(HYC-15, HYC-16). `assets/`는 이 build의 파일 사본과 `--static`이 밝히는 `public/` 아래 파일을 그 경로에 담는다. 애플리케이션은 렌더한 레이아웃이 link하는 스타일시트를 밝히며, `make board`는 board 예제의 `public/assets/app.css`, `public/assets/reader.css`와 module script `public/assets/reader.js`, `public/assets/after-reader.js`를 밝힌다. 진입 파일에 `</script`가 들어 있으면 build는 실패하고, 인라인한 진입 파일의 해시를 담은 Content Security Policy를 출력한다.
4. `<output>/program/`: 네이티브 확장과 Python 서버가 읽는, 애플리케이션의 모든 템플릿과 예약 템플릿 `hyper/data.tpl`을 담은 `templates/`. `@polyspec/hyper/build`의 `readsFile`이 Rust core로 계산해 쓰는 모든 라우트의 read path인 `reads.json`(HY-73). 그리고 `build.json`. 프로그램은 생성된 PHP 프로그램을 담지 않으므로 `php/`도 `program.json`도 없다(HY-48.20). 세 서버가 `templates/`의 템플릿을 렌더한다.

Tailwind CSS는 `@polyspec/hyper-cli`의 의존성이므로, npm 12.2.0으로 기본값 `allow-remote=none`에서 lock을 쓰는 애플리케이션은 [Tag 릴리스](#tag-릴리스)의 npm 결함을 만난다. npm 릴리스가 수정을 담을 때까지 npm은 `@tailwindcss/oxide-wasm32-wasi`의 tarball을 `EALLOWREMOTE`로 거부한다([npm/cli#9818](https://github.com/npm/cli/pull/9818)).

build id는 HY-125.15~HY-125.17의 파일로 한 번 계산하고 `program/build.json`과 셸에 쓴다(HY-125.23). build는 build id를 받지 않는다(HY-125.21). 출력은 실행의 staging 디렉터리에서 만들고 `public/assets`, `client/`, `program/` 순서로 셸과 `build.json`을 마지막에 게시한다(HR-82). `--output` 아래에서 build는 `client/`와 `program/`만 소유한다. 출력은 커밋하지 않는다.

고정 build id가 필요한 test fixture는 같은 조립으로 만든다: `make server-fixtures`는 `scripts/fixture-program.mts`를 실행하고, 그것은 `packages/php/tests/fixtures/build.json`의 id로 `packages/cli/lib/program.mjs`의 `writeProgram`과 `writeBuildFile`을 불러 root `composer.json`이 test fixture의 namespace에 대응시키는 `packages/php/tests/build/server`에 프로그램을 쓴다. `make contract-programs`도 같은 방법으로 계약 애플리케이션을 만든다.

PHP는 Node 서버처럼 확장 `polyspec_hyper`에 있는 core의 페이지 렌더로 `templates/`를 렌더하며(HY-48.22), 그보다 먼저 json 확장 `polyspec_json`과 템플릿 확장 `polyspec_template`을 불러온다(HY-48.23).

## Node 서버

`make node-server`는 `examples/board/node/main.ts`를 esbuild로 `examples/board/build/node/server.mjs`에 bundle한다. board Node 서버는 `examples/board/public/index.php`와 같은 애플리케이션을 게시글 저장에 `node:sqlite`를 써서 제공하고, `examples/board/public`의 파일도 제공한다.

```sh
make node-server
BOARD_DB=$PWD/examples/board/var/node.db BOARD_SESSIONS=$PWD/examples/board/var/sessions BOARD_PORT=8084 node examples/board/build/node/server.mjs
```

`BOARD_PORT=0`이면 system이 port를 배정하고, 서버는 listen하는 port를 담아 `board on http://127.0.0.1:<port>`를 출력한다. `BOARD_SESSIONS`는 절대 경로의 session 디렉터리이고, `BOARD_BASE_PATH`, `BOARD_HTTPS`, `BOARD_FRAME_ANCESTORS`는 PHP에서와 같은 뜻이다. 두 서버의 `BOARD_TIME`은 새 게시글의 생성 시각을 Unix 초로 고정하므로, `make server-parity`는 같은 게시글을 비교한다. Node 서버는 `make board`의 템플릿 파일로 렌더한다(HY-54).

## PHP, Node.js, 브라우저가 같게 동작한다는 증거

| 동작 | 근거 |
|---|---|
| 유지 값 | `contracts/keep.json`을 `make test-php`와 `make test-js`가 실행한다(HY-38). |
| JSON 텍스트 | `contracts/json.json`을 `make test-php`와 `make hyper-test-node`가 실행한다. 모든 서버는 core의 `rules.json_write`로 JSON 텍스트를 쓰고 core의 `rules.json_read`로 읽는다(HY-54). |
| 라우팅 | `contracts/routes.json`을 `make test-php`와 `make test-js`가 실행한다. 렌더할 때 브라우저는 자기 라우트가 서버가 보고한 라우트와 같은지도 확인한다(HYC-1). |
| 문서 렌더 | `make parity`는 비교 단계마다 같은 세션에서 HTML 문서, 문서 JSON, 영역 JSON을 요청한다. 라우트 영역, 내장 데이터, `server`와 `cookie` 유지 값(HY-30, HY-31, HY-38)을 포함한 문서 JSON의 브라우저 렌더 결과는 응답마다 다른 가린 CSRF 토큰(HY-24)을 각 응답에서 `<csrf>`로 바꾼 뒤 PHP 문서와 바이트 단위로 같아야 하고, 영역 JSON의 모든 부분이 그 문서에 나타나야 한다. 검사는 단계가 시작할 때 한 줄을, 끝나면 결과와 경과 밀리초를 출력한다. 10초 안에 응답이 없는 요청은 그 단계의 이름으로 실패하고 검사를 끝낸다. |
| Node 서버 | `make server-parity`는 parity 단계의 모든 요청을 각자 데이터베이스와 session을 가진 PHP 서버와 board Node 서버에 보내고, session 식별자, 응답마다 가린 CSRF token, `ETag` 값을 placeholder로 바꾼 뒤 상태, header, body가 같은지 확인한다(HR-55). |
| 브라우저에서의 동작 | `make e2e`는 SSR과 CSR에서 같은 흐름을 실행한다. 이동, 액션, 데이터 요청 없는 `hy-set` 변경, 새로고침과 새 탭에서의 유지 종류 네 가지, 라우트에 필요한 템플릿만 불러오기, 페이지를 보이기 전에 불러오고 다른 페이지가 link하지 않으면 제거하는 layout의 stylesheet link(HYC-15), SSR body와 CSR body가 같은지 확인하는 비교 페이지를 포함한다. |

## 측정한 크기

2026-10-15에 `make bundle-size`로 측정했다(htmx 4.0.0, esbuild 0.28.2, template 0.0.12, 게시판 템플릿 10개와 `hyper/data.tpl`).

| 출력 | 원본 바이트 | gzip 바이트 | brotli 바이트 | gzip 상한 |
|---|---:|---:|---:|---:|
| SSR 스크립트 `hyper-<hash>.js` | 108,828 | 35,488 | 31,568 | 35,900 |
| CSR 셸 `build/client/csr/index.html` | 109,067 | 35,623 | 31,649 | 36,000 |
| chunk `hyper-chunk-<hash>.js`(template decoder), 각각 따로 압축 | 86,654 | 7,610 | 5,894 | 7,700 |
| 가장 큰 템플릿 파일(`board/rows.tpl`) | 5,583 | 1,337 | 1,084 | 4,096 |
| 템플릿 파일 11개 합계 | | 5,898 | | |

`config/bundle-size.json`의 SSR 스크립트, CSR 셸, chunk 상한은 측정한 gzip 크기에 약 1%를 더하고 100바이트 단위로 올린 값이다. 2026-10-05의 상한은 gzip 33,080 바이트(원본 99,580)인 script에 대해 33,500과 33,600이었으며, 증가가 필요한 이유는 다음과 같다(H23.24).

- board는 가져오는 각 템플릿 파일을 `@polyspec/template/decode`의 `decodeTemplate`으로 decode한다. JSON이 실행 시 신뢰 경계를 넘고, kit의 type-checked lint가 cast로 읽는 것을 금지하기 때문이다(H23.13). decoder는 원본 86,639 바이트, gzip 약 7,600 바이트이다. board는 템플릿 fetcher에서 그것을 `import()`로 불러오므로 chunk이다(HYC-16). 템플릿을 불러오지 않는 서버 렌더 페이지(HYC-12)는 그것을 불러오지 않고, static shell은 첫 템플릿과 함께 불러온다.
- entry의 프로토콜 코드는 2026-10-05와 릴리스 0.0.17 사이에 같은 htmx로 gzip 약 1,800 바이트 커졌다. `@polyspec/hyper-client`의 영역 렌더, 응답 decode, 유지 값, stylesheet, 라우팅이며, template 0.0.12의 render runtime은 0.0.6보다 gzip 약 500 바이트 크다. entry는 minify 뒤 원본 바이트로 `@polyspec/template`의 render runtime 40,623, `htmx.org` 36,592, `@polyspec/hyper-client` 28,703(`hyper.js` 13,737, `response.js` 4,385, `manifest.js` 3,224, `keep.js` 2,044, `router.js` 1,948, `stylesheets.js` 1,605, `templates.js` 1,065, `obtain.js` 699), board 2,098과 index 771을 담는다. 따로 압축하면 htmx는 gzip 13,240 바이트, render runtime은 12,734 바이트이다.

상한을 넘는 크기는 실패가 아니라 warning이다(AGENTS). 출력이 상한보다 커지는 변경은 같은 변경 안에서 상한을 고치고 그 증가가 필요한 이유를 적는다. 출력이 작아지는 변경은 같은 규칙으로 상한을 낮춘다.

브라우저는 렌더가 닿는 템플릿만 불러오고(HYC-12), 템플릿 파일은 해시가 붙은 이름으로 캐시된다. 템플릿 AST는 노드마다 소스 위치를 기록하므로 압축 후 크기가 소스의 약 2배다. `config/bundle-size.json`은 템플릿 파일 하나를 4,096 gzip 바이트로 제한하므로, 이보다 커지는 템플릿은 블록으로 나눈다.

Package virtual environment를 사용하는 Python discovery를 포함해 모든 runtime test target은 설치된 Kit runner를 사용한다. 범위를 제한한 Python 검사는 정확한 discovery 파일명 또는 `--cwd`와 dotted module 이름을 사용하며 앱 전용 unittest harness는 없다. 지원하지 않거나 잘못된 runner 동작은 runner를 교체하거나 CI 식별을 바꾸는 대신 Kit GitHub issue로 보고한다. 완료된 과거 검증 기록의 원래 명령은 유지하며 현재 실행 지침으로 사용하지 않는다.

`.github/workflows`의 모든 workflow와 action `.github/actions/bootstrap`은 hyper의 파일이며, 그 명령 step은 각각 Makefile의 target 하나를 실행한다.
