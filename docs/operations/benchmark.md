<!-- doc-id: benchmark -->
# Benchmark

[한국어](benchmark.ko.md).

`make bench` measures the board example on the server and in the browser. The results are reports and do not pass or fail. Run the measurement on an idle machine; another busy process changes the mean and p95 more than the median.

| Target | Script | Measures |
|---|---|---|
| `make bench-server` | `scripts/bench-server.php --app <directory> --iterations <n>` | `App::handle` per request kind without network, and the cost of `board/rows.tpl` rendering, `Bind::value` and `json_encode` for 10, 100 and 1,000 rows; it runs once with the generated PHP program and once with the native template extension (HY-48) |
| `make bench-browser` | `scripts/bench-browser.mjs --ssr <port> --edge <port> --api <port> --runs <n>` | First screens, region navigation, one `hy-set` change for 10, 100 and 1,000 rows (time, phases, main thread load and long tasks), memory over repeated navigation with the growth between two heap snapshots, template loading, and transferred bytes |

`bench-server` creates its own database under `examples/board/var/` and removes it when it finishes. `bench-browser` starts the board example with `scripts/board-servers.mjs` on ports that the system assigns and its own database in a temporary directory of the run, which it prints as `run directory: <path>` and removes, so a run from another checkout or session uses other servers and another database. `make check` runs `make bench-server-smoke`, which runs the PHP benchmark once per measurement, so a change that breaks it fails the check; the browser benchmark takes several minutes and is not part of `make check`, so a change can break it unnoticed until the next `make bench`.

## Method

- **Server:** the PHP process renders with the native extension when it has loaded it and otherwise with the generated program; the last line of each table names the program. Every request runs 20 times as warm-up and then the given number of times in one process with an in-memory session. The time is `hrtime` around `App::handle`. It includes routing, loaders on SQLite, rendering and encoding, and excludes network and PHP startup.
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

Measured on 2026-10-02 at commit "Check the manifest in the build and the servers, not in the browser", on an Apple M3 Pro with PHP 8.5.10, Chromium 153.0.8010.12 and Node 26.8.1. The machine was not idle: the load average was 7.8 to 8.5 during the run, so the means and p95 values are less reliable than the medians. The database has 30 posts, and a list page shows 10.

### Server

| Request | Status | Generated p50 ms | Generated p95 ms | Native p50 ms | Native p95 ms | Bytes |
|---|---:|---:|---:|---:|---:|---:|
| `GET /board`, document HTML | 200 | 0.384 | 0.592 | 0.291 | 0.382 | 5,228 |
| `GET /board`, document JSON | 200 | 0.084 | 0.102 | 0.084 | 0.114 | 1,591 |
| `GET /board`, region JSON with `left` | 200 | 0.087 | 0.225 | 0.088 | 0.129 | 1,591 |
| `GET /board/1`, document HTML | 200 | 0.165 | 0.272 | 0.182 | 0.256 | 1,896 |
| `GET /board/1`, region JSON | 200 | 0.048 | 0.059 | 0.054 | 0.103 | 687 |
| `POST /board/create`, 422 region JSON | 422 | 0.025 | 0.031 | 0.028 | 0.051 | 415 |

| Rows | Generated render ms | Native render ms | `Bind::value` ms | `json_encode` ms | HTML bytes | JSON bytes |
|---:|---:|---:|---:|---:|---:|---:|
| 10 | 0.112 | 0.048 | 0.025 | 0.002 | 1,920 | 1,129 |
| 100 | 1.163 | 0.315 | 0.220 | 0.016 | 14,975 | 9,232 |
| 1,000 | 12.778 | 3.648 | 2.276 | 0.168 | 149,980 | 92,935 |

The `Bind::value` and `json_encode` columns are from the generated run; the native run measured 2.404 ms and 0.190 ms for 1,000 rows. Since commit "Lower the bundle limits and drop the repeated data model check of documents" the server runs `Bind::value` only for JSON responses, because rendering binds every value of a document (HY-44); the request table above was measured before that change. A run after it (load average 15) gave a document HTML p50 for `/board` of 0.357 ms generated and 0.247 ms native; with a different machine load and 10-row pages, where the check cost about 0.02 ms, the difference cannot be attributed to the change.

### Browser

