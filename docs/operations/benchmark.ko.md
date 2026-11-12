<!-- doc-id: benchmark -->
<!-- source-sha256: 256dd8dddad9b3abac2eafcc26b14d342106dd67bfd27a7c729cb872a15aeead -->
# 성능 측정

[English](benchmark.md).

`make bench`는 게시판 예제를 서버와 브라우저에서 측정한다. 결과는 보고용이며 통과나 실패를 판정하지 않는다. 아래 기록은 `.github/workflows/bench.yml`의 수동 실행(`gh workflow run bench.yml`)에서 얻는다. 이 workflow는 전용 runner에서 `make bench`와 `make bench-sessions`를 차례로 실행하고 각 target의 report를 upload한다. 개발 기계는 다른 작업을 함께 실행하며, 다른 바쁜 프로세스는 중앙값보다 평균과 p95를 더 크게 바꾼다. runner는 공유 가상 기계이므로 기록에 두 번 실행한 편차를 적고, 같은 runner image의 기록끼리만 비교한다.

| 타깃 | 스크립트 | 측정 대상 |
|---|---|---|
| `make bench-server` | `benchmarks/server.php --app <directory> --iterations <n>` | 네트워크 없이 요청 종류별 `App::handle`, 그리고 10, 100, 1,000행에서 `board/rows.tpl` 렌더, `Bind::value`, `json_encode` 비용. generated PHP 프로그램으로 한 번, 네이티브 템플릿 확장으로 한 번 실행한다(HY-48) |
| `make bench-browser` | `benchmarks/browser.mts --ssr <port> --edge <port> --api <port> --runs <n>` | 첫 화면, 영역 이동, 10, 100, 1,000행에서 `hy-set` 변경 1회(시간, 단계, 메인 스레드 부하, 긴 작업), 반복 이동 중 메모리와 두 힙 스냅샷 사이의 증가, 템플릿 로드, 전송 바이트 |
| `make bench-sessions` | `benchmarks/sessions.mts --requests <n>` | Redis 서버 하나에서 process 하나와 넷으로 측정한 PHP, Node, Python 서버의 초당 요청 수와 Redis CPU 1초당 요청 수 |
| `make bench-uploads` | `benchmarks/uploads.mts --size <bytes> --runs <n>` | PHP, Node, Python server와 PHP 자체 reader에서 upload의 요청 시간, server의 processor 시간, 최대 메모리 |

`bench-server`는 `examples/board/var/` 아래에 자체 데이터베이스를 만들고 끝나면 지운다. `bench-browser`는 `scripts/board-servers.mts`로 board 예제를 system이 배정하는 port와 실행의 임시 디렉터리에 있는 자체 데이터베이스로 띄우고, 그 디렉터리를 `run directory: <path>`로 출력하고 지운다. 따라서 다른 checkout이나 session의 실행은 다른 서버와 다른 데이터베이스를 쓴다. `make check`는 PHP 측정기를 측정마다 한 번씩 실행하는 `make bench-server-smoke`를 실행하므로, 측정기를 깨는 변경은 검사에서 실패한다. 브라우저 측정기는 `make check`에 넣지 않았으므로, 변경이 그것을 깨도 다음 `make bench`까지 드러나지 않을 수 있다.

## 방법

