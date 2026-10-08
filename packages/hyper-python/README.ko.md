# polyspec-hyper

[English](README.md).

[Region protocol](../../docs/spec/protocol.md)의 Python 서버: routing, query와 form 값, mask된 CSRF token,
PHP 서버와 같은 바이트의 JSON text를 같은 규칙의 독립 구현으로 제공한다. `conformance/routes.json`,
`rest.json`, `csrf.json`, `fields.json`, `json.json`의 conformance 사례가 `unittest` test로 돌아간다
(`make test-python`).

```sh
pip install "polyspec-hyper @ git+https://github.com/polyspec/hyper@v0.0.4#subdirectory=packages/hyper-python"
```

```python
from polyspec.hyper import Fields, Router

router = Router([{'name': 'board.show', 'path': '/board/{id}'}])
match = router.match('/board/7')          # {'name': 'board.show', 'params': {'id': '7'}}
fields = Fields.parse(b'page=2&sort=title')  # names ['page', 'sort'], get('page') ['2']
```

- `Router`는 요청 경로를 route 경로와 대조한다: literal, parameter, rest parameter `{name*}`, `%XX` decoding과
  UTF-8 검사 포함 (HY-4 to HY-8, HY-49). `strip_base_path`가 base path를 제거한다 (HY-8).
- `Fields`는 nesting 없이 query 값과 body의 form 값을 보관한다: 이름이 처음 나온 순서의 순서 있는 map에 각
  이름이 요청 순서의 값을 가진다 (HY-56, HY-57).
- `mask`, `masked`, `verify`는 응답용 session token을 mask하고 mask된 form 값을 검증한다 (HY-24).
- `encode`와 `decode`는 PHP `json_encode`와 `json_decode`의 바이트로 JSON을 쓰고 읽는다 (HY-17, HY-54).
  `in_data_model`은 decode된 값이 template data model에 속하는지 알려준다.
- `Request`는 route parameter, flash 값, cookie, selection 값을 가진 HTTP 요청 하나를 보관한다 (HY-15, HY-42,
  HY-56, HY-57, HY-62). `target_path`와 `target_query`가 요청 target을 나눈다.
- `Manifest.from_file`이 application manifest를 읽고 검사한다 (HY-1, HY-2). `Region`은 kept 경로를 가진 manifest
  영역 또는 라우트 영역 하나다 (HY-37).
- `Kept.apply`와 `Kept.select`는 데이터에 맞는 kept 값을 적용한다 (HY-38). `Reads.keep`은 데이터에서 read 경로가
  읽는 부분만 남긴다 (HY-73).
- `Result`는 action의 결과다 (HY-25, HY-26, HY-46, HY-58). `Reply`는 응답의 cookie, cache control, page 상태,
  데이터 내장 선택이다 (HY-52, HY-69, HY-92). `NotFound`, `Forbidden`, `BadRequest`, `Redirect`는 loader와 action의
  stop이다 (HY-27, HY-50, HY-51, HY-58).
- `Session`과 `ArraySession`이 세션 하나의 CSRF token, flash 값, kept 값을 관리한다 (HY-24, HY-25, HY-40, HY-72).
