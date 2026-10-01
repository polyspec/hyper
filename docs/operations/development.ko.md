# 개발

[English](development.md).

## 도구

- Node.js 26.8.1(`.node-version`)
- `pdo_sqlite`가 있는 PHP 8.2 이상
- Composer 2
- `../template`에 있는 template 저장소. `make template`이 그 TypeScript 패키지를 빌드하며, 브라우저 코드가 이 패키지를 가져온다.
- Playwright용 Chromium: `npx playwright install chromium`

## 타깃

| 타깃 | 동작 |
|---|---|
| `make install` | npm과 Composer 의존성을 설치한다 |
| `make template` | TypeScript template 패키지를 빌드한다 |
| `make assets` | 게시판 클라이언트 번들과 CSR 셸을 빌드한다(아래 참조) |
| `make test-js` | 라우터 적합성 사례를 포함한 브라우저 코드 테스트와 타입 검사를 실행한다 |
| `make test-php` | 라우터 적합성 사례를 포함한 서버 패키지 테스트를 실행한다 |
| `make lint` | PHP 형식을 검사한다 |
| `make templates-check` | 레이아웃 템플릿만 `hx-` 속성을 가지는지 검사한다(HC-6) |
| `make parity` | PHP 문서와, 문서 JSON과 영역 JSON의 브라우저 렌더 결과를 비교한다 |
| `make bundle-size` | SSR 스크립트와 CSR 셸 크기를 출력하고 `config/bundle-size.json`의 gzip 상한을 적용한다 |
| `make e2e` | SSR, CSR, JavaScript 없는 흐름, 비교 흐름을 Chromium에서 실행한다 |
| `make docs-check` | 문서 쌍, 링크, 코드 블록을 검사한다 |
| `make serve-demo` | SSR, CSR, 비교 페이지를 실행한다([배포](deployment.ko.md) 참조) |
| `make check` | 위의 모든 검사를 실행한다 |

## 에셋 빌드

`scripts/build-assets.mjs --app <디렉터리> --api <기본 경로>`는 `client/main.ts`를 한 번 번들한다. 번들에는 htmx, hyper 브라우저 코드, template 렌더 런타임, `app/app.json`, 모든 템플릿 AST가 들어 있다. 빌드는 다음을 쓴다.

1. `build/templates.ast.json`: `templates/` 아래의 모든 `.tpl` 파일을 AST로 파싱한 묶음이다. 키는 `templates/` 기준 상대 이름이다.
2. `public/assets/hyper-<hash>.js`와 `public/assets/manifest.json`: SSR 스크립트와, 서버가 레이아웃에 넘기는 URL이다.
3. `dist/csr/index.html`: `<meta name="hyper-api">`를 가지고 스타일시트와 번들을 인라인한 CSR 셸이다.
   - 번들에 `</script`가 들어 있으면 빌드는 실패한다.
   - 빌드는 인라인 스크립트와 스타일시트의 Content Security Policy 해시를 출력한다.

빌드는 이전 결과를 교체한다. 그래서 반복해서 빌드해도 결과마다 파일이 하나만 남는다. 빌드 결과는 커밋하지 않는다.

## PHP와 브라우저가 같게 동작한다는 증거

| 동작 | 근거 |
|---|---|
| 라우팅 | `conformance/routes.json`을 `make test-php`와 `make test-js`가 실행한다. 렌더할 때 브라우저는 자기 라우트가 서버가 보고한 라우트와 같은지도 확인한다(HY-20). |
| 문서 렌더 | `make parity`는 비교 단계마다 같은 세션에서 HTML 문서, 문서 JSON, 영역 JSON을 요청한다. 문서 JSON의 브라우저 렌더 결과는 PHP 문서와 바이트 단위로 같아야 하고, 영역 JSON의 모든 부분이 그 문서에 나타나야 한다. |
| 브라우저에서의 동작 | `make e2e`는 같은 흐름을 SSR과 CSR에서 실행한다. 비교 페이지는 첫 렌더 뒤와 두 프레임에서 이동한 뒤에 SSR body와 CSR body가 같은지 확인한다. |

## 측정한 크기

2026-10-01에 `make bundle-size`로 측정했다(htmx 4.0.0, esbuild 0.28.2, 게시판 템플릿 7개).

| 결과 | 원본 바이트 | gzip 바이트 | brotli 바이트 |
|---|---:|---:|---:|
| SSR 스크립트 `hyper-<hash>.js` | 88,319 | 28,930 | 25,835 |
| CSR 셸 `dist/csr/index.html` | 90,800 | 29,905 | 26,521 |

- 템플릿 AST는 노드마다 소스 위치를 기록하므로 압축 후 크기가 소스의 약 2배다.
- template 파서를 함께 보내면 약 8KB(gzip)가 늘어난다.
- 따라서 템플릿 소스가 약 8KB(gzip)에 이르기 전까지는 AST를 보내는 편이 소스와 파서를 보내는 것보다 작다.
