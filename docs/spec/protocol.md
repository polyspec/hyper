# Region protocol

[한국어](protocol.ko.md).

This document defines the application manifest, routing, rendering, the requests and responses between a hyper server and the hyper browser code, and the two rendering modes. The server can render the first document as HTML (server-side rendering, SSR), or a static shell can render it in the browser (client-side rendering, CSR). Template syntax and rendering rules are defined by the template language; this document does not change them.

## Application manifest

- **HY-1** An application declares its structure in one JSON file, the manifest. Server and browser read the same manifest.

```json
{
  "layout": "layout.tpl",
  "title": "title.tpl",
  "regions": [
    { "name": "left", "template": "left.tpl", "uses": ["posts", "path"] },
    { "name": "content", "page": true }
  ],
  "routes": [
    { "name": "board.list", "path": "/board", "title": "Board", "template": "board/list.tpl", "regions": [{ "name": "rows", "template": "board/rows.tpl" }] },
    { "name": "board.create", "path": "/board/create", "title": "Write", "template": "board/create.tpl", "post": true },
    { "name": "board.show", "path": "/board/{id}", "title": "Post", "template": "board/show.tpl" }
  ]
}
```

- **HY-2** `regions` and `routes` are ordered lists. Region names and route names are unique. A region name matches `[A-Za-z][A-Za-z0-9_-]*` and is not `layout`, `title` or `data`. Exactly one region has `"page": true` and no `template`; every other region has a `template` and a list of used topics. A route with `"post": true` accepts a `POST` action. A server checks its manifest against these rules when it starts, and the asset build checks the manifest before it writes the client bundle; the browser does not check the manifest of its bundle again.
- **HY-3** The layout renders the title definition inside `<title>` with `{# title}`, the data definition with `{# data}` (HY-31), and each region with `{# name}` inside an element whose `id` is the region name, for example `<main id="content">{# content}</main>`. A region placement has no block arguments. The browser finds a region element by its `id`; no other marker exists.

## Routing

- **HY-4** A route path starts with `/`. The segments after it are separated by `/`. A segment is either a literal of the characters `A-Z a-z 0-9 . _ ~ -` or a parameter `{name}` where `name` matches `[A-Za-z_][A-Za-z0-9_]*`. The path `/` has no segments.
- **HY-5** A request path matches a route when it starts with `/`, has the same number of segments, every literal segment is equal to the request segment byte for byte, and every parameter segment is non-empty. The query string is not part of the path.
- **HY-6** A parameter value is the request segment with every `%XX` sequence (two hexadecimal digits) decoded to its byte. A segment with a `%` that is not followed by two hexadecimal digits, or whose decoded bytes are not valid UTF-8, does not match.
- **HY-7** Routes are tried in manifest order, and the first route that matches is the result. A path that matches no route has no result.
- **HY-8** An application may run under a base path such as `/api`. A request path is routed after removing the base path; a request path that does not start with the base path followed by `/` or the end of the path has no result. `Location` headers include the base path.
- **HY-9** `conformance/routes.json` holds routes and request paths with their expected results. The PHP router and the JavaScript router both pass every case.
- **HY-49** The last segment of a route path may be a rest parameter `{name*}`, with `name` as in HY-4 and different from the other parameters of the path. It stands at zero or more remaining request segments and matches when every one of them is empty or decodes by HY-6. Its value is the rest of the request path without decoding: `/` followed by the remaining segments joined with `/`, or `/` when none remains. `conformance/rest.json` holds routes and request paths with their expected results; the PHP router and the JavaScript router both pass every case.

## Data and topics

- **HY-10** Shared data is one map that the layout, the title and every region receive. It starts with `title`, the route title, and `csrf`, the session token of HY-24, followed by the values that the application adds.
- **HY-11** Every non-page region declares the topics it uses. A topic names data that can change, such as `posts`. The topic `path` is built in: it changes when the request path differs from the path of the `HX-Current-URL` request header after removing the base path.

## Rendering

