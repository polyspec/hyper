<!-- doc-id: benchmark -->
# Benchmark

[한국어](benchmark.ko.md).

`make bench` measures the board example on the server and in the browser. The results are reports and do not pass or fail. The record below comes from a manual run of `.github/workflows/bench.yml` (`gh workflow run bench.yml`), which runs `make bench` and `make bench-sessions` one after another on a runner of their own and uploads the report of each target. A development machine runs other work, and another busy process changes the mean and p95 more than the median. A runner is a shared virtual machine, so a record states the spread of two runs, and it compares only with records of the same runner image.

| Target | Script | Measures |
|---|---|---|
| `make bench-server` | `benchmarks/server.php --app <directory> --iterations <n>` | `App::handle` per request kind without network, and the cost of `board/rows.tpl` rendering, `Bind::value` and `json_encode` for 10, 100 and 1,000 rows; it runs once with the generated PHP program and once with the native template extension (HY-48) |
| `make bench-browser` | `benchmarks/browser.mts --ssr <port> --edge <port> --api <port> --runs <n>` | First screens, region navigation, one `hy-set` change for 10, 100 and 1,000 rows (time, phases, main thread load and long tasks), memory over repeated navigation with the growth between two heap snapshots, template loading, and transferred bytes |
| `make bench-sessions` | `benchmarks/sessions.mts --requests <n>` | The requests per second of the PHP, Node and Python servers on one Redis server, with one and four processes, and the requests per second of Redis CPU |
| `make bench-uploads` | `benchmarks/uploads.mts --size <bytes> --runs <n>` | The time of a request, the processor time of the server and its largest memory for an upload in the PHP, Node and Python servers and in the reader of PHP itself |

`bench-server` creates its own database under `examples/board/var/` and removes it when it finishes. `bench-browser` starts the board example with `scripts/board-servers.mts` on ports that the system assigns and its own database in a temporary directory of the run, which it prints as `run directory: <path>` and removes, so a run from another checkout or session uses other servers and another database. `make check` runs `make bench-server-smoke`, which runs the PHP benchmark once per measurement, so a change that breaks it fails the check; the browser benchmark is not part of `make check`, so a change can break it unnoticed until the next `make bench`.

## Method

- **Server:** the PHP process always renders the generated program. The last line names that program and separately reports whether the template extension is loaded; the extension provides the template API under the same names (HY-48). Every request runs 20 times as warm-up and then the given number of times in one process with an in-memory session. The time is `hrtime` around `App::handle`. It includes routing, loaders on SQLite, rendering and encoding, and excludes network and PHP startup.
- **Redis sessions:** each process runs requests of a session of its own, which take the lock, read, write and release it, with a small record over a loopback connection. The PHP worker keeps one connection with `persistent=1`, as a deployment does. The clients share the machine with the Redis server, so requests per second show what the machine gives; requests per second of Redis CPU, from `used_cpu_user` and `used_cpu_sys` of `INFO`, show the cost to the Redis server, which runs commands on one thread.
- **Uploads:** one real server of each implementation reads the same request bodies, which the benchmark writes: one file of 1 GiB, 500 values with 500 files of 204,800 bytes, and 900 values of repeated and bracketed names. The servers are those of `tests/scripts/fixtures/upload-server`: the PHP application under PHP-FPM with one worker and `memory_limit=64M`, which a FastCGI client of the benchmark calls over a UNIX socket as a web server does, the server of `App.server` of Node and the `http.server` server of Python, both over HTTP. The reader of PHP itself is `benchmarks/uploads-native.php` under the same PHP-FPM with `enable_post_data_reading` on. The request hook of each server reads the sizes of the files and answers the processor time and the largest memory of its process; a request without a file comes first, and the processor time of a request is the difference to the request before it. The client runs on the same machine. The `http.server` server is the development server of Python, and no WSGI or ASGI server is measured.
- **First screen:** a `MutationObserver` added before the page loads records when the list heading `게시판` appears, measured from navigation start. Each run uses a new browser context, so nothing is cached.
- **Region navigation:** the time from the click on the create link to the appearance of the heading `글쓰기`.
- **`hy-set` change:** `window.hyper.set('rows', …)` from the call to the end of the swap. After every change the page renders one frame, as after a click. Two changes are measured:
  - `sort` reorders every row.
  - `compact` changes one class and keeps the row order.