- **서버:** PHP 프로세스는 항상 generated 프로그램을 렌더한다. 마지막 줄은 그 프로그램과 템플릿 확장의 로드 여부를 별도로 밝힌다. 확장은 같은 이름으로 template API를 제공한다(HY-48). 요청마다 20회 예열한 뒤 지정한 횟수만큼 한 프로세스 안에서 메모리 세션으로 실행한다. 시간은 `App::handle` 앞뒤의 `hrtime`이다. 라우팅, SQLite 로더, 렌더, 인코딩을 포함하고 네트워크와 PHP 시작은 제외한다.
- **Redis session:** 각 process는 자기 session의 요청을 실행한다. 요청은 작은 record를 loopback 연결로 다루며 잠금을 얻고, 읽고, 쓰고, 잠금을 푼다. PHP worker는 배포 환경처럼 `persistent=1`로 연결 하나를 유지한다. Client가 Redis 서버와 머신을 공유하므로 초당 요청 수는 그 머신이 내는 값을 보여 주고, `INFO`의 `used_cpu_user`와 `used_cpu_sys`로 구한 Redis CPU 1초당 요청 수는 명령을 한 thread에서 실행하는 Redis 서버의 비용을 보여 준다.
- **Upload:** 각 구현의 실제 server 하나가 benchmark가 쓴 같은 요청 body를 읽는다. 1 GiB file 하나, 값 500개와 204,800 byte file 500개, 반복 이름과 대괄호 이름의 값 900개다. server는 `tests/scripts/fixtures/upload-server`의 것이다. PHP application은 worker 하나와 `memory_limit=64M`의 PHP-FPM 아래에서 돌며 benchmark의 FastCGI client가 web server처럼 UNIX socket으로 부르고, Node의 `App.server` server와 Python의 `http.server` server는 HTTP로 부른다. PHP 자체 reader는 `enable_post_data_reading`을 켠 같은 PHP-FPM 아래의 `benchmarks/uploads-native.php`다. 각 server의 request hook은 file의 크기를 읽고 자기 process의 processor 시간과 최대 메모리를 답한다. file 없는 요청이 먼저 오고, 요청의 processor 시간은 직전 요청과의 차이다. client는 같은 machine에서 돈다. `http.server` server는 Python의 개발용 server이며 WSGI나 ASGI server는 측정하지 않는다.
- **첫 화면:** 페이지 로드 전에 추가한 `MutationObserver`가 목록 제목 `게시판`이 나타난 시각을 내비게이션 시작부터 기록한다. 매 회 새 브라우저 컨텍스트를 쓰므로 캐시가 없다.
- **영역 이동:** 글쓰기 링크 클릭부터 제목 `글쓰기`가 나타날 때까지의 시간이다.
- **`hy-set` 변경:** 호출부터 스왑이 끝날 때까지의 `window.hyper.set('rows', …)` 시간이다. 클릭 뒤와 같게 변경마다 페이지가 프레임 하나를 렌더한다. 두 가지 변경을 잰다.
  - `sort`: 모든 행의 순서를 바꾼다.
  - `compact`: class 하나만 바꾸고 행 순서는 그대로 둔다.
- **변경의 단계:** 템플릿 엔진, `htmx.swap`, `htmx.process`를 타이머로 감싸고, 리스너로 htmx 스왑 이벤트 시각을 기록한다. 단계는 다음과 같다.
  - `hyper`: 렌더와 스왑 밖의 변경 처리(데이터 복사, 보관, 저장)
  - `template`: 템플릿 엔진
  - `parse`: 스왑 호출부터 `htmx:before:swap`까지. 주로 HTML을 fragment로 파싱하는 시간이다.
  - `morph`: `htmx:before:swap`부터 `htmx:before:settle`까지
  - `settle`: `htmx:before:settle`부터 `htmx:after:settle`까지
  - `process`: 새 내용에 대한 `htmx.process`
  - `events`: 스왑의 나머지
- **메인 스레드 부하:** `sort` 변경을 Chromium 트레이스로 기록한다. 스크립트는 렌더러 메인 스레드의 모든 이벤트의 자기 시간을 종류별로 합한다. 그래서 스크립트 안에서 강제된 스타일 계산은 스타일로 센다. 50 ms를 넘는 작업마다 자기 시간이 가장 큰 이벤트를 출력한다.
- **메모리:** 페이지 안에서 `element.click()`으로 링크를 클릭해 `/board` → `/board/create` → `/board/<id>` → `/board`를 200회 반복한다. 50회마다 가비지 컬렉션을 강제한 뒤 JavaScript 힙, DOM 노드, 이벤트 리스너, 문서 수를 기록한다. 100회와 200회의 힙 스냅샷을 비교해 늘어난 객체와, 각 객체 하나의 첫 리테이너를 출력한다.

## 결과

