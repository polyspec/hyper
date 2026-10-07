# 의존성

[English](dependencies.md).

모든 의존성은 선언한 런타임 범위(Node.js 26, PHP 8.2)를 지원하는 최신 안정 버전을 사용한다. 정확한 버전 고정은 그 이유와 고정을 해제하는 조건을 기록한다.

| 의존성 | 버전 | 종류 | 이유 | 해제 조건 |
|---|---|---|---|---|
| Node.js, npm, PHP, Composer | `.node-version` 26.8.1, `packageManager` npm 12.2.0, `config/toolchain.json`의 정확한 Composer 2.10.3과 minor인 PHP 8.5. make는 pin하지 않는다 | 도구 | 같은 도구로만 build와 검사가 같은 결과를 낸다(HY-81). npm 12는 `npm pack --json`을 npm 11과 다르게 출력한다. | 없음. 새 release는 pin을 바꾸는 commit이 된다. PHP patch release는 통과하고 full run이 그것을 기록한다. |
| `htmx.org` | `4.0.0` 정확히 고정 | 런타임, 클라이언트 스크립트에 번들 | 영역 프로토콜은 htmx 4의 훅, 요청 컨텍스트 필드, 스왑 동작을 사용하며, 이를 4.0.0 소스로 확인했다. npm은 4.0.0에 `next` 태그를 붙이고 2.x를 `latest`로 유지하므로, 고정하지 않은 범위는 htmx 2를 선택한다. | npm이 htmx 4 릴리스에 `latest` 태그를 붙이면 `^4` 범위를 사용하고 `make check`를 다시 실행한다. |
| `@playwright/test`, `@types/node`, `esbuild`, `typescript`, `vitest` | 정확히 고정 | 개발 | `npm ci`가 같은 도구를 설치하도록 root package가 개발 도구 버전을 정확히 고정한다. | 각 도구를 최신 안정 버전으로 올리고 `make check`를 다시 실행한다. |
| `laravel/pint` | `^1.0`, 1.30.4로 해석 | 개발 | Pint 1.31 이후 버전은 PHP 8.3을 요구하고, Composer 플랫폼은 PHP 8.2다. | 지원 PHP 범위가 8.3부터 시작할 때. |
| `phpunit/phpunit` | `^11.5` | 개발 | PHPUnit 12 이후 버전은 PHP 8.3을 요구한다. | 지원 PHP 범위가 8.3부터 시작할 때. |
| `phpstan/phpstan` | `^2.2.16` | 개발 | 최신 안정 릴리스다. PHPStan 2.2는 PHP 7.4 이후를 지원하므로 이 범위에는 호환성 고정이 없다. | 없음. |
| `@polyspec/hyper-server`의 `@polyspec/hyper` | `0.0.1` 정확히 | 런타임 | Node 서버는 같은 저장소의 브라우저 package로 렌더하므로 그 정확한 버전을 요구한다. root package는 이것을 `packages/hyper-js`의 사본으로 override한다(HY-79). | package가 배포되어 한 버전 범위로 함께 출시될 때. |
| `@polyspec/template`, `polyspec/template` | 로컬 경로, tag `v0.0.1` | 런타임 | template 패키지가 배포되지 않았으므로 `make template`이 `../template`에서 쓰는 선언한 복사본 `var/products/template`에서 사용한다(HY-78). 복사본은 template 저장소의 tag `TEMPLATE_TAG`(`v0.0.1`)의 commit이므로, template release는 Makefile의 `TEMPLATE_TAG`가 그 tag를 밝힐 때 이 저장소에 들어온다(HY-80). npm은 `@polyspec/template`을 사본으로 설치한다(`.npmrc`의 `install-links=true`, root 의존성, workspace package의 override). link는 build가 `dist`를 비우는 template checkout을 읽기 때문이다. Composer는 `polyspec/template`을 복사해 설치하므로(`symlink: false`, `reference: config`, version `dev-main`) lock file은 복사본의 내용이나 이 저장소의 branch에 따라 바뀌지 않는다. 두 package manager 모두 version과 reference가 같은 path package를 다시 설치하지 않으므로, `make template`은 `scripts/publish.mjs`로 npm 사본과 두 Composer 사본에 바뀐 파일을 publish하고, package의 의존성이 바뀌었으면 설치 명령을 밝히며 실패한다(HY-82). | template 패키지가 npm과 Packagist에 배포될 때. |
| `docker.io/library/node:26.8.1-trixie-slim` | digest `sha256:c0753125a3789977aefe869cbebccf70e3cfd7ea84ca48547458f02e4f1d7146` | 테스트 | `tests/scripts/output-files.test.mjs`는 bind mount가 virtiofs인 Apple `container`의 Linux container에서 workspace의 Node 버전으로 build 복사를 실행한다(HY-68). digest는 테스트가 실행된 image를 고정한다. | Node 26.8.1이 더 이상 선언된 Node 버전이 아닐 때. 그때 새 버전의 image를 고정한다. |
