<!-- doc-id: hyper-server-python-readme -->
<!-- source-sha256: 6008b42976c8feff082661a7f6f23e43951677e7ca251110d6eb6ebe13051c64 -->
# polyspec-hyper-server

[English](README.md).

[Region protocol](../../../docs/spec/protocol.md)의 Python 서버: routing, query와 form 값, mask된 CSRF token,
PHP 서버와 같은 바이트의 JSON text를 같은 규칙의 독립 구현으로 제공한다. `contracts/routes.json`,
`rest.json`, `csrf.json`, `fields.json`, `json.json`의 conformance 사례가 `unittest` test로 돌아간다
(`make hyper-test-python`).

`vX.Y.Z`를 `packages/server/python`을 담은 첫 release tag로 바꾼다. 아직 package를 담은 release tag가 없다.

```sh
pip install "polyspec-hyper-server @ git+https://github.com/polyspec/hyper@vX.Y.Z#subdirectory=packages/server/python"
```

```python
from polyspec.hyper.request import Request
from polyspec.hyper.result import Result

request = Request("GET", "/board/7", {}, "page=2")
request.path(), request.query()  # ('/board/7', [('page', ['2'])])
Result.redirect("/board/7")  # the outcome of an action that succeeded (HY-25)
```

- `Request`는 route parameter, flash 값, cookie, selection 값을 가진 HTTP 요청 하나를 보관한다 (HY-15, HY-42,
  HY-56, HY-57, HY-62). `target_path`와 `target_query`가 요청 target을 나누고,
  `with_header(name, value)`는 대소문자를 구분하지 않고 비교한 그 이름의 header가 값을 가진 사본을 반환한다 (HY-97).
- `Result`는 action의 결과다 (HY-25, HY-26, HY-46, HY-58). `Reply`는 응답의 cookie, cache control, page 상태,
  데이터 내장 선택이다 (HY-52, HY-69, HY-92). `NotFound`, `Forbidden`, `BadRequest`, `Redirect`는 loader와 action의
  stop이다 (HY-27, HY-50, HY-51, HY-58).

- `App.open`이 manifest, `hyper-build-server`가 만든 서버 program(그중 `templates` 디렉터리와 `reads.json`. Python
  서버는 생성된 PHP program이 쓰는 디렉터리 `php`와 `program.json`이 필요 없다), 데이터를 읽고 action을 실행하는
  handler로 application을 만든다. `App.handle`이 요청 하나에 답한다 (HY-8, HY-15 to HY-19, HY-24 to HY-27, HY-40,
  HY-50 to HY-62, HY-65 to HY-67). handler parameter는 타입으로 request나 reply를 받고, `App.bind`가 등록한
  application service는 그 클래스로 받는다. `App.handle`의 응답는 `App.handle`처럼 요청에 답하고 응답과 요청의 reply를
  반환한다.
- `App.open`의 `on_response`는 모든 응답마다 한 번 요청, 응답, 밀리초 단위의 경과 시간, 요청의 reply, 500의 실패로
  호출된다 (HY-60). `on_disconnect`는 client가 연결을 닫아 서버가 응답을 쓰지 못한 요청에 대해 요청, 밀리초 단위의
  경과 시간, 요청의 reply로 한 번 호출된다. 서버는 응답을 끝까지 렌더하고 `on_response`를 먼저 호출하며, 응답의
  모든 쓰기가 성공하면 닫힘을 알지 못한다 (HY-67). callable이 아닌 `on_disconnect` 값은 application을 열 때
  실패한다.

```python
from polyspec.hyper.app import App
from polyspec.hyper.array_session import ArraySession

app = App.open(
    manifest="app/app.json",
    program="build/server",
    handlers=handlers(),
    timezone="+09:00",
)
response = app.handle(request, ArraySession())
```

- `ClientRendering`과 `Choice`가 application의 클라이언트 렌더 페이지를 선언한다 (HY-62): 정적 shell, data base
  path, 요청마다의 selection.

- server module가 표준 라이브러리 `http.server`로 file session과 함께 application을 서비스한다.
  `create_server(app, sessions)`가 모든 요청을 `App.handle`의 응답에 보내는 thread HTTP server를 반환한다. body limit보다
  큰 body를 더 읽지 않고(HY-59), 새 session의 cookie를 가장 먼저 설정하며(HY-45), 응답의 쓰기가 `BrokenPipeError`,
  `ConnectionResetError`, `ConnectionAbortedError`로 실패하면 연결 끊김 hook을 호출하고(HY-67), 선택의 public
  디렉터리 파일을 PHP built-in server가 document root를 서비스하듯이 서비스한다. `FileSessions`는 세션마다
  파일 `sess_<id>`에 PHP files handler의 형식으로 저장하고 그 파일에 `flock`을 잡으므로, 디렉터리를 공유하는 PHP, Node,
  Python 서버와 그 process들은 session을 공유하고 한 session의 요청을 차례로 실행한다(HY-104). `redis_sessions.RedisSessions`는 각 session을
  byte를 돌려주는 애플리케이션 client의 command 함수로 phpredis의 프로토콜에 따라 Redis 서버에 저장한다(HY-115). `setup` 옵션은 session이 있는 요청의 첫 command 전에 실행되어 Sentinel client를 현재 primary에 둔다.

```python
from polyspec.hyper.file_sessions import FileSessions
from polyspec.hyper.server import create_server

server = create_server(
    app, FileSessions("/var/lib/board/sessions"), files="public", port=8080
)
server.serve_forever()
```

- `create_server`의 선택 인자 `around`는 서버의 요청 hook이다 (HY-97). 서버는 애플리케이션에 주는 모든 요청마다
  서버가 만든 요청과 함수 `answer(request)`로 이를 한 번 호출하고, 반환된 `Response`를 보낸다. `answer`는 요청의
  session으로 요청에 대해 애플리케이션을 실행하고, 새 session의 cookie를 가장 먼저 둔 응답을 반환한다. `around`는
  바꾼 요청으로 `answer`를 호출하거나, `answer`가 반환한 응답을 바꾸거나, `answer`를 호출하지 않고 자기 응답을
  반환할 수 있다. 그때 서버는 그 요청에 대해 session을 열지 않고 애플리케이션의 loader, action, hook을 실행하지
  않는다. 연결 끊김 hook은 마지막 `answer` 호출의 요청과 reply를 받는다. Node 서버의 consumer는 `app.server()`가
  반환한 서버의 `request` listener를 바꿔 같은 일을 한다. public 디렉터리의 파일은 `around`에 닿지 않고, callable이
  아닌 값은 서버를 만들 때 실패한다.
- `create_server`, `create_wsgi`, `create_asgi`의 선택 인자 `written`은 쓰기 hook이다 (HY-99). 서버는 애플리케이션에 준 모든 요청마다 한 번 호출하며, 요청, 쓰기를 시작한 응답 또는 탈출 오류의 평범한 500, 쓰기가 끝났는지, 경과 밀리초와 탈출 오류의 failure를 받는다. 연결 끊김 hook 전에 호출된다.

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


