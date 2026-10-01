# 개발

[English](development.md).

## 도구

- Node.js 26.8.1(`.node-version`)
- `pdo_sqlite`가 있는 PHP 8.2 이상
- Composer 2
- `../template`에 있는 template 저장소. `make template`이 그 TypeScript 패키지를 빌드하며, 브라우저 코드가 이 패키지를 가져온다.
- 네이티브 템플릿 확장을 `make ext`로 빌드할 Rust(template 저장소가 고정한 버전)
- Playwright용 Chromium: `npx playwright install chromium`

## 타깃

| 타깃 | 동작 |
|---|---|
| `make install` | npm과 Composer 의존성을 설치한다 |
| `make template` | TypeScript template 패키지를 빌드하고, PHP template 패키지의 Composer 복사본을 다시 설치한다. 테스트, 에셋, 서버 빌드가 먼저 실행한다 |
| `make template-check` | PHP template 패키지의 Composer 복사본이 template 저장소와 다르면 실패한다 |
| `make ext` | template 저장소의 네이티브 템플릿 확장을 `build/ext`에 빌드한다(HY-48) |
| `make server` | 게시판 서버 프로그램을 `examples/board/build/server`에 빌드한다(아래 참조) |
| `make server-fixtures` | PHP 테스트 픽스처의 서버 프로그램을 빌드한다 |
| `make node-fixtures` | `scripts/build-templates.mjs`로 Node 서버 test에 쓸 PHP test fixture의 템플릿 파일을 빌드한다 |
| `make node-server` | board Node 서버를 타입 검사하고 `examples/board/build/node/server.mjs`로 bundle한다(아래 참조) |
| `make assets` | 게시판 클라이언트 번들과 CSR 셸을 빌드한다(아래 참조) |
| `make test-js` | 라우터 적합성 사례를 포함한 브라우저 코드 테스트와 타입 검사를 실행한다 |
| `make test-node` | Node 서버 test를 실행한다. 같은 fixture로 PHP 서버 test의 사례, `conformance/json.json`의 JSON 사례, session, HTTP 서버, 타입 검사를 실행한다 |
| `make test-php` | 라우터 적합성 사례를 포함한 서버 패키지 테스트를 generated 프로그램으로 한 번, 네이티브 확장으로 한 번 실행한다 |
| `make lint` | PHP 형식을 검사한다 |
| `make templates-check` | 레이아웃 템플릿만 `hx-` 속성을 가지는지(HC-6), 레이아웃이 `{# title}`과 `{# data}`를 한 번씩 배치하는지, 레이아웃과 각 라우트 템플릿의 모든 영역이 블록 인자 없이 `id`가 영역 이름인 요소 바로 안에 한 번씩 배치되는지(HY-3, HY-30) 검사한다 |
| `make test-scripts` | 검사 스크립트의 테스트를 실행한다. 예: 잘못된 픽스처 애플리케이션으로 영역 배치 검사를 시험한다 |
| `make parity` | PHP 문서와, 문서 JSON과 영역 JSON의 브라우저 렌더 결과를 비교한다. generated 프로그램으로 한 번, 네이티브 확장으로 한 번 실행한다 |
| `make server-parity` | parity 단계를 PHP 서버와 board Node 서버에 실행해 모든 응답의 상태, header, body를 비교하고, `make parity`의 브라우저 비교도 수행한다(HY-55) |
| `make bundle-size` | SSR 스크립트와 CSR 셸 크기를 출력하고 `config/bundle-size.json`의 gzip 상한을 적용한다 |
| `make e2e` | SSR, CSR, JavaScript 없는 흐름, 비교 흐름을 Chromium에서 실행한다 |
| `make docs-check` | 문서 쌍, 링크, 코드 블록을 검사한다 |
| `make serve-demo` | SSR, CSR, 비교 페이지를 실행한다([배포](deployment.ko.md) 참조) |
| `make bench-server-smoke` | PHP 측정기를 측정마다 한 번씩 실행한다. 측정기를 깨는 변경이 실패하도록 `make check`에 들어 있다 |
| `make bench` | 서버와 브라우저 성능을 보고하는 `make bench-server`와 `make bench-browser`를 실행한다([성능 측정](benchmark.ko.md) 참조). `make check`에는 포함하지 않는다 |
| `make check` | 위의 모든 검사를 실행한다 |

## 서버 빌드

`scripts/build-server.mjs --manifest <app.json> --templates <directory> --output <directory> --template-dir <template repository> --php-namespace <namespace>`는 서버 프로그램을 만든다(HY-48).

1. `templates/`: 애플리케이션의 모든 템플릿과 예약 템플릿 `hyper/data.tpl`. 네이티브 확장이 이 파일을 읽는다.
2. `program.php`: 같은 템플릿을 template 저장소의 컴파일러로, 주어진 PHP 네임스페이스(게시판은 `Polyspec\Hyper\Examples\Board\Program`)에 컴파일한 generated PHP 프로그램. `program.json`은 그 네임스페이스를 기록하며, 렌더러가 이 파일을 읽는다. 서버가 각 영역을 단독으로 렌더하므로, 모든 템플릿은 대상으로 렌더되고 모든 정의는 HTML이다.

PHP가 `polyspec_template`을 불러왔으면 네이티브 확장으로, 그렇지 않으면 `program.php`로 렌더한다. 두 출력은 같은 원본에서 만들어지므로, 서버는 확장을 불러오는지 여부만으로 엔진을 바꿀 수 있다.

## Node 서버

`make node-server`는 `examples/board/node/main.ts`를 esbuild로 `examples/board/build/node/server.mjs`에 bundle한다. board Node 서버는 `examples/board/public/index.php`와 같은 애플리케이션을 게시글 저장에 `node:sqlite`를 써서 제공하고, `examples/board/public`의 파일도 제공한다.