- **HY-12** A document is the layout rendered with root data equal to the shared data and with `html` definitions: `title` (the title rendered alone), `data` (HY-31) and one per manifest region, the region rendered alone. The page region template is the route template.
- **HY-13** A region rendered alone uses the region template and the root data `merge(shared, region data)`, where a region data value replaces a shared value with the same name. The page region receives every route region of its route, rendered alone, as an `html` definition. The title rendered alone uses the title template and the shared data. The server and the browser compose documents and region parts in this same way, so they produce the same bytes.
- **HY-14** Server and browser render with the same environment. The server sends the time zone in every JSON response.
- **HY-48** The PHP server renders with a program that the build compiles from the application templates: with the native template extension `polyspec_template` when PHP has loaded it, and otherwise with the generated PHP program of the same templates. The program renders documents and regions as HY-12 and HY-13 define. Both programs pass the same tests and `make parity`. The build compiles the generated program into a PHP namespace that the application chooses, so it declares no global name and the programs of several applications load in one PHP process.

## Requests

- **HY-15** A request with `Accept: application/json` and `HX-Request: true`, which htmx sends with every request, is a region request. A request with `Accept: application/json` and no `HX-Request` is a document request. Any other request is an HTML request and receives an HTML document. A region request always updates the page region (HY-18).
- **HY-56** The raw query of a request is the request target after its first `?` up to its first `#`, or empty text without a `?`. Its values are read without nesting: the raw query is split at every `&` and an empty part is skipped; the name of a part is the text before its first `=` and the value is the rest, or empty text when the part has no `=`; in both, `+` is a space, `%XX` with two hexadecimal digits is its byte and any other `%` stays. A name with brackets, such as `roles[]` or `a[b]`, is the name as written, and an empty name is a name. The query values are an ordered map from each name, in the order of its first occurrence, to the list of its values in request order; a name or value that is not valid UTF-8 fails with HY-42. `Request` provides the raw query and the query values, and `queryInt` reads the last value of a name. `conformance/fields.json` holds texts with their values, and both servers pass every case.
- **HY-57** The form values of a request are read from its raw body without nesting, as an ordered map like the query values of HY-56. An `application/x-www-form-urlencoded` body is read as the raw query is. A `multipart/form-data` body gives one value for each part whose `Content-Disposition` is `form-data` with a `name` parameter and no `filename` parameter: the name is that parameter and the value is the content of the part as it is; a part with a `filename` is a file and not a form value. A body of another type has no form values. A name or value that is not valid UTF-8 fails with HY-42. The PHP server reads the body from `php://input`, not from `$_POST`, which nests bracketed names; PHP gives it the body of a `multipart/form-data` request only when `enable_post_data_reading` is off. `Request` provides the form values, and `formString` reads the last value of a name. `conformance/fields.json` holds urlencoded and multipart cases, and both servers pass every case.

## JSON response

- **HY-17** A JSON response has this shape. Keys keep their order.

```json
{
  "env": { "timezone": "+09:00" },
  "route": "board.show",
  "params": { "id": "7" },
  "shared": { "title": "Post", "csrf": "token" },
  "regions": {
    "content": { "post": { "id": 7 } },
    "reader": { "large": false },
    "left": { "count": 3 }
  },
  "kept": {
    "reader": { "large": true }
  }
}
```

`regions` holds the loader data. `kept` holds, by region and path, the `server` and `cookie` kept values that the server read for the regions in `regions` and that conform to the region data (HY-38). A region without such values has no entry.

- **HY-18** For a document request, `regions` contains every region in manifest order. For a region request, it contains the page region first, then every other region that uses a changed topic, in manifest order.
- **HY-19** The changed topics of a request are the topics recorded by the previous action (HY-25) and `path` (HY-11).

## Browser

