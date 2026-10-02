# @polyspec/hyper-server

[English](README.md).

영역 프로토콜의 Node.js 서버다. PHP 서버 `polyspec/hyper`와 같은 규칙을 구현한다([영역 프로토콜](../../docs/spec/protocol.ko.md) 참고, 다른 점은 HY-54에 있다). base path를 쓰는 라우트, 공유·영역·라우트 loader, CSRF를 검사하는 `POST` action, redirect와 invalid 결과, `Redirect`, `Forbidden`, `NotFound`, reply cookie와 cache control, JSON tag와 304, flash 값과 바뀐 topic, `/_hyper/keep`을 쓰는 유지 값, 요청 검사, 평문 오류 응답, 데이터 모델 검사, 파일 session을 구현한다. 문서는 `@polyspec/hyper`의 브라우저 코드와 asset build의 템플릿 파일로 렌더하므로, 서버 문서는 같은 JSON을 브라우저가 렌더한 결과다.

Node.js 26 이상에서 동작한다. 이 package는 `@polyspec/hyper`처럼 type 선언을 가진 JavaScript module을 `dist`에 담아 배포하며, `npm run build`(두 package 모두는 `make packages`)가 이를 쓴다. Node는 bundler 없이 `node_modules`에서 이 package를 실행하며, 선언은 `erasableSyntaxOnly`로 type 검사를 통과한다(HY-61). `make node-server`는 board 예제를 esbuild로 파일 하나에 bundle한다.

## 애플리케이션 열기

```ts
import { App, FileSessions, NotFound, Result } from '@polyspec/hyper-server';

interface Services {
  posts: Posts;
}

const app = await App.open<Services>({
  manifest: '/srv/board/app/app.json',
  templates: { index: '/srv/board/build/templates.index.json', root: '/srv/board/public' },
  handlers: {
    shared: () => ({ site: 'Board' }),
    regions: { left: ({ request, services }) => ({ path: request.path(), count: services.get('posts').count() }) },
    routes: {
      'board.show': {
        load: ({ request, services }) => {
          const post = services.get('posts').find(request.param('id') ?? '');
          if (post === null) throw new NotFound();
          return { post };
        },
      },
      'board.create': {
        post: ({ request, services }) => {
          const title = request.formString('title');
          if (title === '') return Result.invalid({ errors: { title: 'Enter a title.' } });
          const id = services.get('posts').create(title);
          return Result.redirect('/board').flash('created', id).changed('posts');
        },
      },
    },
  },
  timezone: '+09:00',
});
app.bind('posts', () => new Posts('/srv/board/var/board.db'));
```

`App.open(options)`는 애플리케이션의 promise를 반환하며, manifest, handler, 템플릿이 맞지 않으면 실패한다.

| 옵션 | 뜻 |
|---|---|
| `manifest` | `app.json`의 절대 경로(HY-1). |
| `templates` | `index`: asset build가 쓰는 템플릿 index의 절대 경로. `root`: index의 파일 URL이 기준으로 삼는 절대 디렉터리(HY-34). |
| `handlers` | `shared`, `regions`(페이지가 아닌 영역), `routes`(`load`, `post`, 라우트 영역의 `regions`). 라우트는 manifest가 `"post": true`를 선언할 때만 `post`를 가진다. |
| `timezone` | 렌더 환경의 time zone(HY-14). |
| `basePath` | `/api` 같은 base path(HY-8). 기본값은 없음이다. |
| `https` | TLS를 끝내는 프록시 뒤처럼 HTTPS를 선언한다. 이때 cookie는 `Secure`다(HY-45). |
| `frameAncestors` | `frame-ancestors`의 source. 기본값은 `'self'`다(HY-45). |
| `bodyLimit` | 가장 큰 요청 body의 바이트 수. 더 큰 body는 413을 받는다. 기본값은 8 MiB다(HY-59). |
| `responseLimit` | 가장 큰 응답 body의 바이트 수. 더 큰 body는 보내지 않고, 요청은 텍스트 500을 받는다. 기본값은 8 MiB다(HY-66). |
| `formTypes` | action과 `/_hyper/keep`이 받는 요청 body의 media type. `application/x-www-form-urlencoded`와 `multipart/form-data`이며, 다른 type은 415를 받는다. 기본값은 `['application/x-www-form-urlencoded']`다(HY-59). |
| `onResponse` | hyper가 스스로 응답하는 것을 포함해 모든 응답마다 요청, 응답, 경과 밀리초, 요청의 reply로 한 번 호출한다. 요청은 `node:http`가 request line을 읽지 못한 경우에만 null이고, 서버가 라우팅 전에 응답했으면 reply는 비어 있다(HY-60). |
| `log` | 처리하지 않은 오류의 log 줄을 받는다(HY-43). 기본값은 표준 오류에 쓴다. |
| `clientRendering` | 클라이언트 렌더 페이지. `shell`은 정적 셸의 절대 경로, `basePath`는 `/_props` 같은 데이터 기본 경로, `selects(request)`는 클라이언트 렌더 페이지의 요청이면 `true`를 반환하거나, 서버가 기다리는 `true` 또는 `false`의 promise를 반환한다. 선택이 고른 페이지의 HTML 요청은 `Cache-Control: no-cache`와 함께 셸을 받고, 그 JSON 요청과 action은 데이터 기본 경로를 쓴다. 다른 요청은 `basePath`로 응답한다(HY-62). |