- **Phases of a change:** timers wrap the template engine, `htmx.swap` and `htmx.process`, and listeners record the htmx swap events. The phases are:
  - `hyper`: the change outside rendering and swapping (data copy, hold, store).
  - `template`: the template engine.
  - `parse`: from the swap call to `htmx:before:swap`, mainly parsing the HTML into a fragment.
  - `morph`: from `htmx:before:swap` to `htmx:before:settle`.
  - `settle`: from `htmx:before:settle` to `htmx:after:settle`.
  - `process`: `htmx.process` of the new content.
  - `events`: the rest of the swap.
- **Main thread load:** a Chromium trace of the `sort` changes. The script sums the self time of every event on the renderer main thread by kind, so a style calculation forced inside a script counts as style. For every task longer than 50 ms it prints the events with the largest self time.
- **Memory:** 200 cycles of `/board` → `/board/create` → `/board/<id>` → `/board`, clicking links with `element.click()` inside the page. Every 50 cycles the script forces garbage collection and records the JavaScript heap, DOM nodes, event listeners and documents. Heap snapshots at cycles 100 and 200 give the objects that grew, with the first retainers of one instance of each.

## Results

Measured on 2026-11-03 by two manual runs of `.github/workflows/bench.yml` on the same commit of release 0.0.29 and its benchmark changes (runs 41591525587 and 41591529070), on `ubuntu-26.04-arm` image 20261025.167.1 with PHP 8.4.27, Chromium 156.0.8078.4, Node 26.12.0, Python 3.14.8, Redis 8.10.3, phpredis 6.3.0 and the native extension of template 0.0.20. The tables show the first run. A median of the second run differs from the first by at most about 15%, and most by under 8%; the row render times differ by under 1%. The database has 30 posts, and a list page shows 10.

### Server

| Request | Status | Generated p50 ms | Generated p95 ms | Native p50 ms | Native p95 ms | Bytes |
|---|---:|---:|---:|---:|---:|---:|
| `GET /board`, document HTML | 200 | 0.403 | 0.436 | 0.342 | 0.374 | 3,429 |
| `GET /board`, document JSON | 200 | 0.153 | 0.181 | 0.136 | 0.166 | 1,642 |
| `GET /board`, region JSON with `left` | 200 | 0.156 | 0.183 | 0.140 | 0.173 | 1,642 |
| `GET /board/1`, document HTML | 200 | 0.233 | 0.268 | 0.182 | 0.220 | 1,503 |
| `GET /board/1`, region JSON | 200 | 0.101 | 0.130 | 0.093 | 0.128 | 431 |
| `POST /board/create`, 422 region JSON | 422 | 0.076 | 0.101 | 0.073 | 0.098 | 466 |

| Rows | Generated render ms | Native render ms | Generated `Bind::value` ms | Native `Bind::value` ms | `json_encode` ms | HTML bytes | JSON bytes |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 0.134 | 0.121 | 0.017 | 0.004 | 0.003 | 1,920 | 1,129 |
| 100 | 1.388 | 1.257 | 0.123 | 0.032 | 0.021 | 14,975 | 9,232 |
| 1,000 | 15.196 | 29.590 | 1.201 | 0.312 | 0.207 | 149,980 | 92,935 |

The server runs `Bind::value` only for JSON responses, because rendering binds every value of a document (HY-44).

### Redis sessions

Measured with `make bench-sessions`, 20,000 requests per process.

| Server | Processes | Requests/s | Requests per second of Redis CPU |
|---|---:|---:|---:|
| PHP | 1 | 4,010 | 8,250 |
| PHP | 4 | 11,816 | 13,089 |
| Python | 1 | 1,643 | 9,379 |
| Python | 4 | 4,161 | 9,834 |
| Node | 1 | 1,594 | 8,796 |
| Node | 4 | 3,960 | 9,191 |