2026-11-03에 릴리스 0.0.29와 그 benchmark 변경을 담은 같은 커밋에서 `.github/workflows/bench.yml`을 수동으로 두 번 실행해 측정했다(run 41591525587, 41591529070). 환경은 `ubuntu-26.04-arm` image 20261025.167.1, PHP 8.4.27, Chromium 156.0.8078.4, Node 26.12.0, Python 3.14.8, Redis 8.10.3, phpredis 6.3.0, template 0.0.20의 네이티브 확장이다. 표는 첫 번째 실행의 값이다. 두 번째 실행의 중앙값은 첫 번째와 최대 약 15% 다르고 대부분 8% 미만으로 다르며, 행 렌더 시간은 1% 미만으로 다르다. 데이터베이스에는 글이 30개 있고, 목록 한 페이지는 10개를 보여준다.

### 서버

| 요청 | 상태 | generated p50 ms | generated p95 ms | 네이티브 p50 ms | 네이티브 p95 ms | 바이트 |
|---|---:|---:|---:|---:|---:|---:|
| `GET /board`, 문서 HTML | 200 | 0.403 | 0.436 | 0.342 | 0.374 | 3,429 |
| `GET /board`, 문서 JSON | 200 | 0.153 | 0.181 | 0.136 | 0.166 | 1,642 |
| `GET /board`, `left`를 포함한 영역 JSON | 200 | 0.156 | 0.183 | 0.140 | 0.173 | 1,642 |
| `GET /board/1`, 문서 HTML | 200 | 0.233 | 0.268 | 0.182 | 0.220 | 1,503 |
| `GET /board/1`, 영역 JSON | 200 | 0.101 | 0.130 | 0.093 | 0.128 | 431 |
| `POST /board/create`, 422 영역 JSON | 422 | 0.076 | 0.101 | 0.073 | 0.098 | 466 |

| 행 | generated 렌더 ms | 네이티브 렌더 ms | generated `Bind::value` ms | 네이티브 `Bind::value` ms | `json_encode` ms | HTML 바이트 | JSON 바이트 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 0.134 | 0.121 | 0.017 | 0.004 | 0.003 | 1,920 | 1,129 |
| 100 | 1.388 | 1.257 | 0.123 | 0.032 | 0.021 | 14,975 | 9,232 |
| 1,000 | 15.196 | 29.590 | 1.201 | 0.312 | 0.207 | 149,980 | 92,935 |

서버는 `Bind::value`를 JSON 응답에서만 실행한다. 렌더가 문서의 모든 값을 바인딩하기 때문이다(HY-44).

### Redis session

`make bench-sessions`로 process마다 20,000개 요청을 측정했다.

| 서버 | Process | 초당 요청 | Redis CPU 1초당 요청 |
|---|---:|---:|---:|
| PHP | 1 | 4,010 | 8,250 |
| PHP | 4 | 11,816 | 13,089 |
| Python | 1 | 1,643 | 9,379 |
| Python | 4 | 4,161 | 9,834 |
| Node | 1 | 1,594 | 8,796 |
| Node | 4 | 3,960 | 9,191 |

요청은 잠금을 얻고, 읽고, 쓰고, 잠금을 풀며 명령 다섯 개를 쓴다. Redis 서버는 포화되지 않았다. Client가 runner를 공유하며 초당 요청 수를 제한한다. 마지막 열인 Redis CPU 1초가 처리하는 요청은 두 실행에서 이 runner 기준 약 8,000에서 13,000이므로, 명령을 한 thread에서 실행하는 Redis 서버 하나의 한계는 여기서 그 정도 규모다. 이 값은 CPU counter에서 구한 것이고 포화 상태에서 측정한 것이 아니다. Network는 포함되지 않는다. 배포 환경은 이 값에 기대기 전에 자기 크기와 network로 측정한다.

### Upload

`make bench-uploads`로 Apple silicon machine 한 대에서 PHP 8.4.27, Node 26.12.0, Python 3.14로 측정했다. body마다 요청 3회이며 평균과 최소와 최대다. 다른 작업이 같은 machine에서 도는 동안 측정했으므로 범위가 넓다.

1 GiB file 하나:

| 구현 | server processor 시간 ms | 요청 시간 ms | server 최대 메모리 MiB |
|---|---:|---:|---:|
| hyper Python(`http.server`) | 961 (767-1,271) | 1,165 (860-1,455) | 36.0 |
| hyper Node(`App.server`) | 1,068 (1,046-1,099) | 838 (793-886) | 152.0 |
| PHP 자체(PHP-FPM) | 2,017 (1,792-2,274) | 4,305 (2,769-5,233) | 6.2 |
| hyper PHP(PHP-FPM) | 3,552 (3,128-4,021) | 5,653 (5,027-6,065) | 13.3 |

