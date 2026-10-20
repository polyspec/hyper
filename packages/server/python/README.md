<!-- doc-id: hyper-server-python-readme -->
# polyspec-hyper-server

[한국어](README.ko.md).

The Python server of the [region protocol](../../../docs/spec/protocol.md): routing, query and form values, the
masked CSRF token and JSON text with the bytes of the PHP server, all as an independent implementation of the same
rules. The conformance cases of `contracts/routes.json`, `rest.json`, `csrf.json`, `fields.json` and `json.json`
run as `unittest` tests (`make hyper-test-python`).

Replace `vX.Y.Z` with the first release tag that contains `packages/server/python`. No release tag carries the package yet.

```sh
pip install "polyspec-hyper-server @ git+https://github.com/polyspec/hyper@vX.Y.Z#subdirectory=packages/server/python"
```

```python
from polyspec.hyper.request import Request
from polyspec.hyper.result import Result

request = Request("GET", "/board/7", {}, "page=2")
request.path(), request.query().get("page")  # ('/board/7', ['2'])
Result.redirect("/board/7")  # the outcome of an action that succeeded (HY-25)
```

- `Request` holds one HTTP request with its route parameters, flash values, cookies and selection value (HY-15,
  HY-42, HY-56, HY-57, HY-62); `target_path` and `target_query` split a request target, and `with_header(name,
  value)` returns a copy whose header of the name, compared without case, has the value (HY-97).
- `Result` is the outcome of an action (HY-25, HY-26, HY-46, HY-58), `Reply` the cookies, the cache control, the
  page status and the data embedding of a response (HY-52, HY-69, HY-92), and `NotFound`, `Forbidden`, `BadRequest`
  and `Redirect` the stops of loaders and actions (HY-27, HY-50, HY-51, HY-58).

- `App.open` creates an application from its manifest, the server program that `hyper-build-server` of
  `@polyspec/hyper-build` built (the `templates` directory and `reads.json` of it; the Python server needs neither
  the directory `php` nor `program.json`, which the generated PHP program uses) and the handlers that load data and run
  actions; `App.handle` answers one request (HY-8, HY-15 to HY-19, HY-24 to HY-27, HY-40, HY-50 to HY-62,
  HY-65 to HY-67). A handler parameter receives the request or the reply by its type, and an application service
  of the class that `App.bind` registered. the answer of `App.handle` answers a request as `App.handle` does and returns the
  response with the reply of the request.
- `on_response` of `App.open` is called once for every response with the request, the response, the elapsed
  milliseconds, the reply of the request and the failure of a 500 (HY-60). `on_disconnect` is called once with the
  request, the elapsed milliseconds and the reply of a request whose response the server could not write because
  the client closed the connection; the server renders the complete response and calls `on_response` first, and it
  does not detect a close when every write of the response succeeds (HY-67). A value of `on_disconnect` that is not
  callable fails when the application opens.

```python
from polyspec.hyper.app import App
from polyspec.hyper.session import ArraySession

app = App.open(
    manifest="app/app.json",
    program="build/server",
    handlers=handlers(),
    timezone="+09:00",
)
response = app.handle(request, ArraySession())
```

- `ClientRendering` with `Choice` declares the client-rendered pages of an application (HY-62): the static shell,
  the data base path and the selection of each request.

- The server module serves an application over the Python standard library `http.server` with sessions in files:
  `create_server(app, sessions)` returns a threaded HTTP server that sends every request to the answer of `App.handle`, reads no
  more of a body larger than the body limit (HY-59), sets the cookie of a new session first (HY-45), calls the
  disconnect hook when a write of the response fails with `BrokenPipeError`, `ConnectionResetError` or
  `ConnectionAbortedError` (HY-67) and serves the files of an optional public directory as the PHP built-in server
  serves its document root. `FileSessions` keeps
  each session in a JSON file named by an identifier of 64 hexadecimal digits that it created, writes the file with
  one rename and runs the requests of one session one after another.

```python
from polyspec.hyper.file_sessions import FileSessions
from polyspec.hyper.server import create_server

server = create_server(
    app, FileSessions("/var/lib/board/sessions"), files="public", port=8080
)
server.serve_forever()
```

- `around`, an optional argument of `create_server`, is the request hook of the server (HY-97). The server calls it
  once for every request that it gives to the application, with the request as the server built it and a function
  `answer(request)`, and sends the `Response` that it returns. `answer` runs the application for a request with
  the session of the request and returns the response with the cookie of a new session first. `around` may call
  `answer` with a changed request, change the response that `answer` returns, or return its own response without
  calling `answer`; then the server opens no session and runs no loader, action or hook of the application for that
  request. The disconnect hook receives the request and the reply of the last call of `answer`. A consumer of the
  Node server does the same by replacing the `request` listener of the server that `app.server()` returns. The
  files of the public directory do not reach `around`, and a value that is not callable fails when the server is
  created.
- `written`, an optional argument of `create_server`, `create_wsgi` and `create_asgi`, is the write hook (HY-99). The server calls it once for every request that it gives to the application, with the request, the response whose write started or the plain 500 of an escaped error, whether the write ended, the elapsed milliseconds and the failure of an escaped error. It is called before the disconnect hook.

```python
import secrets

from polyspec.hyper.response import Response


def around(request, answer):
    if request.header("X-Web-Server") != "front":
        return Response.text(400, "Bad Request")
    request_id = secrets.token_hex(8)
    response = answer(request.with_header("X-Request-Id", request_id))
    return response.with_header("X-Request-Id", request_id)


server = create_server(
    app, FileSessions("/var/lib/board/sessions"), around=around, port=8080
)
```


