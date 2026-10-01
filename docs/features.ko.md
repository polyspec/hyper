# 기능 상태

[English](features.md).

| ID | 기능 | 상태 | 근거 |
|---|---|---|---|
| protocol | 영역 프로토콜 명세(HY-1 ~ HY-48) | implemented | [프로토콜](spec/protocol.ko.md) |
| composition | 화면 구성 규칙(HC-1 ~ HC-7)과 HC-6 템플릿 검사 | implemented | [화면 구성](spec/composition.ko.md), `make templates-check` |
| manifest | PHP와 브라우저가 읽는 애플리케이션 매니페스트 | implemented | `make test-php`, `make test-js` |
| router | 적합성 사례를 공유하는 PHP 라우터와 브라우저 라우터 | implemented | `make test-php`, `make test-js` |
| hyper-js | 브라우저 코드: 영역과 문서 렌더, htmx 확장, 클라이언트 렌더 | implemented | `make test-js`, `make e2e` |
| hyper-php | PHP 서버: 라우트, 액션, CSRF, flash, 바뀐 주제, 기본 경로, 문서와 JSON | implemented | `make test-php` |
| route-regions | 자기 로더를 가진 페이지 안의 라우트 영역(HY-30) | implemented | `make test-php`, `make parity` |
| region-data | 요청 없이 동작하는 내장 문서 데이터, `data`, `render`, `set`, `hy-set`(HY-29 ~ HY-33, HY-36) | implemented | `make test-js`, `make e2e` |
| kept-data | 서버 세션, 쿠키, localStorage, sessionStorage의 유지 경로(HY-37 ~ HY-41) | implemented | `make test-php`, `make test-js`, `make parity`, `make e2e` |
| template-delivery | 템플릿마다 파일 하나, 라우트별 불러오기(HY-34, HY-35) | implemented | `make test-js`, `make e2e`, `make bundle-size` |
| parity | 브라우저의 문서와 영역이 PHP 문서와 바이트 단위로 같음 | implemented | `make parity` |
| ssr | JSON 이동과 JavaScript 없는 동작을 갖춘 서버 렌더 | implemented | `make e2e` |
| csr | 정적 `index.html` 하나와 `/api` JSON을 쓰는 클라이언트 렌더 | implemented | `make e2e` |
| comparison | SSR과 CSR 프레임을 담은 비교 페이지 | implemented | `make e2e` |
| bundle-size | SSR 스크립트, CSR 셸, 템플릿 파일 크기 상한 | implemented | `make bundle-size` |
| request-boundary | UTF-8 검사, 상세 없는 500 오류, 데이터 모델 검사, 강화한 세션 쿠키, 리다이렉트 검사, 실패 표시(HY-42 ~ HY-47) | implemented | `make test-php`, `make test-js`, `make e2e` |
| benchmark | 서버와 브라우저 성능 측정: 요청 비용, 행 수별 렌더, 첫 화면, `hy-set` 메인 스레드 부하, 이동 중 메모리 | implemented | `make bench`, [성능 측정](operations/benchmark.ko.md) |
| server-program | 네이티브 템플릿 확장, 또는 같은 템플릿의 generated PHP 프로그램으로 하는 PHP 렌더(HY-48) | implemented | `make test-php`, `make parity` |
| cdn-deployment | 서버와 CDN 배포(권장)와 정적 셸 배포 | 문서화, 배포 안 함 | [배포](operations/deployment.ko.md) |
| other-servers | PHP 외 언어의 서버 패키지 | not started | |
| publication | 패키지의 레지스트리 배포 | not started | |