값 500개와 204,800 byte file 500개(98 MiB):

| 구현 | server processor 시간 ms | 요청 시간 ms | server 최대 메모리 MiB |
|---|---:|---:|---:|
| hyper Python(`http.server`) | 289 (278-296) | 351 (241-419) | 37.5 |
| PHP 자체(PHP-FPM) | 349 (325-369) | 461 (422-486) | 6.2 |
| hyper Node(`App.server`) | 369 (325-439) | 228 (191-269) | 154.5 |
| hyper PHP(PHP-FPM) | 402 (355-490) | 461 (441-475) | 13.3 |

반복 이름과 대괄호 이름의 값 900개:

| 구현 | server processor 시간 ms | 요청 시간 ms | server 최대 메모리 MiB |
|---|---:|---:|---:|
| hyper Python(`http.server`) | 8 (7-8) | 7 (6-8) | 37.5 |
| PHP 자체(PHP-FPM) | 12 (1-35) | 16 (2-42) | 6.2 |
| hyper PHP(PHP-FPM) | 16 (3-40) | 5 (4-7) | 13.3 |
| hyper Node(`App.server`) | 20 (5-50) | 19 (4-46) | 157.6 |

server의 메모리는 1 GiB body와 98 MiB body에서 많아야 2.5 MiB 다르므로 body에 따라 늘지 않는다. hyper의 PHP server는 file이 있는 두 body에서 PHP 자체 reader의 1.2배에서 1.8배의 processor 시간을 쓴다. PHP는 script가 `php://input`을 읽기 전에 body를 자신의 임시 file에 쓰므로 file의 내용이 두 번 쓰인다. PHP 자체 reader는 반복된 이름의 마지막 값만 두고 대괄호 이름을 중첩하므로, 세 번째 body에서 hyper의 세 server가 주는 것을 주지 않는다.

### 브라우저

| 측정 | 중앙값 ms | p95 ms |
|---|---:|---:|
| `/board` SSR 첫 화면 | 16.1 | 21.8 |
| `/board/create`로 SSR 영역 이동 | 28.7 | 31.0 |
| `/board` CSR 첫 화면 | 67.4 | 74.4 |
| `/board/create`로 CSR 영역 이동 | 18.0 | 19.4 |
| `hy-set` 변경, 10행 | 1.9 | 3.2 |
| `hy-set` 변경, 100행 | 7.2 | 10.5 |
| `hy-set` 변경, 1,000행 | 79.2 | 90.3 |
| 템플릿 엔진 단독, 1,000행 | 3.9 | 8.9 |

`hy-set` 변경 1회의 단계(밀리초):

| 행 | 변경 | 합계 | hyper | template | parse | morph | settle | process | events |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | `sort` | 6.77 | 0.29 | 0.39 | 1.03 | 4.02 | 0.03 | 0.97 | 0.04 |
| 100 | `compact` | 6.31 | 0.31 | 0.47 | 0.99 | 3.60 | 0.01 | 0.88 | 0.05 |
| 1,000 | `sort` | 77.99 | 0.98 | 3.57 | 7.87 | 57.30 | 0.03 | 8.01 | 0.23 |
| 1,000 | `compact` | 67.53 | 1.05 | 4.21 | 7.47 | 46.99 | 0.01 | 7.61 | 0.19 |

`sort` 변경 1회와 그 프레임의 메인 스레드 부하(밀리초):

| 행 | 합계 | 스크립트 | 스타일 | 레이아웃 | 페인트 | GC | 기타 | 가장 긴 작업 | 50 ms 초과 작업 | DOM 노드 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 2.90 | 1.79 | 0.08 | 0.00 | 0.28 | 0.08 | 0.68 | 3.6 | 0 | 346 |
| 100 | 14.68 | 6.07 | 0.85 | 2.64 | 2.38 | 0.56 | 2.19 | 10.5 | 0 | 2,056 |
| 1,000 | 137.70 | 64.83 | 9.67 | 33.63 | 9.30 | 3.14 | 17.13 | 114.3 | 23 | 19,156 |

