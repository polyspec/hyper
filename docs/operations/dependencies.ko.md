<!-- doc-id: dependencies -->
<!-- source-sha256: da0c9ef6036afa2e7ce67658a1d0f944dfabfd541778f6350f65e5bc2a75d6bc -->
# 의존성

[English](dependencies.md).

모든 의존성은 선언한 런타임 범위(Node.js 26, PHP 8.2)를 지원하는 최신 안정 버전을 사용한다. 정확한 버전 고정은 그 이유와 고정을 해제하는 조건을 기록한다.

2026-10-08의 검토(`make dependency-review UPDATE=1`)는 `@playwright/test`를 1.64.0으로, `@types/node`를 26.6.4로, `phpstan/phpstan`을 2.3.1로, `phpunit/phpunit`을 11.5.57로 올렸다. `config/dependency-policy.json`은 검토가 읽는 Composer와 Python manifest를 밝히고, `make dependency-review RECORD=1`은 검토 기록 `config/dependency-review.json`을 쓴다.

| 의존성 | 버전 | 종류 | 이유 | 해제 조건 |
|---|---|---|---|---|
| Node.js, npm, PHP, Composer | `.node-version` 26.8.1, `packageManager` npm 12.2.0, `config/toolchain.json`의 정확한 Composer 2.10.3과 `.php-version`의 minor인 PHP 8.5. make는 pin하지 않는다 | 도구 | 같은 도구로만 build와 검사가 같은 결과를 낸다(HY-81). npm 12는 `npm pack --json`을 npm 11과 다르게 출력한다. | 없음. 새 release는 pin을 바꾸는 commit이 된다. PHP patch release는 통과하고 full run이 그것을 기록한다. |
| Python | `.python-version` 3.14, `packages/hyper-server-python`의 `requires-python >= 3.11` | 도구 | Python 서버 package가 3.11과 최신 안정 release에서 돈다. CI가 둘 다 돌린다(H15.3). | 없음. 새 안정 release는 `.python-version`을 바꾸는 commit이 된다. |
| `packages/hyper-server-python/pyproject.toml`의 `setuptools` | `84.0.0` 정확히 고정 | build | `polyspec-hyper-server`의 build backend다. 같은 backend release로 build하도록 정확히 고정한다. 다른 저장소의 Python 패키지 `polyspec-ordered-json`과 `polyspec-template`이 고정한 release와 같아서, Python 패키지들이 build backend를 공유한다 (H15.3-13). | 더 새로운 stable setuptools release를 채택하는 dependency 검토에서 pin을 바꾸고, 그 pin을 고정한 형제 Python 패키지도 같은 변경에서 바꾼다. |
| `pyproject.toml`의 `polyspec-template` (`packages/hyper-server-python`) | `polyspec/template`의 git tag `v0.0.5` (`git+https://github.com/polyspec/template@v0.0.5#subdirectory=packages/template-python`) | runtime | 0.1 전에는 polyspec package를 registry에 올리지 않으므로 GitHub tag에서 설치합니다. `v0.0.5`는 `packages/template-python`을 담는 template tag입니다. | polyspec가 Python 패키지를 registry에 올릴 때 기록을 지웁니다. |
| `htmx.org` | `4.0.0` 정확히 고정 | 런타임, 클라이언트 스크립트에 번들 | 영역 프로토콜은 htmx 4의 훅, 요청 컨텍스트 필드, 스왑 동작을 사용하며, 이를 4.0.0 소스로 확인했다. npm은 4.0.0에 `next` 태그를 붙이고 2.x를 `latest`로 유지하므로, 고정하지 않은 범위는 htmx 2를 선택한다. | npm이 htmx 4 릴리스에 `latest` 태그를 붙이면 `^4` 범위를 사용하고 `make check`를 다시 실행한다. |
| `@playwright/test`, `@types/node`, `esbuild`, `typescript`, `vitest` | 정확히 고정 | 개발 | `npm ci`가 같은 도구를 설치하도록 root package가 개발 도구 버전을 정확히 고정한다. | 각 도구를 최신 안정 버전으로 올리고 `make check`를 다시 실행한다. |
| `laravel/pint` | `^1.0`, 1.30.4로 해석 | 개발 | Pint 1.31 이후 버전은 PHP 8.3을 요구하고, Composer 플랫폼은 PHP 8.2다. | 지원 PHP 범위가 8.3부터 시작할 때. |
| `phpunit/phpunit` | `^11.5.57` | 개발 | PHPUnit 12 이후 버전은 PHP 8.3을 요구한다. | 지원 PHP 범위가 8.3부터 시작할 때. |
| `phpstan/phpstan` | `^2.3.1` | 개발 | 최신 안정 릴리스다. PHPStan 2.3은 PHP 7.4 이후를 지원하므로 이 범위에는 호환성 고정이 없다. | 없음. |
| `@polyspec/hyper-server`와 `@polyspec/hyper-build`의 `@polyspec/hyper-client` | `0.0.7` 정확히 | 런타임, build | Node 서버는 같은 저장소의 브라우저 package로 렌더하고, build package는 그것으로 manifest를 검사하고 read path를 계산하며 예약 템플릿 `hyper/data.tpl`을 읽으므로, 둘 다 그 정확한 버전을 요구한다. root package는 이것을 `packages/hyper-client`의 사본으로 override한다(HY-79). | package가 배포되어 한 버전 범위로 함께 출시될 때. |
| `@polyspec/hyper-build`의 `esbuild`, `tailwindcss`, `@tailwindcss/node`, `@tailwindcss/oxide` | 정확히 고정 | build | build package는 client entry를 esbuild로 bundle하고 `--tailwind`의 stylesheet를 Tailwind CSS로 compile하므로(HY-77, HY-96), consumer는 이 저장소의 test가 실행한 릴리스로 빌드한다. root package는 Tailwind CSS 패키지를 `@polyspec/hyper-build`를 통해 설치하고, esbuild는 `make node-server`를 위해 직접 요구한다. | 각 도구를 최신 안정 버전으로 올리고 `make check`를 다시 실행한다. |
| `@polyspec/template`, `@polyspec/template-compiler`, `polyspec/template` | tag `v0.0.5`의 release asset | 런타임, build | template 패키지가 npm과 Packagist에 없으므로, npm은 `@polyspec/template`과 `@polyspec/template-compiler`를 template 저장소의 GitHub Release `v0.0.5`의 tarball에서 URL로 설치하고 `package-lock.json`이 그 integrity로 고정한다(`.npmrc`의 `allow-remote=root`, root 의존성, workspace package의 override). Composer는 private root `composer.json`과 `examples/board/composer.json`의 sha1 `shasum`을 가진 `package` repository로 그 release의 zip에서 `polyspec/template`을 설치한다(HY-70). 공개 manifest는 정확한 version `0.0.5`를 요구한다. 네이티브 확장은 `make install`이 가져오고 `config/template-ext.json`이 sha256으로 pin한 tag `TEMPLATE_TAG`(`v0.0.5`)의 php-ext asset에서 온다(HY-78, H14.1-7). | template 패키지가 npm과 Packagist에 배포될 때. |
| `docker.io/library/node:26.8.1-trixie-slim` | digest `sha256:c0753125a3789977aefe869cbebccf70e3cfd7ea84ca48547458f02e4f1d7146` | 테스트 | `tests/scripts/output-files.test.mjs`는 bind mount가 virtiofs인 Apple `container`의 Linux container에서 workspace의 Node 버전으로 build 복사를 실행한다(HY-68). digest는 테스트가 실행된 image를 고정한다. | Node 26.8.1이 더 이상 선언된 Node 버전이 아닐 때. 그때 새 버전의 image를 고정한다. |
