# Deployment

[한국어](deployment.ko.md).

One application deploys in two forms. Both use the same manifest, templates, client bundle and PHP handlers.

| Form | First document | Later navigation | Use |
|---|---|---|---|
| Server and CDN (recommended) | PHP renders it (SSR) | JSON, rendered by the browser | Every application whose server can render HTML |
| Static shell | The browser renders it from `/api` JSON (CSR) | JSON, rendered by the browser | A backend that serves JSON only |

## Server and CDN (recommended)

The server tells the two kinds of requests apart by their headers (HY-15). A direct request (the address bar, a reload, a bookmark, a search crawler or a link preview bot) has no `HX-Request` and receives the complete document. A request from htmx inside a page carries `Accept: application/json` and `HX-Request` and receives JSON, which the browser renders. Search engines and link previews therefore always receive complete documents with their titles.

| Path pattern | Origin | Behavior |
|---|---|---|
| `/assets/*` | S3 bucket with `public/assets` | `GET` and `HEAD`. The client script and the template files carry content hashes in their names: `Cache-Control: public, max-age=31536000, immutable`. |
| default (`*`) | PHP server | All methods, no caching, forward the `Cookie` (the session cookie and `__Host-hy-keep`), `Accept`, `HX-Request`, `HX-Current-URL` and `Content-Type` headers and the query string. |

PHP runs without a base path. Responses carry `Vary: Accept, HX-Request, HX-Current-URL`.

Deploy `build/server`, which `make server` writes, next to the PHP code; the application opens it with `App::open(program: ...)`. For the fastest rendering, build the native template extension with `make ext` for the PHP version of the server and load it with the `extension` setting of `php.ini`. Without the extension, PHP renders with the generated program in `build/server/program.php` (HY-48).

## Static shell

`make assets` writes `examples/board/build/csr/`: `index.html` with the client entry inlined and no stylesheet (HY-76), `assets/templates/` with one file per template, and the stylesheets `assets/app.css` and `assets/reader.css`, which `make assets` copies from `public/assets/` because the asset build copies no stylesheet, and which the rendered layout links and the browser applies before it shows a page (HY-64).

1. Upload `index.html` to an S3 bucket with `Content-Type: text/html; charset=utf-8` and `Cache-Control: no-cache`, `assets/templates/*` with `Content-Type: application/json` and `Cache-Control: public, max-age=31536000, immutable`, and `assets/*.css` with `Content-Type: text/css; charset=utf-8` and `Cache-Control: no-cache`, because their names carry no hash.
2. Run PHP with the environment variable `BOARD_BASE_PATH=/api` (HY-8).
3. Route `/api/*` to PHP as in the table above, `/assets/*` to S3, and every other path to `/index.html` with a CloudFront Function on viewer request.
4. Send a Content Security Policy that allows the inline entry by hash and the chunk files and linked stylesheets by `'self'`; `make assets` prints the policy. Upload chunk files `assets/hyper-chunk-*.js` with `Content-Type: text/javascript; charset=utf-8` and `Cache-Control: public, max-age=31536000, immutable`, because their names carry a hash.

Every page path returns the same empty shell, so search crawlers that do not run JavaScript and link preview bots see no content and no title. Use this form only for screens that do not need them.

## One server for both forms

One PHP or Node server can answer the server-rendered pages and the client-rendered pages of one manifest with the same handlers (HY-62). The application declares client rendering when it opens: `App::open(clientRendering: new ClientRendering(shell: '/srv/app/build/csr/index.html', basePath: '/_props', selects: fn (Request $request): Choice => new Choice(chosen: ..., value: ...)))` in PHP, and the `clientRendering` option `{ shell, basePath, selects }` of `App.open` in Node. The selection chooses the client-rendered requests, for example by the `Host` header, and its value, such as the stored service of the host, reaches every loader and action of the request through `$request->selection()` in PHP and `request.selection()` in Node, so that the handlers do not read it again. Build the shell with `scripts/build-assets.mjs --api /_props`, so that it declares the data base path; the application fails to open otherwise.

| Request of a chosen page | Response |
|---|---|
| HTML `GET` of a page path | The shell, `Cache-Control: no-cache`, without a session or a loader |
| JSON request or action under `/_props` | JSON and actions as in the server form, with `Location` under `/_props` |
| HTML request under `/_props`, JSON request outside it | 406 |

A request that the selection does not choose is answered as in the server form. The shell response carries `frame-ancestors` (HY-45) and is reported to the response hook (HY-60). The browser gives the `html` element the attributes of the rendered layout, such as its `lang` (HY-63).

## Server settings

- Set `display_errors=Off` in the PHP configuration (`php.ini`, PHP-FPM pool, or `php -d display_errors=0`). PHP writes startup warnings, such as an exceeded `max_input_vars`, before the application runs. An exception inside the application answers 500 without details and is logged (HY-43).
- Set `post_max_size` to the body limit of the application or more (8 MiB, PHP's default `8M`, by default), and set `enable_post_data_reading=Off` when the application accepts `multipart/form-data`; `App::run` fails otherwise (HY-59).
- The session cookie is `__Host-hy-session` on HTTPS and `hy-session` otherwise, with `Path=/`, no `Domain`, `HttpOnly`, `SameSite=Lax`, and `Secure` on HTTPS (HY-45). Behind a CDN that terminates TLS, PHP receives plain HTTP: open the application with `https: true` (the example reads `BOARD_HTTPS=1`) so that the cookie keeps its `__Host-` name and stays `Secure`.
- A page carries a masked CSRF token of its visitor (HY-24), so `Cache-Control` of a page must keep it out of shared caches (HY-52), and a sign-in or sign-out action calls `renewSession()` of its reply (HY-72).
- Every response carries `Content-Security-Policy: frame-ancestors 'self'` (HY-45). `App::open(frameAncestors: ...)` changes the sources; the example reads `BOARD_FRAME_ANCESTORS`. A static shell on S3 needs the same header from a CloudFront response headers policy, because `frame-ancestors` has no effect in a `<meta>` policy.

## Local reproduction

`make serve-demo` runs both forms on one database:

| URL | Role |
|---|---|
| `http://127.0.0.1:8080/board` | Server form: PHP at the root |
| `http://127.0.0.1:8082/api/board` | PHP with `BOARD_BASE_PATH=/api` |
| `http://127.0.0.1:8081/board` | Static shell: `scripts/serve-edge.mjs` returns files of `build/csr/`, the shell for every other path, and forwards `/api/*` to port 8082 |
| `http://127.0.0.1:8081/compare?ssr=http://127.0.0.1:8080` | The comparison page: both forms in two frames and the result of comparing their bodies. It is a development tool and is not part of a deployment. |