```sh
make node-server
BOARD_DB=$PWD/examples/board/var/node.db BOARD_SESSIONS=$PWD/examples/board/var/sessions BOARD_PORT=8084 node examples/board/build/node/server.mjs
```

`BOARD_SESSIONS`는 절대 경로의 session 디렉터리이고, `BOARD_BASE_PATH`, `BOARD_HTTPS`, `BOARD_FRAME_ANCESTORS`는 PHP에서와 같은 뜻이다. 두 서버의 `BOARD_TIME`은 새 게시글의 생성 시각을 Unix 초로 고정하므로, `make server-parity`는 같은 게시글을 비교한다. Node 서버는 `make assets`의 템플릿 파일로 렌더한다(HY-54).

## 에셋 빌드

`scripts/build-assets.mjs --app <디렉터리> --api <기본 경로>`는 다음을 쓴다.

1. `public/assets/templates/<name>.<hash>.json`: `templates/` 아래 템플릿마다 AST 파일 하나, 그리고 예약 템플릿 `hyper/data.tpl`의 파일 하나(HY-34).
2. `build/templates.index.json`: 각 템플릿 이름과 그 파일 URL, 그리고 include 태그와 block 태그가 경로로 참조하는 템플릿 목록.
3. `public/assets/hyper-<hash>.js`와 `public/assets/manifest.json`: 클라이언트 번들과, 서버가 레이아웃에 넘기는 URL. 번들에는 htmx, hyper 브라우저 코드, template 렌더 런타임, `app/app.json`, 색인이 들어 있고 템플릿은 없다.
4. `dist/csr/`: CSR 배포물.
   - `index.html`은 `<meta name="hyper-api">`를 가지고 스타일시트와 번들을 인라인한다.
   - `assets/templates/`는 템플릿 파일을 담는다.
   - 번들에 `</script`가 들어 있으면 빌드는 실패하고, 빌드는 인라인 스크립트와 스타일시트의 Content Security Policy 해시를 출력한다.

빌드는 이전 결과를 교체하므로, 반복해서 빌드해도 결과마다 파일이 하나만 남는다. 빌드 결과는 커밋하지 않는다.

## PHP, Node.js, 브라우저가 같게 동작한다는 증거

| 동작 | 근거 |
|---|---|
| 유지 값 | `conformance/keep.json`을 `make test-php`와 `make test-js`가 실행한다(HY-38). |
| JSON 텍스트 | `conformance/json.json`을 `make test-php`와 `make test-node`가 실행한다. Node 서버는 PHP `json_encode`의 바이트를 쓰고 유지 값을 PHP `json_decode`처럼 읽는다(HY-54). |
| 라우팅 | `conformance/routes.json`을 `make test-php`와 `make test-js`가 실행한다. 렌더할 때 브라우저는 자기 라우트가 서버가 보고한 라우트와 같은지도 확인한다(HY-20). |
| Node 서버 | `make server-parity`는 parity 단계의 모든 요청을 각자 데이터베이스와 session을 가진 PHP 서버와 board Node 서버에 보내고, session 식별자, CSRF token, `ETag` 값을 placeholder로 바꾼 뒤 상태, header, body가 같은지 확인한다(HY-55). |
| 문서 렌더 | `make parity`는 비교 단계마다 같은 세션에서 HTML 문서, 문서 JSON, 영역 JSON을 요청한다. 라우트 영역, 내장 데이터, `server`와 `cookie` 유지 값(HY-30, HY-31, HY-38)을 포함한 문서 JSON의 브라우저 렌더 결과는 PHP 문서와 바이트 단위로 같아야 하고, 영역 JSON의 모든 부분이 그 문서에 나타나야 한다. |
| 브라우저에서의 동작 | `make e2e`는 SSR과 CSR에서 같은 흐름을 실행한다. 이동, 액션, 데이터 요청 없는 `hy-set` 변경, 새로고침과 새 탭에서의 유지 종류 네 가지, 라우트에 필요한 템플릿만 불러오기, SSR body와 CSR body가 같은지 확인하는 비교 페이지를 포함한다. |

## 측정한 크기

2026-10-02에 `make bundle-size`로 측정했다(htmx 4.0.0, esbuild 0.28.2, 게시판 템플릿 10개와 `hyper/data.tpl`).

| 출력 | 원본 바이트 | gzip 바이트 | brotli 바이트 | gzip 상한 |
|---|---:|---:|---:|---:|
| SSR 스크립트 `hyper-<hash>.js` | 94,778 | 31,586 | 28,251 | 31,900 |
| CSR 셸 `dist/csr/index.html` | 98,283 | 32,892 | 29,213 | 33,200 |
| 가장 큰 템플릿 파일(`board/rows.tpl`) | 5,569 | 1,325 | 1,077 | 4,096 |
| 템플릿 파일 11개 합계 | | 5,635 | | |

`config/bundle-size.json`의 SSR 스크립트와 CSR 셸 상한은 측정한 gzip 크기에 약 1%를 더하고 100바이트 단위로 올린 값이다. 출력이 상한보다 커지는 변경은 같은 변경 안에서 상한을 고치고 그 증가가 필요한 이유를 적는다. 출력이 작아지는 변경은 같은 규칙으로 상한을 낮춘다.

라우트는 자기 템플릿만 불러오고(HY-35), 템플릿 파일은 해시가 붙은 이름으로 캐시된다.
- 템플릿 AST는 노드마다 소스 위치를 기록하므로 압축 후 크기가 소스의 약 2배다.
- `config/bundle-size.json`은 템플릿 파일 하나를 4,096 gzip 바이트로 제한한다. 이보다 커지는 템플릿은 블록으로 나눈다.
