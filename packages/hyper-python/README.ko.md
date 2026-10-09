<!-- doc-id: hyper-python-readme -->
<!-- source-sha256: 8a4b03a0096ba1c084514008d79f2cbf4e2d9af211e5de1d2515a54b5df7caf0 -->
# polyspec-hyper

[English](README.md).

[Region protocol](../../docs/spec/protocol.md)의 Python 서버: routing, query와 form 값, mask된 CSRF token,
PHP 서버와 같은 바이트의 JSON text를 같은 규칙의 독립 구현으로 제공한다. `conformance/routes.json`,
`rest.json`, `csrf.json`, `fields.json`, `json.json`의 conformance 사례가 `unittest` test로 돌아간다
(`make test-python`).

`vX.Y.Z`를 `packages/hyper-python`을 담은 첫 release tag로 바꾼다. 아직 package를 담은 release tag가 없다.

```sh
pip install "polyspec-hyper @ git+https://github.com/polyspec/hyper@vX.Y.Z#subdirectory=packages/hyper-python"
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
- `polyspec.hyper.kept.apply`와 `polyspec.hyper.kept.select`는 데이터에 맞는 kept 값을 적용한다 (HY-38). `Reads.keep`은 데이터에서 read 경로가
  읽는 부분만 남긴다 (HY-73).
- `Result`는 action의 결과다 (HY-25, HY-26, HY-46, HY-58). `Reply`는 응답의 cookie, cache control, page 상태,
  데이터 내장 선택이다 (HY-52, HY-69, HY-92). `NotFound`, `Forbidden`, `BadRequest`, `Redirect`는 loader와 action의
  stop이다 (HY-27, HY-50, HY-51, HY-58).
- `Session`과 `ArraySession`이 세션 하나의 CSRF token, flash 값, kept 값을 관리한다 (HY-24, HY-25, HY-40, HY-72).

- `App.open`이 manifest, `hyper-build-server`가 만든 서버 program(그중 `templates` 디렉터리와 `reads.json`. Python
  서버는 생성된 PHP program이 쓰는 `program.php`와 `program.json`이 필요 없다), 데이터를 읽고 action을 실행하는
  handler로 application을 만든다. `App.handle`이 요청 하나에 답한다 (HY-8, HY-15 to HY-19, HY-24 to HY-27, HY-40,
  HY-50 to HY-62, HY-65 to HY-67). handler parameter는 타입으로 request나 reply를 받고, `App.bind`가 등록한
  application service는 그 클래스로 받는다. `App.respond`는 `App.handle`처럼 요청에 답하고 응답과 요청의 reply를
  반환한다.
- `App.open`의 `on_response`는 모든 응답마다 한 번 요청, 응답, 밀리초 단위의 경과 시간, 요청의 reply, 500의 실패로
  호출된다 (HY-60). `on_disconnect`는 client가 연결을 닫아 서버가 응답을 쓰지 못한 요청에 대해 요청, 밀리초 단위의
  경과 시간, 요청의 reply로 한 번 호출된다. 서버는 응답을 끝까지 렌더하고 `on_response`를 먼저 호출하며, 응답의
  모든 쓰기가 성공하면 닫힘을 알지 못한다 (HY-67). callable이 아닌 `on_disconnect` 값은 application을 열 때
  실패한다.

```python
from polyspec.hyper.app import App
from polyspec.hyper.session import ArraySession

app = App.open(manifest='app/app.json', program='build/server', handlers=handlers(), timezone='+09:00')
response = app.handle(request, ArraySession())
```

- `ClientRendering`과 `Choice`가 application의 클라이언트 렌더 페이지를 선언한다 (HY-62): 정적 shell, data base
  path, 요청마다의 selection.

- server module가 표준 라이브러리 `http.server`로 file session과 함께 application을 서비스한다.
  `create_server(app, sessions)`가 모든 요청을 `App.respond`에 보내는 thread HTTP server를 반환한다. body limit보다
  큰 body를 더 읽지 않고(HY-59), 새 session의 cookie를 가장 먼저 설정하며(HY-45), 응답의 쓰기가 `BrokenPipeError`,
  `ConnectionResetError`, `ConnectionAbortedError`로 실패하면 연결 끊김 hook을 호출하고(HY-67), 선택의 public
  디렉터리 파일을 PHP built-in server가 document root를 서비스하듯이 서비스한다. `FileSessions`는 세션마다 자신이 만든 64자리 16진수
  identifier로 이름 붙은 JSON 파일을 두고, rename 한 번으로 파일을 쓰며, 한 세션의 요청을 순서대로 돌린다.

```python
from polyspec.hyper.file_sessions import FileSessions
from polyspec.hyper.server import create_server

server = create_server(app, FileSessions('/var/lib/board/sessions'), files='public', port=8080)
server.serve_forever()
```