A request takes the lock, reads, writes and releases it, five commands. The Redis server was not saturated: the clients share the runner and limit the requests per second. The last column, the requests that one second of Redis CPU serves, is about 8,000 to 13,000 on this runner over both runs, so one Redis server, which runs commands on one thread, has that order of limit here; it is derived from the CPU counters and not measured at saturation. No network is included. A deployment measures its own sizes and network before it relies on this.

### Uploads

Measured with `make bench-uploads` on one Apple silicon machine with PHP 8.4.27, Node 26.12.0 and Python 3.14: three requests of each body, the mean with the least and the most. Other work ran on the machine during the measurement, so the ranges are wide.

One file of 1 GiB:

| Implementation | Server processor time ms | Request time ms | Largest memory of the server MiB |
|---|---:|---:|---:|
| hyper Python (`http.server`) | 961 (767-1,271) | 1,165 (860-1,455) | 36.0 |
| hyper Node (`App.server`) | 1,068 (1,046-1,099) | 838 (793-886) | 152.0 |
| PHP itself (PHP-FPM) | 2,017 (1,792-2,274) | 4,305 (2,769-5,233) | 6.2 |
| hyper PHP (PHP-FPM) | 3,552 (3,128-4,021) | 5,653 (5,027-6,065) | 13.3 |

500 values and 500 files of 204,800 bytes (98 MiB):

| Implementation | Server processor time ms | Request time ms | Largest memory of the server MiB |
|---|---:|---:|---:|
| hyper Python (`http.server`) | 289 (278-296) | 351 (241-419) | 37.5 |
| PHP itself (PHP-FPM) | 349 (325-369) | 461 (422-486) | 6.2 |
| hyper Node (`App.server`) | 369 (325-439) | 228 (191-269) | 154.5 |
| hyper PHP (PHP-FPM) | 402 (355-490) | 461 (441-475) | 13.3 |

900 values of repeated and bracketed names:

| Implementation | Server processor time ms | Request time ms | Largest memory of the server MiB |
|---|---:|---:|---:|
| hyper Python (`http.server`) | 8 (7-8) | 7 (6-8) | 37.5 |
| PHP itself (PHP-FPM) | 12 (1-35) | 16 (2-42) | 6.2 |
| hyper PHP (PHP-FPM) | 16 (3-40) | 5 (4-7) | 13.3 |
| hyper Node (`App.server`) | 20 (5-50) | 19 (4-46) | 157.6 |

The memory of a server is the same for a body of 1 GiB and for a body of 98 MiB, so it does not grow with the body. The PHP server of hyper uses 1.2 to 1.8 times the processor time of the reader of PHP itself for the two bodies with files: PHP writes a body to its own temporary file before a script reads `php://input`, so the content of a file is written twice. The reader of PHP itself keeps the last value of a repeated name and nests bracketed names, so it does not give what the three servers of hyper give for the third body.

### Browser

| Measurement | Median ms | p95 ms |
|---|---:|---:|
| SSR first screen of `/board` | 16.1 | 21.8 |
| SSR region navigation to `/board/create` | 28.7 | 31.0 |
| CSR first screen of `/board` | 67.4 | 74.4 |
| CSR region navigation to `/board/create` | 18.0 | 19.4 |
| `hy-set` change, 10 rows | 1.9 | 3.2 |
| `hy-set` change, 100 rows | 7.2 | 10.5 |
| `hy-set` change, 1,000 rows | 79.2 | 90.3 |
| Template engine alone, 1,000 rows | 3.9 | 8.9 |

Phases of one `hy-set` change, in milliseconds:

| Rows | Change | Total | hyper | template | parse | morph | settle | process | events |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | `sort` | 6.77 | 0.29 | 0.39 | 1.03 | 4.02 | 0.03 | 0.97 | 0.04 |
| 100 | `compact` | 6.31 | 0.31 | 0.47 | 0.99 | 3.60 | 0.01 | 0.88 | 0.05 |
| 1,000 | `sort` | 77.99 | 0.98 | 3.57 | 7.87 | 57.30 | 0.03 | 8.01 | 0.23 |
| 1,000 | `compact` | 67.53 | 1.05 | 4.21 | 7.47 | 46.99 | 0.01 | 7.61 | 0.19 |