- **HY-20** The browser code routes the response URL path (after removing the base path) with the manifest routes. The route name must equal `route` in the response; otherwise rendering fails. The page region template is the template of that route.
- **HY-21** The htmx extension requests JSON (`Accept: application/json`) only when the `id` of the request target element is the name of the page region. It converts a JSON region response into this HTML and gives it to htmx in place of the response text: `<title>` with the title rendered alone, then the page region rendered alone, then `<hx-partial hx-target="#<name>" hx-swap="innerMorph">` with each other region rendered alone. htmx then performs the swap, the title change and the history update. A response whose content type is not `application/json` passes unchanged.
- **HY-22** In client-side rendering, a static shell declares the base path of the server with `<meta name="hyper-api" content="/api">`. The browser code requests the document JSON for the current path while it loads the templates of the route (HY-35), routes the response URL after redirects (HY-20), renders the document (HY-12), replaces the title and the body with the rendered ones, and lets htmx process the new body. A current path that matches no route renders the body text `Not Found`.
- **HY-23** In client-side rendering, the extension prefixes the same-origin request path of every region request with the base path, removes the base path from history paths, and replaces htmx history restoration with HY-22 for the restored path. A later restoration cancels an earlier one that is still loading, and only the latest one is rendered.

## Actions

- **HY-24** An action request must contain the form field `_csrf` equal to the session token; otherwise the server responds with status 403 and runs no action.
- **HY-25** An action that succeeds returns a redirect. The server responds with status 303 and `Location`, stores the flash values and the changed topics in the session, and removes them after the next request reads them. The browser follows the redirect with the same headers, and htmx records the final URL in history.
- **HY-26** An action that rejects its input returns invalid data. The server responds with status 422 and renders the route page with the route data merged with the invalid data, as JSON for a JSON request and as a document otherwise.

## Data

- **HY-29** The output of a region is a function of its template, the shared data and the region data. The browser changes the page only by replacing region data and rendering it. Form controls hold the values that a user is entering; every other screen state, such as a sort order or an open panel, is region data.
- **HY-30** A route may declare route regions, for example `"regions": [{ "name": "rows", "template": "board/rows.tpl" }]`. A part of a page that changes in the browser without a request is a route region. The route template places each route region with `{# name}`, without block arguments, inside an element whose `id` is the region name. Region names are unique across the manifest regions and every route region. Each route region has its own loader. The page region receives every route region as HTML (HY-13), and every JSON response that contains the page region contains the route regions right after it.
- **HY-31** The layout places `{# data}` once, before `</body>`. The definition `data` renders the reserved template `hyper/data.tpl`, whose source is exactly `<script type="application/json" id="hy-data">{= json(response) | raw}</script>`, with `response` equal to the document JSON value (HY-17 with every region, HY-18). The server and the browser render it the same way, so a document keeps the same bytes in both. A region request does not render it.

## Browser data

- **HY-32** The browser holds the data of the last response that it rendered: the environment, the route, the parameters, the shared data and the data of every region in the response. When the page loads, and when htmx restores a page from history by requesting its HTML, the browser reads the data from the element `#hy-data`, replaces all held data with it and starts loading the templates of the route (HY-35). `render` (HY-33) replaces held region data.
- **HY-33** The browser code provides `data(region)`, which returns the held data of a region; `render(region, data)`, which replaces the held data of a region; and `set(region, path, value)`, which replaces one value at a dotted path (map keys and list indexes) in the held data of a region. A path that the data does not contain fails. `render` and `set` then render the region alone (HY-13) and swap it into the region element with `innerMorph`. The page region uses the template of the held route and the held route regions (HY-13). These operations send no request. There is no change tracking: the code that changes data asks for the rendering. Calls run one after another in call order, and each starts from the held data that the previous call left. A call checks the held data of its own region: when a response (HY-32) replaced it before the swap, the call ends without swapping, holding or storing; when a response replaced it during the swap, the call does not hold or store and renders the region again from the held data. A response that leaves the region unchanged does not affect the call.
- **HY-36** A template may give an element the attribute `hy-set="path=value; path=value"`, where each value is a JSON literal and each path follows HY-33. A click on the element, or on an element inside it, runs every assignment in the held data of the closest enclosing element whose `id` is the name of a region of the manifest or of the held route and renders that region once. The template computes the assigned values, for example `hy-set="service.close.flag={? service.close.flag}0{:}1{/}"`. `hy-set` works only with JavaScript.

## Template delivery

