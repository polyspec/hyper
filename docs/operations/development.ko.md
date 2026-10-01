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
| `make templates-check` | 레이아웃 템플릿만 `hx-` 속성을 가지는지(HC-6), 레이아웃이 `{# title}`, `{# data}`, 모든 매니페스트 영역을 한 번씩 배치하는지(HY-3) 검사한다 |
| `make parity` | PHP 문서와, 문서 JSON과 영역 JSON의 브라우저 렌더 결과를 비교한다 |
| `make bundle-size` | SSR 스크립트와 CSR 셸 크기를 출력하고 `config/bundle-size.json`의 gzip 상한을 적용한다 |
| `make e2e` | SSR, CSR, JavaScript 없는 흐름, 비교 흐름을 Chromium에서 실행한다 |
| `make docs-check` | 문서 쌍, 링크, 코드 블록을 검사한다 |
| `make serve-demo` | SSR, CSR, 비교 페이지를 실행한다([배포](deployment.ko.md) 참조) |
| `make check` | 위의 모든 검사를 실행한다 |

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

## PHP와 브라우저가 같게 동작한다는 증거

| 동작 | 근거 |
|---|---|
| 유지 값 | `conformance/keep.json`을 `make test-php`와 `make test-js`가 실행한다(HY-38). |
| 라우팅 | `conformance/routes.json`을 `make test-php`와 `make test-js`가 실행한다. 렌더할 때 브라우저는 자기 라우트가 서버가 보고한 라우트와 같은지도 확인한다(HY-20). |
| 문서 렌더 | `make parity`는 비교 단계마다 같은 세션에서 HTML 문서, 문서 JSON, 영역 JSON을 요청한다. 라우트 영역, 내장 데이터, `server`와 `cookie` 유지 값(HY-30, HY-31, HY-38)을 포함한 문서 JSON의 브라우저 렌더 결과는 PHP 문서와 바이트 단위로 같아야 하고, 영역 JSON의 모든 부분이 그 문서에 나타나야 한다. |
| 브라우저에서의 동작 | `make e2e`는 SSR과 CSR에서 같은 흐름을 실행한다. 이동, 액션, 데이터 요청 없는 `hy-set` 변경, 새로고침과 새 탭에서의 유지 종류 네 가지, 라우트에 필요한 템플릿만 불러오기, SSR body와 CSR body가 같은지 확인하는 비교 페이지를 포함한다. |

## 측정한 크기

2026-10-01에 `make bundle-size`로 측정했다(htmx 4.0.0, esbuild 0.28.2, 게시판 템플릿 10개와 `hyper/data.tpl`).

| 결과 | 원본 바이트 | gzip 바이트 | brotli 바이트 |
|---|---:|---:|---:|
| SSR 스크립트 `hyper-<hash>.js` | 88,447 | 29,619 | 26,637 |
| CSR 셸 `dist/csr/index.html` | 91,727 | 30,755 | 27,456 |
| 가장 큰 템플릿 파일(`board/rows.tpl`) | 5,569 | 1,325 | 1,077 |
| 템플릿 파일 11개 전체 | | 5,655 | |

- 라우트는 자기 템플릿만 불러오고(HY-35), 템플릿 파일은 해시가 붙은 이름으로 캐시된다.
- 템플릿 AST는 노드마다 소스 위치를 기록하므로 압축 후 크기가 소스의 약 2배다.
- `config/bundle-size.json`은 템플릿 파일 하나를 4,096 gzip 바이트로 제한한다. 이보다 커지는 템플릿은 블록으로 나눈다.