반복 이동 중 메모리:

| 반복 | JS 힙 KB | DOM 노드 | 이벤트 리스너 | 문서 |
|---:|---:|---:|---:|---:|
| 0 | 1,429 | 336 | 33 | 1 |
| 50 | 2,809 | 337 | 34 | 1 |
| 100 | 2,916 | 337 | 34 | 1 |
| 150 | 2,999 | 337 | 34 | 1 |
| 200 | 2,999 | 337 | 34 | 1 |

100회에서 200회 사이의 힙 스냅샷은 세 종류의 증가를 보인다. DevTools 네트워크 기록의 `blink::NetworkResourcesData::ResourceData` 객체 500개, 컴파일된 V8 코드, 그리고 문서의 `StyleEngine`이 넣은 `<thead>`마다 보유하는 `blink::MediaQuerySet` 객체 200개다.

CSR은 `/board`에서 템플릿 파일 6개를 로드한다. 로컬 서버에서 가장 느린 파일은 첫 번째 실행에서 11.7 ms, 두 번째 실행에서 5.1 ms 걸렸다. `/board` 문서는 2,999바이트(gzip 1,030)이고, 영역 JSON은 1,392바이트(gzip 587)다. SSR 스크립트는 gzip 38,297바이트, CSR 셸은 38,429바이트다(`make bundle-size`).

## 발견 사항

- **서버:** 영역 JSON 응답의 비용은 generated 프로그램과 네이티브 확장 모두 문서의 약 5분의 2에서 2분의 1이다. 렌더를 브라우저가 하기 때문이다.
- **PHP 렌더:** 1,000행을 generated 프로그램은 15.2 ms, 네이티브 확장은 29.6 ms에 렌더하고, 브라우저 엔진은 3.9 ms가 걸린다. 네이티브 확장은 10행과 100행에서는 더 빠르다. 100행에서 1,000행으로 갈 때 그 시간은 23.5배, generated 프로그램의 시간은 10.9배 늘어난다(<https://github.com/polyspec/template/issues/7>).
- **데이터 모델 검사:** `Bind::value`(HY-44)는 1,000행에 generated 프로그램에서 1.2 ms, 네이티브 확장에서 0.31 ms가 걸린다.
- **첫 화면:** SSR은 CSR보다 약 4.5배 빨리 보여준다. CSR은 셸을 받은 뒤 JSON과 템플릿 파일을 요청하기 때문이다.
- **1,000행 `hy-set`:** 변경에 스크립트 시간 68~78 ms가 걸린다. 그중 htmx `innerMorph` 스왑이 47~57 ms, `htmx.process`가 약 8 ms, HTML 파싱이 약 8 ms, 템플릿 엔진이 약 4 ms, hyper가 약 1 ms다. htmx는 이 프로젝트의 변경 범위 밖이다. 각 실행에서 50 ms를 넘는 작업이 23개였고, 가장 긴 작업은 114 ms와 128 ms였다.
- **영역 이동:** Apple M3 Pro에서 2026-11-03에 세 번 실행한 중앙값은 SSR 13.3~16.8 ms, CSR 9.9~13.5 ms였다. CPU idle은 51~76%였고 다른 benchmark, build, test는 실행되지 않았다. 그 기계의 2026-10-02 기록은 Chromium 153에서 7.8 ms와 7.4 ms였다. 그 사이에 Chromium과 코드가 모두 바뀌었고 원인은 밝혀지지 않았다.
- **번들 크기:** SSR 스크립트(gzip 38,297바이트)와 CSR 셸(38,429바이트)은 `config/bundle-size.json`의 한계 35,900과 36,000을 넘으며, `make bundle-size`는 이를 실패가 아닌 경고로 보고한다.
- **메모리:** DOM 노드와 이벤트 리스너는 200회 동안 일정하다. 처음 50회 이후의 힙 증가는 DevTools 네트워크 기록, 컴파일된 코드, 그리고 Chromium이 넣은 `<thead>` 요소마다 보유하는 `MediaQuerySet` 객체이며, 애플리케이션에서 오지 않는다.