- **HY-34** The asset build writes every template AST to its own file whose name contains a hash of its content, and an index that maps each template name to its file URL and to the names of the templates that its include and block tags reference by path. The index also contains `hyper/data.tpl`. The client bundle contains the index and the name of `hyper/data.tpl`, and no template.
- **HY-35** Before rendering, the browser loads the templates that a route needs: the layout, the title, `hyper/data.tpl`, every non-page region template, the route template and every route region template, together with every template that they reference, transitively. For a region request the loading starts with the request and runs at the same time. When the response URL routes to another route, such as after a redirect, the browser loads the templates of that route before rendering. Loaded templates stay loaded until the page unloads.

## Kept data

- **HY-37** A non-page region or a route region may declare kept paths, for example `"keep": { "notice.closed": "server", "sort": "localStorage" }`. A path follows HY-33. A kept value survives a reload in the storage named by its kind:

| Kind | Storage | Request when the value changes | First SSR document |
|---|---|---|---|
| `server` | the server session | one background request that rendering does not wait for | contains the value |
| `cookie` | the cookie `hy-keep`, written by the browser code; it cannot be `HttpOnly` | none | contains the value |
| `localStorage` | the browser `localStorage` | none | contains the loader value; the browser renders the kept value after it loads |
| `sessionStorage` | the browser `sessionStorage` of the tab | none | contains the loader value; the browser renders the kept value after it loads |

- **HY-38** The value that the user set last in the browser takes precedence; the loader data is the default. A kept value conforms to the value at its path when the region data contains the path, the kept value is a value of the template data model (a number outside ±(2^53 − 1) is not), and:
  - a null, boolean, number or string has the same type;
  - a map replaces a map; when the data map has keys, the kept map has the same keys and the value of every key conforms to the value of the same key;
  - a list replaces a list; when the data list has items, every kept item conforms to its first item.

  An empty data map or list gives no shape, so any map or list conforms to it; the rendering check below covers such values.

  A kept value that does not conform is ignored.
  - The server reads `server` and `cookie` values and sends the conforming ones in `kept` (HY-17). They never change `regions`.
  - A region renders with its kept values applied to its data in this order: the values in `kept`, the `localStorage` and `sessionStorage` values, and the `server` values whose saving has not completed (HY-39). The server applies only the values in `kept`. The browser applies all of them to the data that it holds and renders, and does not synchronize them with the server. For a document rendered by the server, the browser applies them after loading and renders every region whose data changed.
  - When a region does not render alone (HY-13) with its kept values applied, it renders with its loader data, and its kept values are removed from `kept` and from the held data. Route regions are checked before the page region, because the page region includes them (HY-30). The server removes them before it renders the embedded data (HY-31), so the server and the browser render the same document. When the region does not render with its loader data either, rendering fails (HY-43, HY-47).
- **HY-39** When `set`, `render` or `hy-set` changes a path, the browser renders the region first and then stores every kept path that equals the changed path, lies under it or contains it, with the value now at the kept path. A `server` value stays pending until the server answers 204 for it or a later change of the same path is saved; while it is pending it is applied as in HY-38. Saves of one path are sent one at a time: a change made while a save of its path is in flight is sent after that save completes, and only the latest value is sent. A failed save keeps the value pending and marks the region as failed (HY-47) when no later change of the path exists. For `server` it sends `POST <base path>/_hyper/keep` with the form fields `_csrf` (the held `shared.csrf`, HY-10), `region`, `path` and `value` (the JSON text of the value) and does not wait for the response. For `cookie` it writes the cookie `hy-keep` with `Path=/`, `SameSite=Lax` and `Max-Age` of one year; on HTTPS the cookie is `__Host-hy-keep` and also `Secure`, so that another host, such as a sibling subdomain, cannot set it. The server reads `__Host-hy-keep` when the request uses HTTPS or the application declares HTTPS (HY-45), and `hy-keep` otherwise. The cookie value is the URL-encoded JSON object `{ "<region>": { "<path>": <value> } }`.
- **HY-40** The server answers `POST <base path>/_hyper/keep` with status 204 after it stores the value in the session, with status 403 when the CSRF token does not match, and with status 400 when the region does not declare the path as `server`, the value is not JSON, the JSON text is longer than 4,096 bytes, or the value is not a value of the template data model. The path `/_hyper/keep` is reserved; a route path may not start with `/_hyper`.
- **HY-41** `conformance/keep.json` holds region data, kept values and the expected data after HY-38. The PHP and JavaScript implementations both pass every case.

