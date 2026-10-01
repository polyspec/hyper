# Benchmark

[한국어](benchmark.ko.md).

`make bench` measures the board example on the server and in the browser. The results are reports. They do not pass or fail, because times depend on the machine and its load. Run the measurement on an idle machine; another busy process changes the mean and p95 more than the median.

| Target | Script | Measures |
|---|---|---|
| `make bench-server` | `scripts/bench-server.php --app <directory> --iterations <n>` | `App::handle` per request kind without network, and the cost of `board/rows.tpl` rendering, `Bind::value` and `json_encode` for 10, 100 and 1,000 rows |
| `make bench-browser` | `scripts/bench-browser.mjs --ssr <port> --edge <port> --api <port> --runs <n>` | The first screen in SSR and CSR, a region navigation, the time and the main thread load of one `hy-set` change for 10, 100 and 1,000 rows, the template engine alone, memory over repeated navigation, template loading and transferred bytes |

Both scripts create their own database under `examples/board/var/` and remove it when they finish. `bench-browser` starts `scripts/serve-demo.mjs` on ports 8085 to 8087.

## Method

- **Server:** every request runs 20 times as warm-up and then the given number of times in one process with an in-memory session. The time is `hrtime` around `App::handle`; it includes routing, loaders on SQLite, rendering and encoding, and excludes network and PHP startup.
- **First screen:** a `MutationObserver` added before the page loads records when the list heading `게시판` appears, measured from navigation start. Each run uses a new browser context, so nothing is cached.
- **Region navigation:** the time from the click on the create link to the appearance of the heading `글쓰기`.
- **`hy-set` change:** `window.hyper.set('rows', 'sort', …)` from the call to the end of the swap. After every change the page renders one frame, as after a click.
- **Main thread load:** a Chromium trace of the same changes. The script sums the self time of every event on the renderer main thread by kind, so a style calculation forced inside a script counts as style. Values are per change and include the frame after it. A task longer than 50 ms delays input.
- **Memory:** 200 cycles of `/board` → `/board/create` → `/board/<id>` → `/board` by clicking links. Every 50 cycles the script forces garbage collection and records the JavaScript heap, DOM nodes, event listeners and documents.

## Results

Measured on 2026-10-01 on an idle Apple M3 Pro with PHP 8.5.10, Chromium 153.0.8010.12 and Node 26.8.1. The database has 30 posts, and a list page shows 10.

### Server

| Request | Status | p50 ms | p95 ms | Bytes |
|---|---:|---:|---:|---:|
| `GET /board`, document HTML | 200 | 0.491 | 0.604 | 5,258 |
| `GET /board`, document JSON | 200 | 0.067 | 0.092 | 1,581 |
| `GET /board`, region JSON with `left` | 200 | 0.069 | 0.154 | 1,581 |
| `GET /board/1`, document HTML | 200 | 0.559 | 1.511 | 1,916 |
| `GET /board/1`, region JSON | 200 | 0.064 | 0.205 | 677 |
| `POST /board/create`, 422 region JSON | 422 | 0.024 | 0.062 | 405 |

| Rows | Render ms | `Bind::value` ms | `json_encode` ms | HTML bytes | JSON bytes |
|---:|---:|---:|---:|---:|---:|
| 10 | 0.237 | 0.019 | 0.002 | 1,920 | 1,119 |
| 100 | 3.739 | 0.282 | 0.023 | 14,975 | 9,222 |
| 1,000 | 17.280 | 1.440 | 0.161 | 149,980 | 92,925 |

### Browser

| Measurement | Median ms | p95 ms |
|---|---:|---:|
| SSR first screen of `/board` | 8.5 | 12.7 |
| SSR region navigation to `/board/create` | 8.9 | 38.3 |
| CSR first screen of `/board` | 18.3 | 35.8 |
| CSR region navigation to `/board/create` | 8.9 | 20.2 |
| `hy-set` change, 10 rows | 0.8 | 3.1 |
| `hy-set` change, 100 rows | 2.6 | 3.7 |
| `hy-set` change, 1,000 rows | 25.5 | 35.7 |
| Template engine alone, 1,000 rows | 2.9 | 4.5 |

Main thread load of one `hy-set` change, in milliseconds:

| Rows | Total | Script | Style | Layout | Paint | GC | Other | Longest task | Tasks over 50 ms | DOM nodes |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 1.56 | 0.80 | 0.04 | 0.00 | 0.15 | 0.09 | 0.49 | 3.6 | 0 | 355 |
| 100 | 5.25 | 2.14 | 0.35 | 0.74 | 0.90 | 0.28 | 0.85 | 3.9 | 0 | 2,065 |
| 1,000 | 45.45 | 20.84 | 3.63 | 9.72 | 3.51 | 2.04 | 5.74 | 35.7 | 0 | 19,165 |

Memory over repeated navigation:

| Cycles | JS heap KB | DOM nodes | Event listeners | Documents |
|---:|---:|---:|---:|---:|
| 0 | 1,402 | 345 | 33 | 1 |
| 50 | 3,192 | 346 | 47 | 1 |
| 100 | 3,321 | 346 | 47 | 1 |
| 150 | 3,427 | 346 | 47 | 1 |
| 200 | 3,452 | 346 | 47 | 1 |

CSR loads 7 template files for `/board`; the slowest took 3.4 ms from the local server. The `/board` document is 4,428 bytes (1,425 gzip), and its region JSON is 1,331 bytes (534 gzip).

## Reading the results

- A region JSON response costs the server about one seventh of a document, because the browser renders it.
- An SSR first screen appears about twice as fast as a CSR first screen, because CSR requests JSON and template files after the shell. This supports the recommended deployment.
- A `hy-set` change of up to 100 rows completes within one 16 ms frame. At 1,000 rows the change takes 25 ms. The run above had no task over 50 ms; a repeated run on the same day had one task of 137 ms among its 15 changes, mostly paint, so a list of that size can delay input. The template engine takes 3 ms of the change, and the DOM update (script outside the engine, layout and style) takes the rest. Lists of that size need pages.
- DOM nodes and event listeners stay constant over 200 navigation cycles, so swapped regions do not leave nodes or listeners behind. The JavaScript heap grows during the first 50 cycles, when the browser loads and caches templates and compiles code, and grows by less than 30 KB between cycles 150 and 200.
- PHP renders 1,000 rows about six times slower than the browser engine. PHP renders only direct requests, so this affects first documents and not navigation.
