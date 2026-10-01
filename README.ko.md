# hyper

[English](README.md).

hyper는 애플리케이션 하나에서 template 언어 템플릿으로 두 가지 방식의 페이지 렌더를 제공한다.

- **SSR**: PHP가 요청을 라우팅하고 템플릿으로 문서를 렌더한다. 이후 링크와 폼은 JSON을 요청하고, 브라우저가 바뀐 영역을 렌더한다.
- **CSR**: 모든 경로에 정적 파일 하나 `index.html`을 제공한다. 브라우저가 경로를 라우팅하고, `/api` 아래의 PHP에 JSON을 요청해 문서 전체를 렌더한다. 이 형태는 JSON만 제공하는 백엔드를 위한 것이다. 권장 배포는 서버 하나가 직접 요청에는 SSR로, htmx 요청에는 JSON으로 응답하는 방식이다([배포](docs/operations/deployment.ko.md) 참조).

두 방식은 매니페스트 하나 `app.json`(레이아웃, 제목, 영역, 라우트)을 읽고 같은 템플릿을 렌더한다. 화면은 데이터의 함수다. 브라우저에서 바뀌는 부분은 라우트 영역이며, `hy-set="notice.closed=true"`나 `set('notice', 'notice.closed', true)`가 요청 없이 그 데이터를 바꾸고 다시 렌더한다. 영역은 새로고침 후에도 남을 데이터 경로와 그 저장소(`server`, `cookie`, `localStorage`, `sessionStorage`)를 선언한다. 템플릿은 라우트별로 불러온다.
- PHP 라우터와 브라우저 라우터는 같은 적합성 사례를 통과한다.
- 예제의 모든 페이지에서 브라우저는 PHP와 같은 바이트를 렌더한다.
- 이동, 폼 전송, 스왑, 히스토리는 htmx 4가 수행한다.

템플릿은 template 언어를 바꾸지 않고 사용한다. 레이아웃은 블록 태그로 영역을 배치한다.

```
<title>{# title}</title>
<body hx-boost:inherited="true" hx-target:inherited="#content" hx-swap:inherited="innerMorph">
<aside id="left" hy-region>{# left}</aside>
<main id="content" hy-region>{# content}</main>
</body>
```

페이지와 영역에는 `hx-*` 속성이 없다. 링크와 폼은 일반 HTML이며, SSR에서는 JavaScript 없이도 동작한다.

## 패키지

| 경로 | 이름 | 역할 |
|---|---|---|
| `packages/hyper-js` | `@polyspec/hyper` | 브라우저 코드. 매니페스트, 라우터, 영역과 문서 렌더, htmx 확장, 클라이언트 렌더 |
| `packages/hyper-php` | `polyspec/hyper` | 서버. 매니페스트, 라우터, 액션, 영역 선택, 문서와 JSON |
| `examples/board` | | 게시판 예제. 레이아웃, 레프트, 컨텐츠 영역. 목록, 상세, 글쓰기, 검증 |
| `conformance/routes.json` | | 두 라우터가 함께 통과하는 라우터 사례 |

## 시작

template 저장소가 이 저장소 옆(`../template`)에 있어야 한다.

```sh
make install
make template
make serve-demo
```

- SSR: `http://127.0.0.1:8080/board`
- CSR: `http://127.0.0.1:8081/board`
- 두 방식을 두 프레임으로 비교: `http://127.0.0.1:8081/compare?ssr=http://127.0.0.1:8080`

`make help`는 모든 타깃을 나열하고, `make check`는 모든 검사를 실행한다.

## 문서

- [영역 프로토콜](docs/spec/protocol.ko.md): 매니페스트, 라우팅, 렌더, 요청과 응답 계약을 정의한다.
- [화면 구성](docs/spec/composition.ko.md): 화면의 각 부분이 사용하는 장치(HTML과 CSS, 블록, 영역)를 정의한다.
- [기능 상태](docs/features.ko.md): 구현과 검증 상태를 기록한다.
- [개발](docs/operations/development.ko.md): 검사와 에셋 빌드를 설명한다.
- [배포](docs/operations/deployment.ko.md): S3와 CloudFront를 포함한 SSR과 CSR 배포를 설명한다.
- [성능 측정](docs/operations/benchmark.ko.md): 성능 측정 방법과 결과를 기록한다.
- [의존성](docs/operations/dependencies.ko.md): 고정한 버전을 기록한다.
- [변경 기록](CHANGELOG.ko.md): 변경과 검증 결과를 기록한다.