| Measurement | Median ms | p95 ms |
|---|---:|---:|
| SSR first screen of `/board` | 6.7 | 23.2 |
| SSR region navigation to `/board/create` | 7.8 | 13.4 |
| CSR first screen of `/board` | 18.0 | 53.6 |
| CSR region navigation to `/board/create` | 7.4 | 8.9 |
| `hy-set` change, 10 rows | 0.8 | 2.9 |
| `hy-set` change, 100 rows | 2.6 | 6.1 |
| `hy-set` change, 1,000 rows | 26.8 | 34.0 |
| Template engine alone, 1,000 rows | 3.3 | 4.7 |

Phases of one `hy-set` change, in milliseconds:

| Rows | Change | Total | hyper | template | parse | morph | settle | process | events |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | `sort` | 2.51 | 0.09 | 0.39 | 0.43 | 1.21 | 0.01 | 0.34 | 0.03 |
| 100 | `compact` | 2.35 | 0.09 | 0.37 | 0.46 | 1.05 | 0.01 | 0.35 | 0.03 |
| 1,000 | `sort` | 27.13 | 0.31 | 3.33 | 3.09 | 16.38 | 0.00 | 3.83 | 0.19 |
| 1,000 | `compact` | 23.41 | 0.27 | 3.40 | 2.86 | 13.84 | 0.03 | 2.91 | 0.10 |

Main thread load of one `sort` change and its frame, in milliseconds:

| Rows | Total | Script | Style | Layout | Paint | GC | Other | Longest task | Tasks over 50 ms | DOM nodes |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 1.56 | 0.80 | 0.04 | 0.00 | 0.16 | 0.09 | 0.47 | 3.3 | 0 | 351 |
| 100 | 5.91 | 2.40 | 0.38 | 0.82 | 1.05 | 0.28 | 0.98 | 6.2 | 0 | 2,061 |
| 1,000 | 47.30 | 21.89 | 3.69 | 9.81 | 3.88 | 1.87 | 6.20 | 34.1 | 0 | 19,161 |

Memory over repeated navigation:

| Cycles | JS heap KB | DOM nodes | Event listeners | Documents |
|---:|---:|---:|---:|---:|
| 0 | 1,406 | 341 | 33 | 1 |
| 50 | 2,386 | 342 | 34 | 1 |
| 100 | 2,453 | 342 | 34 | 1 |
| 150 | 2,529 | 343 | 34 | 1 |
| 200 | 2,550 | 342 | 34 | 1 |

From cycle 100 to cycle 200 the heap snapshots show the same three kinds of growth as before: 400 `blink::NetworkResourcesData::ResourceData` objects of the DevTools network recording, compiled V8 code, and 200 `blink::MediaQuerySet` objects that the document's `StyleEngine` keeps for each inserted `<thead>`.

CSR loads 7 template files for `/board`; the slowest took 3.6 ms from the local server. The `/board` document is 4,398 bytes (1,428 gzip), and its region JSON is 1,341 bytes (541 gzip). The SSR script is 31,586 gzip bytes and the CSR shell 32,892 (`make bundle-size`).

## Findings

- **Server:** a region JSON response costs about a quarter of a document with the generated program and about a third with the native extension, because the browser renders it.
- **PHP rendering:** for 1,000 rows the generated program renders in 12.8 ms and the native extension in 3.6 ms, about the speed of the browser engine (3.3 ms). The earlier PHP AST interpreter took 16.7 ms on an idle machine (2026-10-01); this comparison crosses machine loads and is only indicative.
- **Data model check:** `Bind::value` (HY-44) takes 2.3 to 2.4 ms for 1,000 rows, two thirds of the native rendering time. Rendering binds the same values, so for documents the check repeated work; commit "Lower the bundle limits and drop the repeated data model check of documents" removed it from the document path and kept it for JSON.
- **First screen:** SSR shows it about 2.7 times as fast as CSR, because CSR requests JSON and template files after the shell.
- **`hy-set` at 1,000 rows:** the change takes 23 to 27 ms of script. The htmx `innerMorph` swap takes 14 to 16 ms of it, `htmx.process` about 3 ms, the template engine and HTML parsing about 3 ms each, and hyper 0.3 ms. htmx is outside the scope of this project's changes. No task exceeded 50 ms in this run.
- **Memory:** DOM nodes and event listeners stay constant over 200 cycles. The heap growth after the first 50 cycles consists of the DevTools network recording, compiled code and the `MediaQuerySet` objects that Chromium 153 keeps for inserted `<thead>` elements; it does not come from the application.
