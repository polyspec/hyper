# Benchmark

[한국어](benchmark.ko.md).

`make bench` measures the board example on the server and in the browser. The results are reports and do not pass or fail. Run the measurement on an idle machine; another busy process changes the mean and p95 more than the median.

| Target | Script | Measures |
|---|---|---|
| `make bench-server` | `scripts/bench-server.php --app <directory> --iterations <n>` | `App::handle` per request kind without network, and the cost of `board/rows.tpl` rendering, `Bind::value` and `json_encode` for 10, 100 and 1,000 rows |
| `make bench-browser` | `scripts/bench-browser.mjs --ssr <port> --edge <port> --api <port> --runs <n>` | First screens, region navigation, one `hy-set` change for 10, 100 and 1,000 rows (time, phases, main thread load and long tasks), memory over repeated navigation with the growth between two heap snapshots, template loading, transferred bytes, and a Chromium table section measurement |

Both scripts create their own database under `examples/board/var/` and remove it when they finish. `bench-browser` starts `scripts/serve-demo.mjs` on ports 8085 to 8087.

## Method

- **Server:** every request runs 20 times as warm-up and then the given number of times in one process with an in-memory session. The time is `hrtime` around `App::handle`. It includes routing, loaders on SQLite, rendering and encoding, and excludes network and PHP startup.
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

Measured on 2026-10-01 on an idle Apple M3 Pro with PHP 8.5.10, Chromium 153.0.8010.12 and Node 26.8.1. The database has 30 posts, and a list page shows 10.

### Server

| Request | Status | p50 ms | p95 ms | Bytes |
|---|---:|---:|---:|---:|
| `GET /board`, document HTML | 200 | 0.511 | 0.583 | 5,258 |
| `GET /board`, document JSON | 200 | 0.070 | 0.086 | 1,581 |
| `GET /board`, region JSON with `left` | 200 | 0.067 | 0.083 | 1,581 |
| `GET /board/1`, document HTML | 200 | 0.220 | 0.280 | 1,916 |
| `GET /board/1`, region JSON | 200 | 0.041 | 0.057 | 677 |
| `POST /board/create`, 422 region JSON | 422 | 0.022 | 0.028 | 405 |

| Rows | Render ms | `Bind::value` ms | `json_encode` ms | HTML bytes | JSON bytes |
|---:|---:|---:|---:|---:|---:|
| 10 | 0.192 | 0.017 | 0.002 | 1,920 | 1,119 |
| 100 | 1.653 | 0.151 | 0.016 | 14,975 | 9,222 |
| 1,000 | 16.705 | 1.449 | 0.150 | 149,980 | 92,925 |

### Browser

| Measurement | Median ms | p95 ms |
|---|---:|---:|
| SSR first screen of `/board` | 7.0 | 18.5 |
| SSR region navigation to `/board/create` | 9.2 | 20.1 |
| CSR first screen of `/board` | 17.6 | 28.3 |
| CSR region navigation to `/board/create` | 9.8 | 16.3 |
| `hy-set` change, 10 rows | 1.1 | 2.1 |
| `hy-set` change, 100 rows | 2.8 | 3.8 |
| `hy-set` change, 1,000 rows | 24.8 | 28.1 |
| Template engine alone, 1,000 rows | 2.9 | 4.2 |

Phases of one `hy-set` change, in milliseconds:

| Rows | Change | Total | hyper | template | parse | morph | settle | process | events |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | `sort` | 2.81 | 0.13 | 0.39 | 0.51 | 1.38 | 0.01 | 0.35 | 0.03 |
| 100 | `compact` | 2.35 | 0.11 | 0.35 | 0.51 | 1.02 | 0.01 | 0.33 | 0.01 |
| 1,000 | `sort` | 24.92 | 0.33 | 2.81 | 2.99 | 15.46 | 0.04 | 3.21 | 0.08 |
| 1,000 | `compact` | 22.29 | 0.22 | 3.07 | 2.83 | 13.24 | 0.01 | 2.81 | 0.11 |

