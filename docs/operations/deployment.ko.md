# 배포

[English](deployment.md).

같은 애플리케이션을 두 가지 형태로 배포할 수 있다. 두 형태는 같은 매니페스트, 템플릿, 클라이언트 번들, PHP 핸들러를 사용한다.

| 형태 | 실행 위치 |
|---|---|
| 서버 렌더(SSR) | PHP가 루트에서 다음을 제공한다. 문서, htmx 요청에 대한 영역 JSON, `public/assets`(스타일시트와 클라이언트 스크립트). |
| 클라이언트 렌더(CSR) | 객체 저장소가 모든 페이지 경로에 `dist/csr/index.html`을, `/assets/templates/` 아래에 템플릿 파일을 제공한다. PHP는 `/api` 아래에서 JSON을 제공한다. |

## S3와 CloudFront로 CSR 배포

`make assets`는 `examples/board/dist/csr/`를 만든다.
- `index.html`은 스타일시트와 클라이언트 스크립트를 담는다. 클라이언트 스크립트에는 htmx, hyper 브라우저 코드, template 렌더 런타임, 매니페스트, 템플릿 색인이 들어 있다.
- `assets/templates/`는 템플릿마다 파일 하나를 담는다. 라우트는 자기 템플릿만 불러온다(HY-35).

1. S3 버킷에 다음과 같이 올린다.
   - `index.html`: `Content-Type: text/html; charset=utf-8`, `Cache-Control: no-cache`
   - `assets/templates/*`: `Content-Type: application/json`, `Cache-Control: public, max-age=31536000, immutable`. 파일 이름에 내용 해시가 들어 있으므로 새 배포는 파일을 추가할 뿐 기존 파일을 바꾸지 않는다.
2. PHP 애플리케이션을 환경 변수 `BOARD_BASE_PATH=/api`로 실행한다. 라우터는 라우팅 전에 `/api`를 제거하고 `Location` 헤더에 `/api`를 붙인다(HY-8).
3. 오리진 두 개를 가진 CloudFront 배포 하나를 만든다.

| 경로 패턴 | 오리진 | 동작 |
|---|---|---|
| `/api/*` | PHP 서버 | 모든 메서드를 허용하고 캐시하지 않는다. `Cookie`, `Accept`, `Hy-Region`, `HX-Current-URL`, `HX-Request`, `Content-Type` 헤더와 쿼리 문자열을 전달한다. |
| `/assets/*` | S3 버킷 | `GET`과 `HEAD`. 객체 헤더에 따라 캐시한다. |
| 기본값(`*`) | S3 버킷 | `GET`과 `HEAD`. 뷰어 요청 단계의 CloudFront Function이 URI를 `/index.html`로 바꾸므로, 모든 페이지 경로가 셸을 받는다. |

셸과 API가 같은 출처를 쓰므로 브라우저는 교차 출처 요청 없이 세션 쿠키를 `/api`로 보낸다. CORS 설정은 필요 없다.

4. 인라인 스크립트와 스타일시트를 해시로 허용하는 Content Security Policy를 보낸다. `make assets`가 정책을 출력한다(예: `script-src 'sha256-...'; style-src 'sha256-...'`). 해시는 빌드마다 바뀐다.

셸은 캐시하지 않으므로, 방문할 때마다 인라인 스크립트(gzip 약 30KB)를 내려받는다. 템플릿 파일은 내용이 바뀔 때까지 캐시된다.

## 로컬 재현

`make serve-demo`는 데이터베이스 하나로 두 형태를 재현한다.

| URL | 역할 |
|---|---|
| `http://127.0.0.1:8080/board` | SSR: 루트의 PHP |
| `http://127.0.0.1:8082/api/board` | `BOARD_BASE_PATH=/api`로 실행한 PHP |
| `http://127.0.0.1:8081/board` | CSR: `scripts/serve-edge.mjs`가 `dist/csr/`의 파일을 반환하고, 그 밖의 모든 경로에는 셸을 반환하며, `/api/*`를 포트 8082로 전달한다. CloudFront 배포와 같은 동작이다. |
| `http://127.0.0.1:8081/compare?ssr=http://127.0.0.1:8080` | 비교 페이지: SSR과 CSR을 두 프레임에 띄우고 두 body의 비교 결과를 표시한다 |
