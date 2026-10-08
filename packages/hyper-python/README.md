# polyspec-hyper

[한국어](README.ko.md).

The Python server of the [region protocol](../../docs/spec/protocol.md): routing, query and form values, the
masked CSRF token and JSON text with the bytes of the PHP server, all as an independent implementation of the same
rules. The conformance cases of `conformance/routes.json`, `rest.json`, `csrf.json`, `fields.json` and `json.json`
run as `unittest` tests (`make test-python`).

```sh
pip install "polyspec-hyper @ git+https://github.com/polyspec/hyper@v0.0.4#subdirectory=packages/hyper-python"
```

```python
from polyspec.hyper import Fields, Router

router = Router([{'name': 'board.show', 'path': '/board/{id}'}])
match = router.match('/board/7')          # {'name': 'board.show', 'params': {'id': '7'}}
fields = Fields.parse(b'page=2&sort=title')  # names ['page', 'sort'], get('page') ['2']
```

- `Router` matches request paths against route paths: literals, parameters and the rest parameter `{name*}`, with
  `%XX` decoding and UTF-8 validation (HY-4 to HY-8, HY-49). `strip_base_path` removes a base path (HY-8).
- `Fields` holds the query values and the form values of a body without nesting: an ordered map from each name, in
  the order of its first occurrence, to its values in request order (HY-56, HY-57).
- `mask`, `masked` and `verify` mask the session token for a response and verify a masked form value (HY-24).
- `encode` and `decode` write and read JSON with the bytes of PHP `json_encode` and `json_decode`
  (HY-17, HY-54); `in_data_model` tells a decoded value that belongs to the template data model.
- `Request` holds one HTTP request with its route parameters, flash values, cookies and selection value (HY-15,
  HY-42, HY-56, HY-57, HY-62); `target_path` and `target_query` split a request target.
- `Manifest.from_file` reads and checks the application manifest (HY-1, HY-2); `Region` is one manifest region or
  route region with its kept paths (HY-37).
- `Kept.apply` and `Kept.select` apply kept values that conform to the data (HY-38); `Reads.keep` keeps the read
  paths of the data (HY-73).
- `Result` is the outcome of an action (HY-25, HY-26, HY-46, HY-58), `Reply` the cookies, the cache control, the
  page status and the data embedding of a response (HY-52, HY-69, HY-92), and `NotFound`, `Forbidden`, `BadRequest`
  and `Redirect` the stops of loaders and actions (HY-27, HY-50, HY-51, HY-58).
- `Session` with `ArraySession` owns the CSRF token, the flash values and the kept values of one session (HY-24,
  HY-25, HY-40, HY-72).

- `App.open` creates an application from its manifest, the server program that `hyper-build-server` of
  `@polyspec/hyper-build` built (the `templates` directory and `reads.json` of it; the Python server needs neither
  `program.php` nor `program.json`, which the generated PHP program uses) and the handlers that load data and run
  actions; `App.handle` answers one request (HY-8, HY-15 to HY-19, HY-24 to HY-27, HY-40, HY-50 to HY-62,
  HY-65 to HY-67). A handler parameter receives the request or the reply by its type, and an application service
  of the class that `App.bind` registered.

```python
from polyspec.hyper.app import App
from polyspec.hyper.session import ArraySession

app = App.open(manifest='app/app.json', program='build/server', handlers=handlers(), timezone='+09:00')
response = app.handle(request, ArraySession())
```

- `ClientRendering` with `Choice` declares the client-rendered pages of an application (HY-62): the static shell,
  the data base path and the selection of each request.