Main thread load of one `sort` change and its frame, in milliseconds:

| Rows | Total | Script | Style | Layout | Paint | GC | Other | Longest task | Tasks over 50 ms | DOM nodes |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 1.96 | 1.04 | 0.07 | 0.00 | 0.23 | 0.10 | 0.53 | 2.6 | 0 | 355 |
| 100 | 6.08 | 2.35 | 0.39 | 0.90 | 1.09 | 0.35 | 1.00 | 4.1 | 0 | 2,065 |
| 1,000 | 42.87 | 19.87 | 3.48 | 9.30 | 3.14 | 1.51 | 5.57 | 31.0 | 0 | 19,165 |

Memory over repeated navigation:

| Cycles | JS heap KB | DOM nodes | Event listeners | Documents |
|---:|---:|---:|---:|---:|
| 0 | 1,402 | 345 | 33 | 1 |
| 50 | 2,346 | 346 | 34 | 1 |
| 100 | 2,439 | 346 | 34 | 1 |
| 150 | 2,505 | 346 | 34 | 1 |
| 200 | 2,525 | 346 | 34 | 1 |

Objects that grew from cycle 100 to cycle 200:

| Objects | Count | Bytes | Retained by |
|---|---:|---:|---|
| `blink::NetworkResourcesData::ResourceData` | 400 | 115,200 | The network recording of the attached DevTools protocol session; four requests per cycle |
| V8 code objects (`InstructionStream`, `TrustedByteArray`, `Code` and others) | | about 76,000 | Compiled code of the client bundle |
| `blink::MediaQuerySet` with its `MediaQuery` and `MediaQueryFeatureExpNode` | 200 each | about 32,000 | `StyleEngine` of the document; one per navigation to `/board`, see below |

Chromium table section measurement:

| Section inserted and removed 300 times | `blink::MediaQuerySet` before | After |
|---|---:|---:|
| `<thead>` | 2 | 302 |
| `<tbody>` | 2 | 2 |

CSR loads 7 template files for `/board`; the slowest took 3.3 ms from the local server. The `/board` document is 4,428 bytes (1,426 gzip), and its region JSON is 1,331 bytes (535 gzip).

## Findings

- **Server:** a region JSON response costs about one seventh of a document, because the browser renders it.
- **First screen:** SSR shows it about 2.5 times as fast as CSR, because CSR requests JSON and template files after the shell. This supports the recommended deployment.
- **`hy-set` at 1,000 rows:** the change takes 22 to 25 ms of script.
  - The htmx `innerMorph` swap takes 13 to 15 ms of it, also when the row order does not change. When one class of the table changes, the morph still compares all 1,000 rows in JavaScript.
  - `htmx.process` takes another 3 ms, because htmx processes every child of the region after a morph, including unchanged ones.
  - The template engine takes 3 ms and HTML parsing 3 ms.
  - The frame after the change adds about 12 ms of style and layout. This is the browser cost of laying out the changed table.
- **Long tasks:** one earlier run of 15 changes at 1,000 rows had one task of 137 ms. Its parts were not recorded, and no task over 50 ms appeared in 165 later changes. The cause is unknown; the measurement now prints the parts of every such task.
- **Memory:**
  - DOM nodes and event listeners stay constant over 200 cycles, so swapped regions leave no nodes or listeners behind.
  - The JavaScript heap grows during the first 50 cycles, while templates are loaded and code is compiled.
  - After that the growth consists of the DevTools network recording, compiled code, and the `MediaQuerySet` objects.
  - Chromium 153 keeps one `MediaQuerySet` (about 160 bytes) for every `<thead>` element inserted into a document, until the document closes. It does so without htmx and without an attached DevTools session. The list template contains a `<thead>`, so every navigation to `/board` adds one. This growth comes from Chromium, not from the application, and it has no limit.
- **PHP rendering:** PHP renders 1,000 rows about six times slower than the browser engine. This affects first documents.
