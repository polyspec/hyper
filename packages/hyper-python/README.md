# polyspec-hyper

[한국어](README.ko.md).

The Python server of the [region protocol](../../../docs/spec/protocol.md): routing, query and form values, the
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
