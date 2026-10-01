# 의존성

[English](dependencies.md).

모든 의존성은 선언한 런타임 범위(Node.js 26, PHP 8.2)를 지원하는 최신 안정 버전을 사용한다. 정확한 버전 고정은 그 이유와 고정을 해제하는 조건을 기록한다.

| 의존성 | 버전 | 종류 | 이유 | 해제 조건 |
|---|---|---|---|---|
| `htmx.org` | `4.0.0` 정확히 고정 | 런타임, 클라이언트 스크립트에 번들 | 영역 프로토콜은 htmx 4의 훅, 요청 컨텍스트 필드, 스왑 동작을 사용하며, 이를 4.0.0 소스로 확인했다. npm은 4.0.0에 `next` 태그를 붙이고 2.x를 `latest`로 유지하므로, 고정하지 않은 범위는 htmx 2를 선택한다. | npm이 htmx 4 릴리스에 `latest` 태그를 붙이면 `^4` 범위를 사용하고 `make check`를 다시 실행한다. |
| `@playwright/test`, `@types/node`, `esbuild`, `typescript`, `vitest` | 정확히 고정 | 개발 | `npm ci`가 같은 도구를 설치하도록 작업 공간이 개발 도구 버전을 정확히 고정한다. | 각 도구를 최신 안정 버전으로 올리고 `make check`를 다시 실행한다. |
| `laravel/pint` | `^1.0`, 1.30.4로 해석 | 개발 | Pint 1.31 이후 버전은 PHP 8.3을 요구하고, Composer 플랫폼은 PHP 8.2다. | 지원 PHP 범위가 8.3부터 시작할 때. |
| `phpunit/phpunit` | `^11.5` | 개발 | PHPUnit 12 이후 버전은 PHP 8.3을 요구한다. | 지원 PHP 범위가 8.3부터 시작할 때. |
| `@polyspec/hyper-server`의 `@polyspec/hyper` | `0.0.1` 정확히 | 런타임 | Node 서버는 같은 workspace의 브라우저 package로 렌더하므로 그 정확한 버전을 요구한다. | package가 배포되어 한 버전 범위로 함께 출시될 때. |
| `@polyspec/template`, `polyspec/template` | 로컬 경로 | 런타임 | template 패키지가 배포되지 않았으므로 `../template`에서 사용한다. Composer는 `polyspec/template`을 복사해 설치한다(`symlink: false`). 링크로 설치하면 Composer가 `bin` 파일에 실행 권한을 부여해 template 저장소를 수정하기 때문이다. template PHP 패키지를 바꾼 뒤에는 두 Composer 프로젝트에서 `composer reinstall polyspec/template`을 실행한다. `composer update`는 reference가 바뀌지 않은 path package의 기존 복사본을 그대로 둔다. | template 패키지가 npm과 Packagist에 배포될 때. |