## Request boundary and failures

- **HY-42** The request path is the path of the request target: the target up to its first `?` or `#`, and for an absolute-form target (`http://host/path`) the part after the authority. It is not decoded further. The path must consist of the printable ASCII characters `!` to `~`, as RFC 9112 requires of a request target, and every query and form name and value (HY-56, HY-57) and the `HX-Current-URL` header must be valid UTF-8; otherwise the server responds with status 400 before any loader or action runs. Cookies are not checked: the server ignores a `hy-keep` cookie that is not a JSON object, ignores its values that do not conform (HY-38), and starts a new session for a session cookie that is not an identifier that it created (HY-45).
- **HY-43** An exception that the application does not handle produces status 500 with the text `Internal Server Error`. The response contains no exception message, file path or stack trace; the server writes them to its log. The PHP setting `display_errors` must be off before PHP starts the request, because PHP writes startup warnings (for example `max_input_vars`) before the application runs.
- **HY-44** Shared data and region data are values of the template data model. A number outside ±(2^53 − 1), integer or not, fails with HY-43, for a document and for JSON alike. A document fails when the rendering binds the value; JSON, which the server does not render, is checked before it is encoded.
- **HY-45** The server session cookie is `HttpOnly` and `SameSite=Lax`. It is `Secure` when the request uses HTTPS or when the application declares that it is served over HTTPS, which a server behind a TLS-terminating proxy must do. The server accepts only session identifiers that it created, and starts a session only when a request reads or writes session data: a request that the server rejects before routing (HY-42) or whose path matches no route creates no session. Every response carries `Content-Security-Policy: frame-ancestors <sources>`, where the application sets the sources and the default is `'self'`.
- **HY-46** A redirect location is an application path: valid UTF-8 that starts with `/`, whose second character is neither `/` nor `\`, that contains no control character (C0, DEL or C1), no space and no `\`, and whose path has no segment `.` or `..`, also when a dot is percent-encoded (`%2e`).
- **HY-47** When a region request receives a response that is not JSON, or when rendering, saving a kept value or loading templates fails, the browser does not swap and does not change history. It sets the attribute `hy-error` on the region element to the response status, or to `0` for a network or rendering failure, and removes the attribute from every region that renders successfully afterwards. A cancelled request is not a failure; a request that htmx aborts because its timeout (`hx-timeout`, or `htmx.config.defaultTimeout`) passed is a network failure. `render`, `set` and `hy-set` change held data only after the region rendered; a failure leaves held data unchanged. When client-side rendering of a document fails, the browser sets `hy-error` on the body.

## Node server

- **HY-54** The Node server package `@polyspec/hyper-server` implements the server rules of this document as the PHP server does; its tests run the cases of the PHP server tests against the same fixtures. It differs from the PHP server only as follows:
  - It renders a document as the browser renders the document JSON value (HY-12, HY-31, HY-38), with the browser code and the template files of the asset build (HY-34).
  - Its JSON text has the bytes of PHP `json_encode` with `JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES`. A string escapes `"`, `\`, the control characters below U+0020 (`\b`, `\f`, `\n`, `\r`, `\t`, and `\u00xx` for the others) and U+2028 and U+2029 (`\u2028`, `\u2029`), and no other character. An integer within ±(2^53 − 1) is written in decimal. Another number is written with the shortest digits that read back as the same number: positionally when its decimal point position p (the number is 0.d × 10^p) is between −3 and 17, and otherwise as `d.ddde±x` with at least one fraction digit; negative zero is `-0`. It decodes kept values (HY-38, HY-40) as PHP `json_decode` does: an integer literal is an integer and other literals are floats, a number outside ±(2^53 − 1) or one that is not finite is not a value of the data model, and 512 nested containers, a lone surrogate escape or a key that starts with U+0000 fail. `conformance/json.json` holds the cases that both servers pass.
  - A JavaScript value of the data model is null, a boolean, a number or a bigint within ±(2^53 − 1), a string, an array, a `Map` with string keys or a plain object. A string with a lone surrogate, which has no UTF-8 form, and any other value fail with HY-43.
  - Loaders and actions receive one context argument with the request, the reply (HY-52) and the services that the application binds by key.
  - Its session store keeps each session in a file of one directory, named by an identifier of 64 hexadecimal digits that the store created. It writes the session cookie with the attributes and the order of the PHP session cookie (`<name>=<id>; path=/; secure; HttpOnly; SameSite=Lax`, `secure` under the conditions of HY-45), and it runs the requests of one session one after another.
  - A request body larger than its limit, 8 MiB by default, receives status 413.