Main thread load of one `sort` change and its frame, in milliseconds:

| Rows | Total | Script | Style | Layout | Paint | GC | Other | Longest task | Tasks over 50 ms | DOM nodes |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 2.90 | 1.79 | 0.08 | 0.00 | 0.28 | 0.08 | 0.68 | 3.6 | 0 | 346 |
| 100 | 14.68 | 6.07 | 0.85 | 2.64 | 2.38 | 0.56 | 2.19 | 10.5 | 0 | 2,056 |
| 1,000 | 137.70 | 64.83 | 9.67 | 33.63 | 9.30 | 3.14 | 17.13 | 114.3 | 23 | 19,156 |

Memory over repeated navigation:

| Cycles | JS heap KB | DOM nodes | Event listeners | Documents |
|---:|---:|---:|---:|---:|
| 0 | 1,429 | 336 | 33 | 1 |
| 50 | 2,809 | 337 | 34 | 1 |
| 100 | 2,916 | 337 | 34 | 1 |
| 150 | 2,999 | 337 | 34 | 1 |
| 200 | 2,999 | 337 | 34 | 1 |

From cycle 100 to cycle 200 the heap snapshots show three kinds of growth: 500 `blink::NetworkResourcesData::ResourceData` objects of the DevTools network recording, compiled V8 code, and 200 `blink::MediaQuerySet` objects that the document's `StyleEngine` keeps for each inserted `<thead>`.

CSR loads 6 template files for `/board`; the slowest took 11.7 ms from the local server in the first run and 5.1 ms in the second. The `/board` document is 2,999 bytes (1,030 gzip), and its region JSON is 1,392 bytes (587 gzip). The SSR script is 38,297 gzip bytes and the CSR shell 38,429 (`make bundle-size`).

## Findings

- **Server:** a region JSON response costs about two fifths to a half of a document with the generated program and with the native extension, because the browser renders it.
- **PHP rendering:** for 1,000 rows the generated program renders in 15.2 ms and the native extension in 29.6 ms, and the browser engine takes 3.9 ms. The native extension is faster at 10 and 100 rows; from 100 to 1,000 rows its time grows 23.5 times and that of the generated program 10.9 times (<https://github.com/polyspec/template/issues/7>).
- **Data model check:** `Bind::value` (HY-44) takes 1.2 ms for 1,000 rows with the generated program and 0.31 ms with the native extension.
- **First screen:** SSR shows it about 4.5 times as fast as CSR, because CSR requests JSON and template files after the shell.
- **`hy-set` at 1,000 rows:** the change takes 68 to 78 ms of script. The htmx `innerMorph` swap takes 47 to 57 ms of it, `htmx.process` about 8 ms, HTML parsing about 8 ms, the template engine about 4 ms and hyper about 1 ms. htmx is outside the scope of this project's changes. In each run 23 tasks exceeded 50 ms, the longest 114 and 128 ms.
- **Region navigation:** on an Apple M3 Pro, three runs of 2026-11-03 gave a median of 13.3 to 16.8 ms for SSR and 9.9 to 13.5 ms for CSR, with idle CPU at 51 to 76% and no other benchmark, build or test running. The record of 2026-10-02 on that machine gave 7.8 and 7.4 ms with Chromium 153. Chromium and the code both changed between them, and the cause is not established.
- **Bundle size:** the SSR script (38,297 gzip bytes) and the CSR shell (38,429) exceed their limits of 35,900 and 36,000 in `config/bundle-size.json`, which `make bundle-size` reports as warnings and not as failures.
- **Memory:** DOM nodes and event listeners stay constant over 200 cycles. The heap growth after the first 50 cycles consists of the DevTools network recording, compiled code and the `MediaQuerySet` objects that Chromium keeps for inserted `<thead>` elements; it does not come from the application.