`app.bind(key, factory)`는 애플리케이션 service를 등록한다. service는 처음 쓸 때 한 번 만든다. factory가 없는 key의 `services.get(key)`는 요청을 500으로 실패시킨다.

## loader와 action

모든 loader와 action은 context 객체 하나를 받는다.

| 필드 | 타입 | 뜻 |
|---|---|---|
| `request` | `Request` | `method`, `path()`, `params()`, `param(name)`, `query()`, `rawQuery()`, `queryInt(name, fallback)`, `form()`, `formString(name)`, `flash(name)`, `cookie(name)`, `header(name)`, `csrfToken()`, `currentPath()`, `wantsJson()`, `isRegionRequest()`, `https` |
| `reply` | `Reply` | `cookie(name, value, maxAge?)`, `removeCookie(name)`, `cacheControl(value)`(HY-52). `note(name, value)`는 응답 hook을 위한 값을 기록하며, hook은 `notes()`로 읽는다(HY-60) |
| `services` | `Services<S>` | `get(key)`는 `app.bind`가 등록한 service를 반환한다 |

loader는 데이터를 반환한다. 문자열 key의 plain object나 `Map`이며, 바로 반환하거나 promise로 반환한다. 값은 null, boolean, ±(2^53 − 1) 안의 number와 bigint, string, 배열, map, plain object다(HY-44, HY-54). plain object는 JavaScript 규칙대로 정수 같은 key를 앞에 두고, `Map`은 넣은 순서를 지킨다.

action은 `Result`를 반환한다.

- `Result.redirect(location)`은 `Location`과 함께 303으로 응답한다. 위치는 애플리케이션 경로다(HY-46). `.flash(name, value)`는 다음 요청에 값을 저장하고 `.changed(...topics)`는 바뀐 topic을 기록한다(HY-25).
- `Result.invalid(data)`는 데이터를 페이지 데이터에 병합해 상태 422로 라우트 페이지를 렌더한다(HY-26).
- `Result.page(status, data)`는 같은 방식으로 상태 200, 409, 422 중 하나로 라우트 페이지를 렌더한다(HY-58).

loader나 action은 `new NotFound()`(404, HY-27), `new Redirect(Result.redirect(location))`(303, HY-50), `new Forbidden()`(403, HY-51), `new BadRequest()`(400, HY-58)를 던져 요청을 멈춘다. 그 밖의 오류는 평문 500으로 응답하고 log에 쓴다(HY-43).

## HTTP로 제공하기

```ts
const sessions = new FileSessions({ directory: '/srv/board/var/sessions', name: 'hyper_session' });
app.server(sessions, { files: '/srv/board/public' }).listen(8080, '127.0.0.1');
```

`app.server(sessions, options)`는 `node:http` 서버를 반환한다. 서버는 요청 body를 애플리케이션의 `bodyLimit`까지만 읽는다(HY-59). `options.files`는 절대 디렉터리이며, PHP 내장 서버가 document root를 제공하듯 그 안의 파일을 지정한 `GET`과 `HEAD` 요청에 그 파일을 준다. ASCII 밖의 바이트가 있는 요청 대상처럼 `node:http`가 해석하지 못하는 요청은 평문 400을 받는다(HY-42).

`FileSessions({ directory, name, lifetime })`는 이 서버 process만 쓰는 기존 절대 디렉터리의 파일에 각 session을 저장한다. `name`은 session cookie 이름이고, `lifetime`은 session의 마지막 요청부터 session이 끝날 때까지의 초다(기본 1440, PHP `session.gc_maxlifetime`과 같다). store는 자기가 만든 식별자만 받아들이고, 요청이 session 데이터를 읽거나 쓸 때만 session을 시작하며, 한 session의 요청을 차례로 실행한다(HY-45). `sessions.collect()`는 끝난 session의 파일을 지운다. 서버는 원하는 주기로 이를 호출한다.

## HTTP 없이 요청에 응답하기

```ts
import { MemorySessionStore, Request } from '@polyspec/hyper-server';

const session = new MemorySessionStore();
const response = await app.handle(Request.from({ method: 'GET', target: '/board', headers: { Accept: 'application/json' } }), session);
// response.status, response.headers, response.body
```

`Request.from({ method, target, headers, body, https })`는 `node:http`가 주는 형태의 HTTP 요청 부분을 받는다. target과 header 값은 문자 하나가 바이트 하나인 텍스트이고, body는 바이트다. `SessionStore`는 session 하나의 interface(`get`, `set`, `remove`)이며, `MemorySessionStore`는 test용으로 session 하나를 메모리에 둔다.

## JSON

`encodeJson(value)`는 `JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES`를 준 PHP `json_encode`의 바이트를 쓰고, `decodeJson(text)`는 PHP `json_decode`처럼 읽으며 데이터 모델 밖의 수는 `OutsideNumber`로 둔다(HY-54). 둘 다 PHP 서버처럼 `conformance/json.json`을 통과한다.