- **HY-55** `make server-parity` runs the steps of `examples/board/tests/parity/requests.json` against the PHP server and the board Node server at the same time, each with its own empty database and session and with the same creation time of posts (`BOARD_TIME`). For every request of the steps, the HTML document, the document JSON and the region JSON alike, the status, the headers and the body of both responses must be equal. Before the comparison it replaces the session identifier in the session cookie with `<session>`, the CSRF token of each session with `<csrf>` in headers and bodies, and the `ETag` value with `<etag>` after it checks that the value is the tag of its body (HY-53), because the body contains the token. It leaves out the headers that the HTTP server program writes by itself: `Date`, `Connection`, `Keep-Alive`, `Content-Length`, `Transfer-Encoding`, and the `Host` and `X-Powered-By` of the PHP built-in server. Headers are compared as a set of name and value pairs, and `Set-Cookie` with each of its values. The same run also performs the browser comparison of `make parity` against the PHP server.

## Errors

- **HY-27** A path without a route, or a loader that reports a missing resource, responds with status 404. A method other than `GET` or a declared `POST` responds with status 405.
- **HY-50** A loader or an action may stop the request with a redirect: it throws the redirect of a result of HY-25, which names an application path (HY-46) and may carry flash values and changed topics. The server responds with status 303 and `Location` with the base path, stores the flash values and the changed topics as HY-25 does, and renders nothing.
- **HY-51** A loader or an action may stop the request as forbidden. The server responds with status 403 and the text `Forbidden`, and runs no other loader or action of the request.
- **HY-52** Every loader and action of a request may receive the reply of the request. The reply adds a cookie with a name of `[a-z][a-z0-9_-]*` that does not start with `hy-`, a value of the characters `A-Z a-z 0-9 . _ ~ -` and an optional `Max-Age`, or removes a cookie with `Max-Age=0`. Each such cookie has `Path=/`, `HttpOnly`, `SameSite=Lax` and `Secure` under the conditions of HY-45. Another name or value fails with HY-43. A page response has `Cache-Control: no-store`; the reply may set the `Cache-Control` of a page response with status 200, and its value replaces `no-store`. The server session adds only its cookie to a response, and no caching header. A response without a body, other than a 304 of HY-53, has no `Content-Type`. The response of the request contains the cookies of its reply, whether it is a page, a redirect or a failure of HY-27, HY-50 or HY-51.
- **HY-53** A JSON response with status 200 has a strong `ETag` made of the first 32 hexadecimal digits of the SHA-256 digest of its body. A `GET` request whose `If-None-Match` header equals that tag receives status 304 with the same headers and no body; an action runs whatever tag its request names.
- **HY-58** A loader or an action may stop the request as a bad request. The server responds with status 400 and the text `Bad Request`, and runs no other loader or action of the request. An action may also return the route page with a stated status of 200, 409 or 422 and data: the server renders the route page with the route data merged with that data, as JSON for a JSON request and as a document otherwise, and responds with that status. Another status fails with HY-43. HY-26 is the page with status 422; a page with status 200 follows HY-52 and HY-53.
- **HY-28** An error in the browser code is thrown from the htmx response hook. htmx reports it with the `htmx:error` event and does not swap.
