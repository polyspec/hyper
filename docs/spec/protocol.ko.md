<!-- doc-id: protocol -->
<!-- source-sha256: f8e58ad3f68c248bc9ec08bf6cf488e493f28ff461e464246571c45f88060ebe -->
# 영역 프로토콜

[English](protocol.md).

이 문서는 다음을 정의한다.
- 애플리케이션 매니페스트
- 라우팅과 렌더
- hyper 서버와 hyper 브라우저 코드 사이의 요청과 응답
- 두 렌더 방식

첫 문서는 두 방식 중 하나로 렌더한다. 서버가 HTML로 렌더하거나(서버 렌더, SSR), 정적 셸이 브라우저에서 렌더한다(클라이언트 렌더, CSR). 템플릿 문법과 렌더 규칙은 template 언어가 정의하며, 이 문서는 그 규칙을 바꾸지 않는다.

## 애플리케이션 매니페스트

- **HY-1** 애플리케이션은 구조를 JSON 파일 하나(매니페스트)에 선언한다. 서버와 브라우저는 같은 매니페스트를 읽는다.

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

- **HY-2** `regions`와 `routes`는 순서가 있는 목록이다.
  - 영역 이름과 라우트 이름은 문자열이며 각각 고유하다.
  - 영역 이름은 `[A-Za-z][A-Za-z0-9_-]*`에 맞고, `layout`, `title`, `data`가 아니다.
  - `"page": true`인 영역은 정확히 하나이며 `template`이 없다. 다른 모든 영역은 `template`과 사용 주제 목록을 가진다.
  - `"post": true`인 라우트는 `POST` 액션을 받는다. 서버는 시작할 때 매니페스트를 이 규칙으로 검사하고, 에셋 빌드는 클라이언트 번들을 쓰기 전에 매니페스트를 검사한다. 브라우저는 번들에 든 매니페스트를 다시 검사하지 않는다.
- **HY-3** 레이아웃은 `<title>` 안에서 제목 정의를 `{# title}`로, 데이터 정의를 `{# data}`로(HY-31) 렌더한다. 각 영역은 `{# name}`으로 렌더하는데, 이 태그는 `id`가 영역 이름인 요소 안에 둔다. 예: `<main id="content">{# content}</main>`. 영역 배치에는 블록 인자가 없다. 브라우저는 영역 요소를 `id`로 찾으며, 다른 표시는 없다.

## 라우팅

- **HY-4** 라우트 경로는 `/`로 시작한다. 그 뒤의 세그먼트는 `/`로 구분한다. 세그먼트는 둘 중 하나다.
  - 문자 `A-Z a-z 0-9 . _ ~ -`로 된 리터럴
  - 매개변수 `{name}`. `name`은 `[A-Za-z_][A-Za-z0-9_]*`에 맞는다.

  경로 `/`는 세그먼트가 없다.
- **HY-5** 요청 경로가 라우트와 일치하려면 다음 조건을 모두 만족해야 한다. 쿼리 문자열은 경로에 포함하지 않는다.
  - `/`로 시작한다.
  - 세그먼트 수가 같다.
  - 모든 리터럴 세그먼트가 요청 세그먼트와 바이트 단위로 같다.
  - 모든 매개변수 세그먼트가 비어 있지 않다.
- **HY-6** 매개변수 값은 요청 세그먼트의 모든 `%XX` 시퀀스(16진수 두 자리)를 해당 바이트로 디코딩한 값이다. 다음 세그먼트는 일치하지 않는다.
  - 두 자리 16진수가 뒤따르지 않는 `%`를 가진 세그먼트
  - 디코딩한 바이트가 유효한 UTF-8이 아닌 세그먼트
- **HY-7** 라우트는 매니페스트 순서대로 시도하며, 처음 일치한 라우트가 결과다. 어떤 라우트와도 일치하지 않는 경로는 결과가 없다.
- **HY-8** 애플리케이션은 `/api` 같은 기본 경로 아래에서 실행될 수 있다.
  - 요청 경로는 기본 경로를 제거한 뒤 라우팅한다.
  - 기본 경로 뒤에 `/`나 경로의 끝이 오지 않는 요청 경로는 결과가 없다.
  - `Location` 헤더는 기본 경로를 포함한다.
- **HY-9** `conformance/routes.json`은 라우트, 요청 경로, 기대 결과를 담는다. PHP 라우터와 JavaScript 라우터는 모든 사례를 통과한다.
- **HY-49** 라우트 경로의 마지막 segment는 나머지 매개변수 `{name*}`일 수 있다. `name`은 HY-4와 같고 경로의 다른 매개변수와 달라야 한다. 이 segment는 0개 이상의 남은 요청 segment에 놓이며, 그 segment가 모두 비어 있거나 HY-6으로 decode될 때 맞는다. 값은 decode하지 않은 요청 경로의 나머지로, `/` 뒤에 남은 segment를 `/`로 이은 것이며 남은 segment가 없으면 `/`다. `conformance/rest.json`은 라우트, 요청 경로, 기대 결과를 담는다. PHP 라우터와 JavaScript 라우터는 모든 사례를 통과한다.

## 데이터와 주제

- **HY-10** 공유 데이터는 레이아웃, 제목, 모든 영역이 받는 맵 하나다. 라우트 제목 `title`과 이 응답을 위해 가린 HY-24의 세션 토큰 `csrf`로 시작하고, 그 뒤에 애플리케이션이 추가하는 값이 온다.
- **HY-11** 페이지 영역이 아닌 모든 영역은 사용하는 주제를 선언한다. 주제는 바뀔 수 있는 데이터의 이름이다(예: `posts`). `path` 주제는 내장 주제다. 요청 경로가 `HX-Current-URL` 요청 헤더의 경로(기본 경로 제거 후)와 다르면 바뀐 것으로 본다.

## 렌더

- **HY-12** 문서는 레이아웃을 렌더한 결과다.
  - 루트 데이터는 공유 데이터다.
  - 정의는 모두 `html` 정의다. `title`(단독으로 렌더한 제목), `data`(HY-31), 그리고 매니페스트 영역마다 그 영역을 단독으로 렌더한 결과를 넘긴다.
  - 페이지 영역 템플릿은 라우트 템플릿이다.
- **HY-13** 단독으로 렌더하는 부분은 다음 루트 데이터를 쓴다.
  - 영역: 영역 템플릿을 루트 데이터 `merge(shared, region data)`로 렌더한다. 같은 이름이면 영역 데이터 값이 공유 값을 대체한다. 페이지 영역은 자기 라우트의 모든 라우트 영역을 단독으로 렌더한 결과를 `html` 정의로 받는다.
  - 제목: 제목 템플릿을 공유 데이터로 렌더한다.

  서버와 브라우저는 문서와 영역 부분을 이 같은 방법으로 조립하므로 같은 바이트를 출력한다. 문서나 영역 응답은 자기 루트를 각각 template engine의 bound map(VAL-22)으로 한 번 bind한다. 루트는 공유 데이터, 각 영역의 데이터, 데이터를 내장하는 문서에서는 내장 데이터(HY-31)다. 응답의 모든 렌더는 그 bound map과 `merge`를 쓰므로, bind 횟수는 렌더 횟수에 따라 늘지 않는다. 데이터를 내장하는 문서에서 공유 값은 공유 데이터에서 한 번, 내장 데이터에서 한 번 더 bind된다. 내장 데이터가 공유 데이터를 담기 때문이다.
- **HY-14** 서버와 브라우저는 같은 환경으로 렌더한다. 서버는 모든 JSON 응답에 시간대를 담아 보낸다.
- **HY-48** PHP 서버는 빌드가 애플리케이션 템플릿에서 컴파일한 프로그램으로 렌더한다. PHP가 네이티브 템플릿 확장 `polyspec_template`을 불러왔으면 그 확장으로, 그렇지 않으면 같은 템플릿의 generated PHP 프로그램으로 렌더한다. 프로그램은 HY-12와 HY-13이 정한 대로 문서와 영역을 렌더한다. 두 프로그램은 같은 테스트와 `make parity`를 통과한다. 빌드는 generated 프로그램을 애플리케이션이 고른 PHP namespace로 컴파일하므로, 전역 이름을 선언하지 않고 여러 애플리케이션의 프로그램이 한 PHP 프로세스에서 불러와진다. `App::open`은 프로그램 디렉터리에 `program.php`, `program.json`, `reads.json`(HY-73), 디렉터리 `templates` 중 하나가 없으면, 처음 없는 것의 절대 경로와 함께 실패한다. 그래서 빠진 build는 애플리케이션을 열 때 실패하고 빠진 파일을 밝힌다. 빌드는 먼저 `make templates-check`와 같은 HC-6, HY-3, HY-30, HY-75 규칙으로 템플릿을 검사하고, 위반이 있으면 출력을 지우거나 쓰기 전에 모든 문제와 함께 실패한다. 그래서 server program은 이 규칙을 어기는 템플릿을 제공하지 않는다.
  - 프로그램은 HY-12와 HY-13대로 문서와 영역을 렌더한다.
  - 두 프로그램은 같은 테스트와 `make parity`를 통과한다.
  - 빌드는 generated 프로그램을 애플리케이션이 고른 PHP 네임스페이스로 컴파일한다. 그래서 전역 이름을 선언하지 않으며, 여러 애플리케이션의 프로그램을 한 PHP 프로세스에서 불러올 수 있다.

## 요청

- **HY-15** 요청은 헤더에 따라 세 가지로 나뉜다.
  - 영역 요청: `Accept: application/json`과, htmx가 모든 요청에 보내는 `HX-Request: true`를 가진다.
  - 문서 요청: `Accept: application/json`을 가지고 `HX-Request`가 없다.
  - HTML 요청: 그 밖의 모든 요청이다. HTML 문서를 받는다.

  영역 요청은 언제나 페이지 영역을 갱신한다(HY-18).

- **HY-56** 요청의 원본 쿼리는 요청 대상에서 첫 `?` 뒤부터 첫 `#` 앞까지이며, `?`가 없으면 빈 텍스트다. 그 값은 중첩 없이 읽는다. 원본 쿼리를 모든 `&`에서 나누고 빈 부분은 건너뛴다. 부분의 이름은 첫 `=` 앞의 텍스트이고 값은 그 나머지이며, `=`가 없으면 값은 빈 텍스트다. 둘 다 `+`는 공백이고, 16진수 두 자리가 붙은 `%XX`는 그 바이트이며, 그 밖의 `%`는 그대로 둔다. `roles[]`나 `a[b]`처럼 괄호가 있는 이름은 쓴 그대로의 이름이고, 빈 이름도 이름이다. 쿼리 값은 각 이름을 처음 나온 순서대로 그 값들의 요청 순서 목록에 대응시키는 순서 있는 map이다. 유효한 UTF-8이 아닌 이름이나 값은 HY-42로 실패한다. `Request`는 원본 쿼리와 쿼리 값을 제공하고, `queryInt`는 이름의 마지막 값을 읽는다. `conformance/fields.json`은 텍스트와 그 값을 담으며, 두 서버는 모든 사례를 통과한다.
- **HY-57** 요청의 폼 값은 원본 body에서 중첩 없이 읽으며, HY-56의 쿼리 값처럼 순서 있는 map이다. `application/x-www-form-urlencoded` body는 원본 쿼리처럼 읽는다. `multipart/form-data` body는 `Content-Disposition`이 `form-data`이고 `name` 매개변수가 있으며 `filename` 매개변수가 없는 part마다 값 하나를 준다. 이름은 그 매개변수이고 값은 part의 내용 그대로다. `filename`이 있는 part는 파일이며 폼 값이 아니다. 다른 type의 body에는 폼 값이 없다. 유효한 UTF-8이 아닌 이름이나 값은 HY-42로 실패한다. PHP 서버는 대괄호 이름을 중첩하는 `$_POST`가 아니라 `php://input`에서 body를 읽는다. PHP는 `enable_post_data_reading`이 꺼져 있을 때만 `multipart/form-data` 요청의 body를 준다. `Request`는 폼 값을 제공하고, `formString`은 이름의 마지막 값을 읽는다. `conformance/fields.json`은 urlencoded 사례와 multipart 사례를 담으며, 두 서버는 모든 사례를 통과한다.

## JSON 응답

- **HY-17** JSON 응답은 다음 형태다. 키는 순서를 유지한다.

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

`regions`는 로더 데이터를 담는다. `kept`는 서버가 `regions`의 영역에 대해 읽었고 영역 데이터에 맞는(HY-38) `server`와 `cookie` 유지 값을 영역과 경로별로 담는다. 그런 값이 없는 영역은 항목이 없다.

- **HY-18** `regions`에 담는 영역은 요청 종류에 따라 다르다.
  - 문서 요청: 없는 라우트 영역(HY-75)을 뺀 모든 영역을 매니페스트 순서로 담는다.
  - 영역 요청: 페이지 영역을 먼저 담고, 그 뒤에 바뀐 주제를 사용하는 다른 영역을 매니페스트 순서로 담는다.
- **HY-19** 요청의 바뀐 주제는 두 가지다. 직전 액션이 기록한 주제(HY-25)와 `path`(HY-11)다.

## 브라우저

- **HY-20** 브라우저 코드는 응답 URL 경로(기본 경로 제거 후)를 매니페스트 라우트로 라우팅한다. 이 라우트 이름은 응답의 `route`와 같아야 하며, 다르면 렌더가 실패한다. 페이지 영역 템플릿은 그 라우트의 템플릿이다.
- **HY-21** htmx 확장은 요청 대상 요소의 `id`가 페이지 영역 이름일 때만 JSON(`Accept: application/json`)을 요청한다.
  - JSON 영역 응답은 다음 순서로 이어 붙인 HTML로 바꾸고, 응답 텍스트 대신 htmx에 넘긴다.
    1. 단독으로 렌더한 제목을 담은 `<title>`
    2. 단독으로 렌더한 페이지 영역
    3. 다른 영역마다 그 영역을 단독으로 렌더한 결과를 담은 `<hx-partial hx-target="#<name>" hx-swap="innerMorph">`
  - htmx가 스왑하기 전에 브라우저는 응답의 layout의 stylesheet link를 적용한다(HY-64).
  - 이후 스왑, 제목 변경, 히스토리 갱신은 htmx가 수행한다.
  - 콘텐츠 유형이 `application/json`이 아닌 응답은 그대로 통과한다.
- **HY-22** 클라이언트 렌더에서는 정적 셸이 `<meta name="hyper-api" content="/api">`로 서버의 기본 경로를 선언한다. 브라우저 코드는 다음을 순서대로 수행한다.
  1. 현재 경로의 문서 JSON을 요청하면서 라우트의 템플릿을 불러온다(HY-35).
  2. 리다이렉트를 따른 뒤의 응답 URL을 라우팅하고(HY-20) 문서를 렌더한다(HY-12).
  3. 렌더한 문서의 head의 stylesheet link를 적용한다(HY-64).
  4. `html` 요소의 속성(HY-63), 제목, body를 렌더한 것으로 바꾼다.
  5. htmx가 새 body를 처리하게 한다.

  어떤 라우트와도 일치하지 않는 현재 경로는 body 텍스트로 `Not Found`를 렌더한다.
- **HY-23** 클라이언트 렌더에서 확장은 다음을 수행한다.
  - 모든 영역 요청의 같은 출처 요청 경로 앞에 기본 경로를 붙인다.
  - 히스토리 경로에서 기본 경로를 제거한다.
  - htmx의 히스토리 복원을, 복원할 경로에 대한 HY-22 동작으로 대체한다. 나중 복원은 아직 불러오는 중인 이전 복원을 취소하며, 가장 마지막 복원만 렌더한다.
- **HY-64** head의 stylesheet link는 `href` 속성이 있고 `rel` 속성에 ASCII 대소문자를 구분하지 않고 `stylesheet` 토큰이 있는 `link` 요소다. link의 키는 페이지 URL을 기준으로 해석한 `href` 속성 값이다. 브라우저는 새 내용을 보일 때 원본 문서의 head의 stylesheet link를 페이지의 head에 적용한다. 원본 문서는 다음과 같다.
  - 클라이언트 렌더의 문서(HY-22, HY-23): 렌더한 문서
  - JSON 영역 응답(HY-21): 응답의 공유 데이터를 루트 데이터로, 단독으로 렌더한 제목을 정의 `title`로, 빈 정의 `data`와 매니페스트 영역마다 빈 정의를 주어 렌더한 layout
  - 서버 렌더에서 htmx가 히스토리에서 페이지를 복원하려고 요청한 HTML 문서(HY-32): 그 문서

  브라우저는 세 단계로 link를 적용한다.
  1. 원본의 stylesheet link를 순서대로 살핀다. 다시 나오는 키는 첫 link에서만 센다. link마다 마지막으로 유지한 link 뒤에 있는 같은 키의 첫 페이지 stylesheet link를 유지하고, 없으면 원본 link의 복사본을 마지막으로 유지하거나 넣은 link 뒤에 넣는다. 처음 유지한 link가 없을 때는 페이지의 첫 stylesheet link 앞에, 페이지에 stylesheet link가 없으면 head의 끝에 넣는다.
  2. 넣은 모든 link와, 앞선 적용이 넣어 아직 불러오는 중인 유지한 link가 모두 불러와질 때까지 기다린다. 그 뒤에야 내용을 보인다.
  3. 내용을 보인 뒤 페이지의 다른 stylesheet link를 모두 제거하므로, 페이지의 stylesheet link는 원본의 link와 그 순서가 된다.

  `style` 요소 같은 head의 다른 요소는 그대로 둔다. 앞선 적용이 내용을 보이기 전에 나중 적용이 시작되면 나중 적용만 link를 제거한다. link 불러오기가 실패하면 브라우저는 이 적용에서 넣은 link를 제거하고, 내용을 보이지 않으며, 실패를 HY-47대로 알린다. 서버 렌더의 첫 문서는 이미 stylesheet link를 가지므로 적용하지 않는다.

## 서버의 클라이언트 렌더

- **HY-62** 애플리케이션은 클라이언트 렌더를 선언할 수 있으며, 그러면 한 서버가 한 매니페스트의 클라이언트 렌더 페이지와 서버 렌더 페이지를 같은 handler로 응답한다. 선언은 정적 셸, 데이터 기본 경로, 선택으로 이루어진다.
  - 셸은 `<meta name="hyper-api" content="<데이터 기본 경로>">`(HY-22)를 담은 HTML 파일의 절대 경로다. 서버는 애플리케이션을 열 때 이 파일을 읽는다.
  - 데이터 기본 경로는 HY-8을 따르며 비어 있지 않다. 어떤 라우트 경로도 데이터 기본 경로와 같거나, 데이터 기본 경로 뒤에 `/`가 오는 것으로 시작하지 않는다.
  - 선택은 모든 요청을 받아 choice를 반환한다. choice는 요청이 클라이언트 렌더 페이지의 것인지(예를 들어 `Host` header로 고른다)와 host에 저장된 service 같은 값을 담는다. PHP에서 choice는 `new Choice(chosen: <bool>, value: <value>)`이고, Node에서는 `chosen`이 `true` 또는 `false`이고 `value`가 `undefined`가 아닌 객체 `{ chosen, value }`다. 서버는 요청마다 HY-59의 1단계와 HY-42 뒤, 라우팅 전에 선택을 한 번 호출한다. Node 서버에서는 선택이 choice의 promise를 반환할 수도 있으며, 서버는 그 promise를 기다린다. 저장된 데이터를 읽는 선택은 Node에서 그 데이터를 비동기로 읽기 때문이다. 예외를 던지거나, 다른 값을 반환하거나, reject되거나 다른 값으로 resolve되는 promise를 반환하는 선택은 HY-43으로 실패한다.
  - 요청의 모든 loader와 action은 선택이 요청을 골랐는지와 관계없이 choice의 값을 자기 요청에서 읽는다. PHP에서는 `$request->selection()`, Node에서는 `request.selection()`이다. 그래서 애플리케이션은 선택과 handler가 함께 필요로 하는 저장된 데이터를 요청마다 한 번 읽고, cache 없이 값으로 전달한다. 선언이 없는 애플리케이션의 요청은 값 null을 가진다.

  셸 파일을 읽을 수 없거나, 셸이 데이터 기본 경로를 선언하지 않거나, 데이터 기본 경로가 비어 있거나 HY-8을 따르지 않거나, 라우트 경로가 데이터 기본 경로 아래에 있으면 애플리케이션 열기가 실패한다. 선택이 고르지 않은 요청은 선언이 없을 때처럼 애플리케이션의 기본 경로(HY-8)로 응답한다. 선택이 고른 요청은 애플리케이션의 기본 경로 대신 데이터 기본 경로로 다음과 같이 응답한다.
  1. `<데이터 기본 경로>/_hyper/keep`은 HY-40을 따른다.
  2. 데이터 기본 경로 뒤에 `/`나 경로의 끝이 오는 것으로 시작하는 요청 경로는 데이터 기본 경로를 제거한 뒤 라우팅하며, `Location` header는 데이터 기본 경로를 포함한다(HY-8). HY-27 뒤에 JSON 요청(HY-15)이 아닌 요청은 텍스트 `Not Acceptable`과 함께 상태 406을 받는다. 다른 모든 요청은 HY-15부터 HY-59까지로 응답한다. 문서 요청과 영역 요청은 JSON을 받고, 액션은 실행된다.
  3. 그 밖의 요청 경로는 그대로 라우팅한다. 라우트가 없는 경로는 404를, `GET`이 아닌 method는 405를 받는다(HY-27). 그다음 JSON 요청은 텍스트 `Not Acceptable`과 함께 상태 406을 받고, HTML 요청은 셸의 바이트를 body로, `Content-Type: text/html; charset=utf-8`, `Cache-Control: no-cache`, `Vary: Accept` header와 함께 상태 200을 받는다.

  선택이 고른 요청의 405와 406 응답과 셸 응답은 loader나 액션을 실행하지 않고, 세션을 읽지 않으며(HY-45), 요청 데이터를 담지 않는다. 선택이 고른 요청의 모든 응답은 HY-45의 frame 정책을 가지며 HY-60의 응답 hook에 보고된다. `conformance/client.json`은 요청, 각 요청의 선택, 기대 응답을 담으며, 두 서버는 모든 사례를 통과한다.
- **HY-63** 클라이언트 렌더가 렌더한 문서를 붙일 때(HY-22, HY-23), 브라우저는 `html` 요소의 속성을 렌더한 문서의 `html` 요소의 속성으로 그 순서대로 바꾼다. 렌더한 요소에 없는 속성은 제거한다. 따라서 `<html lang="{= language}">`를 렌더하는 layout은 서버 렌더 문서처럼 클라이언트 렌더 페이지에도 그 데이터의 언어를 준다. `scripts/build-assets.mjs`가 쓰는 정적 셸은 데이터를 담지 않으므로 `lang` 속성이 없다.

## 액션

- **HY-24** 세션 토큰은 세션이 처음 필요로 할 때 서버가 만드는 무작위 32바이트다. 응답의 값 `csrf`(HY-10)는 토큰을 가린 값이다. 서버가 응답마다 한 번 뽑는 무작위 32바이트 `r` 뒤에 `r`과 토큰의 XOR를 붙이고, 128자리 소문자 16진수로 쓴다. 응답마다 새 `r`을 뽑으므로 어떤 응답도 토큰의 바이트를 담지 않고, 요청 입력을 함께 담은 응답을 압축해도 그 크기로 토큰을 알아낼 수 없다. 액션 요청과 유지 값 저장(HY-40)은 세션 토큰을 가린 값을 폼 필드 `_csrf`로 담아야 한다. 이 값은 128자리 소문자 16진수이고, 뒤쪽 절반과 앞쪽 절반의 XOR가 토큰과 같아야 하며, 비교는 일정한 시간에 한다. 그렇지 않으면 서버는 상태 403으로 응답하고 액션을 실행하지 않는다. 서버는 토큰 자체를 보내지 않는다. `conformance/csrf.json`은 토큰, 가림 값, 폼 값과 기대 결과를 담고, 두 서버는 모든 사례를 통과한다.
- **HY-72** 세션의 주인인 방문자가 바뀔 때, 예를 들어 로그인과 로그아웃에서 액션은 reply의 `renewSession()`으로 세션을 갱신한다. 액션이 끝나면 서버는 세션 값을 새 세션 식별자로 옮기고, 예전 세션을 지우고, 새 세션 토큰을 만들고, 새 세션 cookie를 설정한다. redirect의 flash 값과 유지 값은 남는다. 액션이 렌더하는 페이지는 새 토큰을 가린 값을 담는다. 로더나 공유 데이터 핸들러가 `renewSession()`을 부르면 HY-43으로 실패한다. 그 페이지는 예전 토큰을 담기 때문이다.
- **HY-25** 성공한 액션은 리다이렉트를 반환한다.
  - 서버는 상태 303과 `Location`으로 응답한다.
  - 서버는 flash 값과 바뀐 주제를 세션에 저장하고, 다음 요청이 읽은 뒤 제거한다.
  - 브라우저는 같은 헤더로 리다이렉트를 따라간다.
  - htmx는 최종 URL을 히스토리에 기록한다.
- **HY-26** 입력을 거부한 액션은 오류 데이터를 반환한다. 서버는 상태 422로 응답하고, 라우트 데이터에 오류 데이터를 병합해 라우트 페이지를 렌더한다. JSON 요청에는 JSON으로, 그 밖의 요청에는 문서로 응답한다.

## 데이터

- **HY-29** 영역의 출력은 템플릿, 공유 데이터, 영역 데이터의 함수다. 브라우저는 영역 데이터를 교체하고 렌더하는 방법으로만 페이지를 바꾼다. 폼 컨트롤은 사용자가 입력 중인 값을 가진다. 그 밖의 모든 화면 상태(예: 정렬 순서, 펼친 패널)는 영역 데이터다.
- **HY-30** 라우트는 라우트 영역을 선언할 수 있다. 예: `"regions": [{ "name": "rows", "template": "board/rows.tpl" }]`.
  - 페이지 중 애플리케이션에 요청하지 않고 브라우저에서 바뀌는 부분이 라우트 영역이다. 그 변경이 렌더하는 템플릿 가운데 아직 불러오지 않은 파일은 불러올 수 있다(HY-35).
  - 라우트 템플릿, 또는 라우트 템플릿이 포함하거나 경로로 배치하는 템플릿이 각 라우트 영역을 블록 인자 없이 `{# name}`으로 배치한다. 이 태그는 `id`가 영역 이름인 요소 안에 둔다. 그 템플릿들 가운데 어디에도 라우트 영역을 배치하지 않으면 `make templates-check`가 실패한다.
  - 라우트 영역의 로더는 `null`을 돌려줄 수 있고, 그러면 그 응답에서 영역은 없다(HY-75).
  - 영역 이름은 매니페스트 영역과 모든 라우트 영역을 통틀어 고유하다.
  - 라우트 영역마다 자기 로더를 가진다.
  - 페이지 영역은 모든 라우트 영역을 HTML로 받는다(HY-13).
  - 페이지 영역을 담는 모든 JSON 응답은 페이지 영역 바로 뒤에 라우트 영역을 담는다.
- **HY-75** 라우트 영역은 로더가 데이터를 돌려주면 응답에 있고, `null`을 돌려주면 없다. 없는 라우트 영역은 JSON 응답의 `regions`, 내장 데이터(HY-31), `kept`에 항목이 없고, 페이지 영역은 그 영역의 정의를 받지 않으므로 `{?# name}`은 거짓이다. 없을 수 있는 라우트 영역을 배치하는 템플릿은 그 요소를 `{?# name}…{/}` 안에 둔다. 응답은 없는 영역의 유지 값을 담지 않는다. 브라우저는 있는 라우트 영역만 보관하므로(HY-32), 없는 영역에 대한 `data`, `render`, `set`, `hy-set`은 실패한다(HY-33). 브라우저는 페이지 영역을 렌더하거나 교체한 뒤, 보관한 라우트의 있는 라우트 영역마다 그 `id`를 가진 요소가 페이지에 정확히 하나 있고 없는 라우트 영역에는 요소가 없는지 확인한다. 그렇지 않으면 body에 `hy-error="0"`을 둔다(HY-47). 이 규칙으로, 관리자가 조합하는 페이지처럼 한 라우트 아래에서 요청 시점에 화면을 배치하는 페이지도 일부 페이지에만 배치되는 화면을 라우트 영역으로 선언할 수 있다.
- **HY-31** 레이아웃은 `</body>` 앞에 `{# data}`를 한 번 배치한다.
  - 내장 데이터는 문서 JSON 값(HY-17) 가운데 브라우저가 바꿀 수 있는 부분이다. `env`, `route`, `params`, `shared`는 JSON 응답과 같고(HY-73), `regions`는 그 라우트의 라우트 영역(HY-30)만 그 순서대로 담고, `kept`는 그 영역들의 항목만 담는다.
  - 요청의 reply가 내장을 요청하고(HY-92) 그 라우트의 라우트 영역 가운데 있는 영역(HY-75)이 하나라도 있으면 문서는 데이터를 내장한다. 이때 정의 `data`는 예약 템플릿 `hyper/data.tpl`을 렌더한다. 그 소스는 정확히 `<script type="application/json" id="hy-data">{= json(response) | raw}</script>`이고, `response`는 내장 데이터다.
  - 그렇지 않으면 정의 `data`는 비어 있고 문서에는 `#hy-data`가 없으므로, 문서의 소스에는 페이지의 HTML만 있다.
  - 클라이언트 렌더(HY-22)의 문서는 데이터를 내장하지 않는다. 브라우저는 자기가 렌더한 JSON 응답의 데이터를 보관하기 때문이다.
  - PHP 서버와 Node 서버가 내장 데이터를 같은 방법으로 계산하고 렌더하므로 문서는 양쪽에서 같은 바이트를 유지한다.
  - 영역 요청은 이 템플릿을 렌더하지 않는다. JSON 응답은 브라우저가 렌더하므로 모든 영역을 그대로 담는다(HY-18).
- **HY-92** 요청의 loader, action, 공유 데이터 핸들러는 reply(HY-52)의 `embedData()`로 그 응답의 HTML 문서가 데이터를 내장하게 한다(HY-31). PHP에서는 `$reply->embedData()`, Node에서는 `reply.embedData()`다. 호출하지 않으면 문서는 데이터를 내장하지 않는다. 이 호출은 JSON 응답(HY-17), 리다이렉트, 멈춤을 바꾸지 않으며, 클라이언트 렌더 요청(HY-62)은 내장 데이터가 없는 셸이나 JSON을 받는다. 애플리케이션은 요청마다 정한다. 예를 들어 선택이 읽는 host의 저장된 service로 정한다(HY-62).
- **HY-71** 서버가 보내는 데이터는 그 요청의 방문자에게 공개된다. 공유 데이터, 영역 데이터, 유지 값은 내장 데이터(HY-31), 모든 JSON 응답(HY-17), 브라우저 렌더(HY-22)로 브라우저에 가므로, 템플릿에 넘긴 값은 서버에만 남지 않는다. 로더와 공유 데이터 핸들러는 그 요청의 방문자가 봐도 되는 값만 돌려준다. 비밀번호 해시, 세션 토큰, 방문자가 보면 안 되는 개인정보처럼 페이지가 보여 주지 않는 값은 넣지 않는다. 서버는 템플릿이 읽지 않는 값도 모두 뺀다(HY-73). 하지만 빠진다고 해서 그 값을 돌려줘도 되는 것은 아니다. 페이지가 보여 주는 값은 어차피 HTML로 브라우저에 간다. 가린 CSRF 토큰은 브라우저가 모든 폼과 함께 다시 보내야 하므로 공유 데이터다(HY-10, HY-24). 세션 토큰 자체는 보내지 않는다.
- **HY-73** 서버는 라우트의 템플릿이 읽는 데이터만 보낸다. 읽기 경로는 요청 전에 템플릿 AST로 계산하고, 렌더가 읽는 모든 값을 적어도 포함한다. 그래서 남긴 데이터를 렌더하면 로더 데이터를 렌더한 것과 같은 바이트가 나온다.
  - 경로는 루트 데이터에서 시작하는 단계의 목록이다. 단계는 맵 키, 10진수로 쓴 목록 인덱스, 또는 맵의 모든 항목이나 목록의 모든 원소를 뜻하는 `*`다. 통째로 읽는 경로는 그 값을 그대로 남기고, 일부만 읽는 경로는 그 아래에서 읽는 경로만 남긴다.
  - 식은 경로의 집합을 가진다. 변수는 그 이름의 루트 경로와, 같은 이름의 지역 변수가 가진 경로를 가진다. 지역 변수는 자기 범위에 있는 모든 대입 `{:x = e}`의 경로를 합친 것을 가진다. `{@ v = e}`의 반복 변수는 그 반복의 본문 안에만 있다. 본문 안에서 `v`는 `e`의 모든 경로 뒤에 `*`를 붙인 것과 `v`에 대한 대입의 경로를 가지고, 루트 경로나 같은 이름의 바깥 반복 변수의 경로는 가지지 않는다. 본문 밖에서 반복 변수는 `v`에 경로를 더하지 않는다. 그래서 `{:p = page.x}{@ page = p.items}`처럼 반복 변수의 이름을 읽는 반복 앞의 대입은 반복 전에 가진 경로를 유지한다. `v.value_`는 `v`의 경로를 가지고, 다른 반복 메타 필드는 경로가 없다. 멤버와, 키가 문자열이나 숫자 리터럴인 인덱스는 모든 경로에 그 키를 붙인다. 다른 인덱스는 그 객체와 키를 통째로 읽고 경로가 없다. `a ?? b`는 `a`와 `b`의 경로를, 삼항 연산은 두 결과의 경로를 가지며, 다른 식은 경로가 없다.
  - 식의 값이 출력될 때, `{? }`, `{:? }`, 삼항 연산의 조건일 때, `??`가 아닌 연산자의 피연산자일 때, 함수, 멤버 호출, 클래스 호출의 인자일 때, 멤버 호출의 객체일 때, 목록이나 맵 리터럴의 항목, 키, 값, 펼침일 때, 인덱스의 키일 때 그 식은 자기 경로를 통째로 읽는다. 반복 `{@ v = e}`는 `e`의 모든 경로 뒤에 `*`를 붙인 경로를 일부만 읽으므로, 반복은 모든 항목을 남긴다.
  - 포함 `{+ path}`는 포함하는 템플릿의 범위에서 읽는다. 경로가 있는 블록은 새 범위에서 그 템플릿을 읽는다. 이 범위에서 루트 이름은 자기 루트 경로를 가지고, 각 범위 인자는 호출하는 범위에서 계산한 자기 식의 경로를 가진다. 위에서 이미 배치하고 있는 템플릿을 다시 배치하는 블록은 아무것도 읽지 않는다. 렌더가 거기서 실패하기 때문이다(템플릿 언어의 RT-22). 정의를 배치하는 블록은 아무것도 읽지 않는다.
  - 라우트의 공유 데이터 읽기 경로는 레이아웃, 제목, 모든 매니페스트 영역 템플릿, 라우트 템플릿, 모든 라우트 영역 템플릿의 읽기 경로이고, 라우트 영역이 서버에 값을 남기면(HY-39) `csrf`를 통째로 더한다. 영역 데이터의 읽기 경로는 그 영역 템플릿의 읽기 경로이며, 페이지 영역은 라우트 템플릿의 것이고, 라우트 영역은 유지 경로를 통째로 더한다. `hyper/data.tpl`은 아무것도 읽지 않는다.
  - 서버는 페이지를 렌더하거나 인코딩하기 전에 공유 데이터와 모든 영역 데이터에서 읽기 경로만 남긴다. 맵은 경로가 이름 붙인 키를 남기고 그 값도 같은 방식으로 남기며, `*` 아래에서는 모든 키를 남긴다. 목록은 길이를 유지한다. 각 원소는 `*`와 그 인덱스의 경로로 남기고, 어떤 경로도 이름 붙이지 않은 인덱스에는 `null`을 둔다. 다른 값은 그대로 둔다. 비게 된 맵은 맵으로 남는다.
  - 빌드는 모든 라우트의 읽기 경로를 서버 프로그램의 `reads.json`(HY-48)에 쓰고, Node 서버는 애플리케이션을 열 때 브라우저 패키지로 계산한다. `conformance/reads.json`은 템플릿, 데이터, 읽기 경로, 남긴 데이터를 담는다. 브라우저 패키지는 모든 사례의 읽기 경로를 계산하고, 두 서버는 기대한 데이터를 남기며, 남긴 데이터는 원래 데이터와 같은 바이트로 렌더된다. `data(region)`(HY-33)은 남긴 데이터를 돌려주므로, 어떤 템플릿도 읽지 않는 경로는 거기에 없다.

## 브라우저 데이터

- **HY-32** 브라우저는 마지막으로 렌더한 응답의 데이터를 보관한다. 환경, 라우트, 매개변수, 공유 데이터, 그 라우트의 라우트 영역(HY-30)의 데이터다. 서버 렌더 페이지가 브라우저 코드의 `open()`으로 열릴 때와, htmx가 페이지 HTML을 요청해 히스토리에서 복원할 때 브라우저는 `#hy-data` 요소에서 내장 데이터(HY-31)를 읽어 보관 데이터 전체를 교체하고, 라우트의 템플릿 불러오기를 시작한다(HY-35). `#hy-data`가 없는 문서는 보관 데이터를 남기지 않으며, 브라우저는 데이터가 처음 필요할 때 HY-93으로 데이터를 얻는다. 페이지가 열릴 때는 라우트의 라우트 영역의 유지 경로에 `localStorage`나 `sessionStorage` 값이 저장되어 있을 때만 데이터가 필요하다(HY-37, HY-38). 그래서 보기만 하고 그런 값이 없는 페이지는 문서 외에 요청을 보내지 않는다. 영역 응답(HY-21)은 공유 데이터, 페이지 영역, 있는 모든 라우트 영역(HY-17, HY-18, HY-30)을 담으므로 보관 데이터 전체를 자기 데이터로 교체한다. 이것이 브라우저가 보관하는 전부이므로, 서버는 브라우저가 보관한 데이터를 알리는 신호가 필요 없다. `render`(HY-33)는 보관한 영역 데이터를 교체한다.
- **HY-93** 브라우저는 보관하지 않은 데이터를 현재 페이지의 URL, 즉 경로와 query에 대한 `Accept: application/json` 문서 요청(HY-15) 하나로 얻는다. 데이터를 보관하지 않은 동안 `data`, `render`, `set`, `hy-set`(HY-33, HY-36)이 현재 페이지 라우트의 라우트 영역을 가리킬 때와, 저장된 브라우저 유지 값이 있는 페이지가 열릴 때(HY-32) 데이터를 얻는다. 다른 영역을 가리키는 호출은 요청을 보내지 않는다. `data`는 아무것도 반환하지 않고, 다른 호출은 실패한다. 요청이 진행 중일 때 데이터가 필요한 호출은 같은 요청을 기다린다. 응답은 상태 200의 JSON 응답이어야 하고, 그 URL은 현재 페이지의 라우트로 라우팅되어야 한다(HY-20). 그러면 브라우저는 브라우저 유지 값을 적용하고(HY-38), 데이터를 보관하고, 그것으로 그 라우트의 있는 라우트 영역을 내장 문서의 영역처럼 HY-38대로 모두 렌더한다. 그래서 서버가 HTML을 렌더한 뒤에 데이터가 바뀌었더라도 페이지는 브라우저가 보관한 데이터를 보여 준다. 이어서 호출은 보관 데이터로 계속한다. 요청이 진행 중일 때 응답(HY-21, HY-32)이 보관 데이터를 교체했으면 브라우저는 그 요청의 응답을 버리고, 호출은 보관 데이터로 계속한다. 다른 응답, network 실패, decode할 수 없는 응답은 보관 데이터를 남기지 않고, 호출의 영역을, 페이지가 열릴 때는 body를 응답의 상태나 `0`으로 표시하며(HY-47), 호출을 실패시킨다. 데이터가 필요한 다음 호출은 요청을 다시 보낸다. 이 요청은 HTML 요청처럼 페이지의 로더를 다시 실행하므로, `GET` 요청의 로더는 저장된 상태를 바꾸지 않는다(RFC 9110, 9.2.1절). 제자리에서 렌더한 action의 페이지(HY-26, HY-58, HY-69)는 그 URL의 `GET` 요청의 데이터를 받는다.
- **HY-33** 브라우저 코드는 세 함수를 제공한다.
  - `data(region)`: 영역의 보관 데이터의 promise를 반환한다.
  - `render(region, data)`: 영역의 보관 데이터를 교체한다.
  - `set(region, path, value)`: 영역의 보관 데이터에서 점으로 구분한 경로(맵 키와 목록 인덱스)의 값 하나를 교체한다. 데이터에 없는 경로는 실패한다.

  영역은 보관한 라우트의 라우트 영역(HY-30)이어야 한다. 다른 영역은 실패한다.

  `render`와 `set`은 이어서 영역을 단독으로 렌더해(HY-13) 영역 요소에 `innerMorph`로 스왑한다. 페이지 영역은 보관한 라우트의 템플릿과 보관한 라우트 영역을 쓴다(HY-13). 이 함수들은 데이터를 보관하지 않은 동안의 HY-93 문서 요청 외에는 요청을 보내지 않는다. 변경 추적은 없다. 데이터를 바꾸는 코드가 렌더를 요청한다. 호출은 호출 순서대로 하나씩 실행되며, 각 호출은 앞 호출이 남긴 보관 데이터에서 시작한다. 호출은 자기 영역의 보관 데이터를 확인한다. 스왑 전에 응답(HY-32)이 그 데이터를 교체했으면 스왑, 보관, 저장 없이 끝난다. 스왑 중에 교체했으면 보관과 저장을 하지 않고 보관 데이터로 영역을 다시 렌더한다. 그 영역을 바꾸지 않은 응답은 호출에 영향을 주지 않는다.
- **HY-36** 템플릿은 요소에 `hy-set="path=value; path=value"` 속성을 줄 수 있다. 각 값은 JSON 리터럴이고, 각 경로는 HY-33을 따른다.
  - 요소나 그 안의 요소를 클릭하면, `id`가 보관한 라우트의, 데이터를 보관하지 않은 동안에는 현재 페이지 라우트의(HY-93) 라우트 영역 이름인 가장 가까운 상위 요소의 보관 데이터에서 모든 대입을 실행하고 그 영역을 한 번 렌더한다.
  - 대입할 값은 템플릿이 계산한다. 예: `hy-set="service.close.flag={? service.close.flag}0{:}1{/}"`.
  - `hy-set`은 JavaScript가 있을 때만 동작한다.

## 템플릿 전달

- **HY-34** 에셋 빌드는 다음을 쓴다. 클라이언트 번들은 색인과 `hyper/data.tpl`의 이름을 담고, 템플릿은 담지 않는다.
  - 템플릿마다 AST 파일 하나. 파일 이름에는 내용의 해시가 들어간다.
  - 색인. 각 템플릿 이름을 파일 URL에 대응시킨다. 색인은 `hyper/data.tpl`도 담는다.
  - `public/assets` 아래에는 이름에 내용의 해시가 들어간 파일을 더하기만 하고 지우지 않는다. 그래서 이전 build의 서버나 열려 있는 페이지가 그 build의 모든 파일을 계속 불러온다. 쓰이는 어떤 build도 적지 않은 파일은 애플리케이션이 지운다.
  - 해시가 없는 출력, 즉 색인, manifest(HY-76), 정적 셸 `csr/`는 필수 옵션 `--output`이 가리키는 디렉터리에 쓴다.
  - 클라이언트는 색인을 module `@polyspec/hyper-client/templates-index`로 import하고, build가 이 module을 같은 build의 색인으로 resolve한다. package는 그 type만 선언한다.
- **HY-68** asset build와 server build는 출력으로 복사하는 모든 파일을 mode 0644로, 모든 디렉터리를 mode 0755로 만들고 원본 파일의 바이트를 쓴다. 소유자가 읽을 수 없는 mode로 파일을 만들지 않는다. Linux container(Apple `container`)의 virtiofs bind mount는 그런 생성을 `EACCES`로 거부하고, Node의 `fs.cpSync`는 대상 파일을 mode 0200으로 만들기 때문이다. mode는 process의 umask에 의존하지 않는다. 복사가 만드는 각 파일과 디렉터리는 만든 뒤에 그 mode로 설정하므로, 다른 사용자의 process가 모든 출력을 읽는다. `tests/scripts/output-files.test.mjs`는 모든 platform에서 umask 077에서의 mode를, 그리고 GitHub runner처럼 sudo가 password 없이 `nobody`로 process를 시작하는 곳에서는 다른 사용자의 읽기를 검사한다. Darwin에서만 full suite의 target인(`DARWIN_TARGETS`) `make virtiofs-check`(`tests/virtiofs/output-files.test.mjs`)는 출력이 virtiofs bind mount에 있는 Apple `container`에서 두 복사를 실행하고, `container`가 없으면 실패한다.
- **HY-70** asset build, template build, server build는 `@polyspec/hyper-build`가 요구하는 template package에서 package 이름으로 template 언어를 읽는다(HY-96). parser, render runtime, manifest 검사 bundle은 `@polyspec/template`을 쓰고, server build는 compiler module `@polyspec/template-compiler/compiler.mjs`, `ast-artifact.mjs`, `type-manifest.mjs`를 쓴다. asset build는 애플리케이션이 설치한 template package와 상관없이 client bundle의 `@polyspec/template`도 같은 package로 resolve한다. npm은 두 package를 template release의 tarball에서 설치한다. private root `package.json`이 그 URL(`https://github.com/polyspec/template/releases/download/v<version>/<package>-<version>.tgz`)을 밝히고, workspace package를 위해 각각을 같은 URL로 override하며, `.npmrc`에 `allow-remote=root`를 둔다. `package-lock.json`은 각 tarball을 `resolved` URL과 `integrity`로 고정하고, `npm ci`가 설치한다. Composer는 `polyspec/template`을 template release의 zip에서 설치한다. private root `composer.json`과 `examples/board/composer.json`의 `package` repository가 그 URL과 sha1 `shasum`을 밝히고, `composer.lock`이 같은 `dist`를 고정한다. 공개 manifest `packages/hyper-client/package.json`, `packages/hyper-server-node/package.json`, `packages/hyper-build/package.json`, `packages/hyper-php/composer.json`은 정확한 template version을 요구한다. 어떤 build도 template 디렉터리를 받지 않으며, 옵션 `--template-dir`는 알 수 없는 옵션으로 실패한다. `tests/scripts/template-dir.test.mjs`와 `tests/scripts/template-copy.test.mjs`가 이를 검사한다.
- **HY-96** build 명령은 bin `hyper-build-server`(HY-48, HY-73)와 `hyper-build-assets`(HY-34, HY-76, HY-77)를 가진 npm package `@polyspec/hyper-build`이며, 다른 package와 함께 `polyspec-hyper-build-npm-X.Y.Z.tgz`로 릴리스된다(HY-95). `files`는 `bin`과 `lib`이고 `exports`는 `./package.json`뿐이며, module은 자신이 배포하는 파일, Node의 내장 module, manifest가 정확한 버전으로 요구하는 package만 import한다. manifest 검사, read path, 예약 템플릿 `hyper/data.tpl`(`@polyspec/hyper-client/data-template.json`)을 위한 `@polyspec/hyper-client`, template package(HY-70), esbuild, Tailwind CSS가 그것이다. source는 `packages/hyper-build`에 한 번만 있다. Makefile은 bin을 그 파일로 실행하고(HY-79) 이 저장소의 script는 module을 거기서 import하며, pack할 때 복사하거나 고쳐 쓰지 않는다. bin은 애플리케이션의 입력과 출력만 받고, 어떤 옵션도 이 저장소의 경로를 밝히지 않는다. `tests/scripts/package-source.test.mjs`가 import를 검사하고, `make release-consumer`는 릴리스 tarball을 consumer처럼 설치하고 설치한 패키지의 두 bin을 첫 인자 검사까지 실행한다.
- **HY-98** 이 저장소의 모든 package 이름은 역할을 밝힌다. browser package는 `hyper-client`, server는 `hyper-server`, build 명령은 `hyper-build`이다. `packages/` 아래 directory는 역할이고, server는 그 뒤에 언어를 붙인다. npm package `@polyspec/hyper-client`는 `packages/hyper-client`에, npm package `@polyspec/hyper-build`는 `packages/hyper-build`에 있다. `config/release.json`은 각 package를 그 directory에서 release하므로, release archive 이름(HY-95)은 `polyspec-hyper-client-npm-X.Y.Z.tgz`처럼 그 package의 역할과 registry를 밝힌다. `tests/scripts/package-names.test.mjs`가 각 package의 manifest와 release 항목을 검사한다.
- **HY-78** 이 저장소는 네이티브 template 확장을 tag `TEMPLATE_TAG`(`v0.0.5`)의 php-ext release asset에서 build하며, 이 asset은 `config/template-ext.json`이 sha256으로 밝힌다(H14.1-7). `make install`은 asset을 `$(ONLINE)`으로 내려받아 sha256을 확인하고 `var/products/template-ext`에 푼다(`scripts/template-ext.mjs fetch`). `make ext`는 풀린 소스를 `PATH`의 PHP의 php-config로 phpize, configure, make해 `build/ext/polyspec_template.so`를 offline으로 build한다(`scripts/template-ext.mjs build`). PHPStan은 풀린 asset의 stub을 읽는다. 어떤 recipe도 확장을 위해 template 저장소를 읽거나 복사하지 않으며, 그 안에서 build하지도 않는다. `tests/scripts/template-ext.test.mjs`가 이를 검사한다.
- **HY-80** full-run key `template`는 checkout `TEMPLATE_REPOSITORY`의 tag `TEMPLATE_TAG`(`v0.0.5`, Makefile)의 commit이다. 이 tag는 npm과 Composer가 설치하는 template package의 release이자 확장의 php-ext asset이다. 이 저장소의 어떤 추적 파일도 template 저장소의 commit을 밝히지 않는다. checkout에 tag가 없으면 `make template-tag`가 기대한 tag와 checkout의 tag를 밝히며 실패한다. full run의 guard(`scripts/kit/full-run.mjs`)는 `TEMPLATE_REPOSITORY`와 `TEMPLATE_TAG`에서 commit을 key `template`(`make check`와 `make rerun-failed`가 넘기는 Makefile의 `FULL_RUN_KEYS`)으로 읽고, run을 tree와 그 key로 구분하며, 둘을 무시되는 `var/full-run.json`에만 기록한다. GitHub에서는 template 저장소를 tag `TEMPLATE_TAG`로 checkout하고(HY-91), `tests/scripts/ci-workflow.test.mjs`가 그 `ref`가 `TEMPLATE_TAG`와 같기를 요구한다. `tests/scripts/template-pins.test.mjs`와 `tests/kit/full-run.test.mjs`가 이를 검사한다.
- **HY-81** release가 이 저장소의 결과를 바꾸는 모든 도구는 추적 파일에 pin한다. Node.js는 `.node-version`에, npm은 `package.json`의 `packageManager`(`npm@<version>+sha512.<release tarball의 digest>`)에, PHP는 minor release(`8.5`)로 `.php-version`에, Python은 minor release(`3.14`)로 `.python-version`에, `composer.phar`의 SHA-256을 포함한 Composer는 `config/toolchain.json`에 pin한다. `make install-tools`(`scripts/kit/install-tools.mjs`)는 npm과 Composer를 machine이 아니라 checkout의 무시되는 디렉터리 `var/tools`에 설치한다. machine 전체의 도구는 모든 checkout과 session이 공유하므로 하나를 위한 설치가 다른 것들의 도구를 바꾸기 때문이다. download는 그 digest가 pin과 같을 때만 사용한다. `var/tools/bin`은 명령 `npm`, `npx`, `composer`를 담고, Makefile은 모든 recipe와 그것이 시작하는 program에 그 디렉터리를 `PATH`의 맨 앞에 둔다. recipe와 script는 npm과 Composer를 그 절대 경로(`$(NPM)`, `$(COMPOSER)`)로 시작한다. make 3.81은 shell 문법이 없는 recipe 줄의 program을 export한 `PATH`가 아니라 자기 process의 `PATH`에서 찾기 때문이다. pin한 minor의 PHP와 Python patch release는 통과한다. make는 pin하지 않는다. 모든 target의 전개가 GNU Make 3.81과 4에서 같은 명령을 내고, recipe는 make 3.81이 필요로 하는 절대 경로로 npm과 Composer를 시작하기 때문이다. npm, Composer, PHP를 실행하는 모든 recipe가 먼저 실행하는 `make toolchain-check`(`scripts/kit/check-toolchain.mjs`)는 Node.js, npm, PHP, Python, Composer가 pin과 다르면 실패하고 각각의 기대값과 실제값을 밝힌다. `make ext`는 검사가 실행하는 PHP인 `PATH`의 PHP의 phpize와 php-config로 네이티브 확장을 build한다. CI job은 같은 파일(`node-version-file`, `python-version-file`, `php-version-file`)에서 Node.js, Python, PHP를 설정하고, CI 실행의 기록은 각 도구의 실행 중인 release를 밝힌다. 도구는 `tests/kit/`에서 검사하고, `tests/scripts/toolchain.test.mjs`와 `tests/scripts/template-copy.test.mjs`가 recipe를 검사한다.
- **HY-82** 다른 process가 다시 쓰이는 동안 읽을 수 있는 출력은 없는 파일이나 일부만 쓰인 파일 없이 publish한다. 파일 하나는 쓰는 process의 파일에 옆에 쓴 뒤 rename 한 번으로 제자리로 옮긴다(`packages/hyper-build/lib/output-files.mjs`의 `writeFileAtomic`). 에셋 build의 템플릿 파일, 색인, manifest, script, `--tailwind`의 스타일시트, 템플릿 build의 색인이 그렇다. 디렉터리는 쓰는 process의 staging 디렉터리(`<target>.next-<pid>`)에 쓰고 `packages/hyper-build/lib/publish.mjs`의 `publish`로 publish한다. 각 파일은 rename 한 번으로 대상에 옮기고, reader가 먼저 여는 파일은 마지막에 옮기며, 그다음 새 출력에 없는 파일을 지운다. 선언한 template 복사본(`copy.json`을 마지막에), 사본 `var/products/hyper-php`, 서버 프로그램(`program.php`를 마지막에), 정적 배포물 `csr/`(`index.html`을 마지막에), 각 npm package의 `dist`, `node_modules`와 `vendor`에 설치한 이 저장소의 package 사본을 이렇게 publish한다. reader는 각 파일의 이전 version이나 새 version을 찾고 없는 파일은 찾지 않는다. 한 번의 publish 동안 여러 파일을 읽는 reader는 두 version의 파일을 섞을 수 있다. 설치한 사본은 package manager가 같은 의존성 tree를 설치할 때만 publish한다. package의 의존성이나 binary(npm), 또는 requirement와 autoload 규칙(Composer)이 설치한 사본과 다르면 publish는 실패하고 두 값과 설치 명령을 밝힌다. 한 출력의 두 writer는 모두 성공한다. `make install`의 package manager 설치는 lock `var/install.lock`을, full run은 `var/full-run.lock`을 잡는다(`scripts/kit/holder-lock.mjs`). 두 번째 holder는 첫 번째를 밝히며 실패하고, 끝난 process의 lock은 `node scripts/kit/holder-lock.mjs clear <lock>`이 지울 때까지 남는다. `tests/scripts/publish.test.mjs`, `tests/scripts/toolchain.test.mjs`, `tests/kit/holder-lock.test.mjs`가 이를 검사한다.
- **HY-83** tool의 출력을 읽는 검사는 run의 맥락이나 pin하지 않은 release에 따라 바뀌지 않는 형태를 읽는다. make dry run은 `tests/scripts/make-dry-run.mjs`의 `dryRun`으로 호출한 make의 변수(`MAKEFLAGS`, `MFLAGS`, `MAKELEVEL`, `MAKEOVERRIDES`) 없이 `--no-print-directory`로 make를 시작하므로, 다른 make 안에서나 `-w`로 실행하는 make의 `make: Entering directory` 줄이 assertion에 닿지 않는다. tool에 machine이 읽는 형태가 있으면 그것을 읽는다. 예를 들어 `git status --porcelain`, `--version`이다. 어떤 script도 npm 11과 npm 12 사이에 모양이 바뀐 `npm pack`의 JSON을 parse하지 않는다(HY-80). PHP 내장 서버의 시작 줄이나 Playwright의 목록처럼 그런 형태가 없는 text에 대한 assertion은 HY-81이 pin한 도구를 읽는다. `tests/scripts/full-run.test.mjs`는 `MAKEFLAGS=w`, `MAKELEVEL=2`로 dry run을 실행한다.
- **HY-84** 검사는 무언가를 검사했을 때만 통과하고, 실패는 결과를 보고하는 곳에서 원인을 밝힌다. `scripts/kit/run-tests.mjs`의 test run은 어떤 file, test, name pattern도 test를 고르지 않을 때처럼 통과하거나 실패하거나 시간이 초과된 test가 없으면 실패하고 `no test ran`을 출력한다. node와 vitest의 progress reporter는 `KIT_TEST_RESULT`의 파일로 runner에 count를 넘기고, PHPUnit도 빈 suite에 실패한다(`failOnEmptyTestSuite`). 어떤 node test 파일도 top level에서 await하지 않는다. `node --test --test-force-exit`는 등록한 test가 끝나면 파일을 끝내므로 그런 await 뒤에 등록한 test를 실행하지 않기 때문이다. `scripts/check-parity.mjs`는 status나 compare step이 없는 request 파일에서, `--node`에서는 Node 서버가 비교한 요청에 하나도 답하지 않았을 때 실패한다. full run은 실패한 각 target의 표준 출력과 표준 오류의 마지막 20줄을 기록(`lastLines`)에 남기고, 결과 전에 실패한 target과 함께 출력한다. log의 모든 줄은 0열에서 시작한다. recipe의 검사는 `scripts/line-end.mjs`로 실행하고, full run과 CI 보고서는 완성된 줄만 전달하며, 둘 다 tool이 마지막 줄바꿈 없이 남긴 stream을 줄바꿈으로 끝내므로 어떤 줄 단위 reader도 두 줄이 붙은 것을 찾지 않는다. `tests/kit/run-tests.test.mjs`, `tests/kit/full-run.test.mjs`, `tests/scripts/check-parity.test.mjs`가 이를 검사한다.
- **HY-85** test는 자기가 읽는 것을 만들거나, 읽기 전에 그것을 다른 target의 출력으로 밝힌다. test는 이전 실행의 출력이 남아 있을 수 있는 fixture 디렉터리 대신 fixture의 추적 파일을 임시 디렉터리에 복사한다(`scripts/tracked-files.mjs`의 `copyTracked`). `node_modules`, `make packages`의 npm 사본, `make install`의 `vendor`처럼 다른 target의 설치나 build를 읽는 test는 `tests/scripts/requires.mjs`의 `requireBuilt`를 호출하고, 이것은 없는 경로와 그것을 쓰는 make target을 밝히며 실패한다. 에셋 build와 템플릿 build test는 npm이 설치한 template package를 읽는다(HY-70). build 출력은 그것을 쓰는 checkout의 절대 경로를 담지 않고, 네이티브 확장은 run의 임시 디렉터리에서 build해 자기 checkout의 `build/ext`에 publish한다. `tests/scripts/build-assets.test.mjs`, `tests/scripts/template-dir.test.mjs`, `tests/scripts/run-tests.test.mjs`가 이를 검사한다.
- **HY-86** 여러 검사의 run은 모든 검사를 끝까지 실행한 뒤 하나라도 실패했으면 실패하고, 실패한 검사를 각각 밝힌다. 여러 검사를 가진 Makefile recipe(`test-js`, `test-node`, `test-php`, `lint`, `parity`, `bench-server`)는 `$(call check,<name>,<command>)`로 검사를 실행한다. 이것은 명령을 출력하고 subshell에서 실행하며 실패하면 이름을 기록한다. recipe는 `$(checks_result)`로 끝나고, 이것은 실패한 모든 이름과 함께 `failed checks:`를 출력하고 실패한다. full run은 `CHECK_TARGETS`의 각 target을 각자의 `make -k <target>`으로 끝까지 실행한다(H11.1-1). CI job의 첫 step 뒤의 step은 `if: ${{ !cancelled() }}`로 실행하고, 검사하는 여러 goal의 make는 `-k`로 실행한다. 설치나 build처럼 서로 의존하는 step의 recipe는 나중 step이 앞 step의 출력을 읽으므로 첫 실패에서 멈춘다. `tests/scripts/check-recipes.test.mjs`가 이를 검사한다.
- **HY-87** run의 어떤 process나 파일도 run보다 오래 남지 않는다. `scripts/board-servers.mjs`의 `serverRun`은 run에 임시 디렉터리와 서버 child를 준다. 모든 서버는 spawn될 때, 주소를 보고하기 전에 child에 들어가고, `close`는 run이 끝날 때, 실패할 때, SIGINT와 SIGTERM에서 모든 child를 멈추고 각각 끝날 때까지 기다린 뒤 디렉터리를 지우며, 그다음 process는 130이나 143으로 끝난다. board의 서버가 시작에 실패하면 시작한 서버들은 시작이 reject되기 전에 끝난다. `scripts/check-parity.mjs`, `scripts/run-e2e.mjs`, `scripts/bench-browser.mjs`가 이것을 쓰고, `scripts/serve-demo.mjs`는 서버를 시작하기 전에 signal을 처리한다. test는 디렉터리를 쓰는 process가 끝난 뒤에만 그 디렉터리를 지운다. `tests/scripts/serve-demo.test.mjs`의 demo는 그 디렉터리를 지우는 hook 안에서 먼저 멈추고, `tests/scripts/check-parity.test.mjs`는 검사를 자기 process group에서 실행하고 그 group을 kill하며, `RunTest`는 서버와 log를 `finally`에서 놓는다. `tests/scripts/board-servers.test.mjs`, `tests/scripts/check-parity.test.mjs`, `tests/scripts/serve-demo.test.mjs`가 이를 검사한다.
- **HY-88** 추적하는 모든 경로는 owner를 가지고, 변경은 그것이 건드린 경로의 owner를 실행한다. `config/owner-checks.json`은 경로 glob마다 그것을 소유하는 make target과 node test 파일을 선언한다. `make owner-validate`(`scripts/kit/owner-check.mjs`)는 추적 경로나 새 경로가 어떤 규칙에도 맞지 않을 때, glob이 어떤 경로에도 맞지 않을 때, target이 Makefile이나 `scripts/kit/kit.mk`의 target이 아니거나 full suite를 실행할 때, test 파일이 없을 때 실패하고, `make owner-check`는 바뀐 경로의 owner를 실행한다. 바뀐 경로는 commit하지 않은 변경, `PATHS`, 또는 `BASE` 이후의 변경이다. node test 파일은 입력을 먼저 쓰는 `make test-scripts TESTS=<files>`로 실행한다(HY-85). 어떤 규칙도 소유하지 않는 지운 경로는 아무것도 고르지 않는다. `.gitignore`는 추적 파일을 무시하지 않고, 설치, build, test run, guard의 모든 출력을 무시한다. `tests/kit/owner-check.test.mjs`와 `tests/scripts/ignored-files.test.mjs`가 이를 검사한다.
- **HY-89** 어떤 결과도 live service, step의 시간, run이 가지지 않은 자원에 의존하지 않는다. 어떤 검사도 결과가 시간에 따라 달라지는 registry 질의를 하지 않는다. latest 조회나 `@latest`, version range 해석, outdated package나 새 릴리스에 대한 metadata 질의가 그것이다. lock이 정확한 버전과 integrity로 pin한 package의 download는 설치이며 `npm ci`와 `composer install`처럼 허용된다. npm은 `--no-audit`을 붙인 `ci`와 `run`만, Composer는 `install`만 lock에서 실행하고, `tests/package-install`는 추적하는 `package-lock.json`에서 offline으로 설치한다(`npm ci --offline`). `make release-consumer`는 `tests/release-install`의 consumer 프로젝트를 추적하는 lock에서 `npm ci`와 `composer install`로 빈 cache에 설치하므로 lock이 pin한 third-party package만 download한다(HY-95). 나머지 download는 HY-81의 pin한 도구이며 digest로 확인한다. 모든 recipe와 그것이 시작하는 program은 npm, Composer를 offline으로 실행한다. Makefile은 `npm_config_offline=true`, `COMPOSER_DISABLE_NETWORK=1`을 export하고, `make install-tools`, `make install`, `make install-browser`(pin한 Playwright의 Chromium)의 download만 `$(ONLINE)`으로 이를 해제한다. `make ext`는 아무것도 download하지 않으며, php-ext asset은 `make install`만 내려받는다(H14.1-7). test는 서버가 본 connection의 close 같은 event로 event의 순서를 정하고, timer의 경쟁으로 정하지 않는다. test의 서버는 system이 정하고 보고하는 port에서 listen하므로, 어떤 process도 port를 고른 때와 쓰는 때 사이에 그것을 가져갈 수 없다. `RunTest`의 PHP 내장 서버는 port 0에서 시작하고 test는 그 시작 줄에서 주소를 읽는다. 서버의 시작은 시간 제한 없이 기다리며, 5초마다 기다리는 줄과 서버가 출력한 마지막 줄을 밝히는 진행 줄을 출력한다. 목록에 대한 검사는 template 파일이 없는 `scripts/check-bundle-size.mjs`처럼 목록이 비면 기대값과 실제값인 개수를 밝히며 실패한다. `tests/scripts/toolchain.test.mjs`, `tests/scripts/board-servers.test.mjs`, `tests/scripts/check-bundle-size.test.mjs`, `packages/hyper-server-node/tests/http.test.ts`가 이를 검사한다.
- **HY-90** 이 저장소의 모든 GitHub workflow는 job을 선언한 runner `ubuntu-26.04-arm`에서 실행하고, 모든 action을 commit으로 pin하며 release를 주석으로 적고, `timeout-minutes`를 두지 않는다. step은 runner가 줄 단위로 log를 남기고 종료 코드로 판단하는 긴 작업이기 때문이다. 명령을 실행하는 모든 step은 job `check`의 `make ci-targets TARGETS="..."`처럼 make target 하나를 실행하고 script나 tool을 직접 실행하지 않으므로, Makefile이 export한 설정과 검사가 그 step에 적용된다(HY-81, HY-89). job의 첫 step 뒤의 모든 step은 `if: ${{ !cancelled() }}`로 실행한다(HY-86). `tests/scripts/ci-workflow.test.mjs`가 이를 검사한다.
- **HY-91** 전체 suite는 `main`의 push와 모든 수동 실행에 대해 GitHub의 workflow `.github/workflows/ci.yml`에서 실행하며, 그 `on:` block은 정확히 `main`으로의 `push`와 `workflow_dispatch`이다. 릴리스 `.github/workflows/release.yml`은 tag `v*` 또는 `**/v*`의 push에서만 실행되고(HY-95), 다른 workflow는 없다. 그 job `check`는 CI group마다 matrix 항목 하나를 `fail-fast: false`로 실행하고, 각 항목은 `targets`를 밝혀 `make ci-targets`로 실행한다. 항목들의 target은 합쳐서 Makefile의 `CHECK_TARGETS`의 target이며 각각 한 번이고, 항목 `python-3.11`과 `python`은 같은 target을 두 Python release에서 실행하고, `python-render`는 Python render test와 Python 서버 비교를 실행한다. group은 같은 준비가 필요한 target을 모은다. `docs`는 Node.js만, `php`와 `node`는 PHP, template checkout, `make install`도, `board`와 `python-render`는 Chromium(`make install-browser`)도 필요하며, 다른 group은 그것을 설치하지 않고 `python`과 `python-3.11`은 그 항목의 Python이 필요하다. `php`와 `board` group의 `make ext`는 setup-php의 PHP의 phpize와 php-config로 native extension을 build한다. toolchain은 pin한 파일에서 온다. Node.js는 `.node-version`에서, Python은 `.python-version`이나 항목의 release에서, PHP는 `.php-version`에서 오며(HY-81), template 저장소는 Makefile의 tag `TEMPLATE_TAG`로 `../template`에 checkout하고(HY-80), `make install`은 거기서 네이티브 확장 소스를 복사하며(HY-78) 아무것도 build하지 않는다. `make ci-targets TARGETS="<targets>" CI_REPORT=var/ci/<name>`(`scripts/kit/ci-targets.mjs`)은 각 target을 자기 `make -k <target>`으로 실패한 target 뒤에도 시간 제한 없이 끝까지 실행하고 보고서를 쓴다. `record.json`은 tree, 도구의 실행 중인 release, 각 target의 상태와 시간, 실패한 target의 첫 실패 줄(test reporter가 `✖`로 표시한 줄과 그 들여쓴 세부 줄, 없으면 오류 줄, 없으면 마지막 줄, 그리고 make가 끝난 방식)을 담고, `targets/<target>.log`는 전체 출력을, `summary.md`는 요약을 담는다. 어떤 보고서 쓰기도 실행을 멈추지 않는다. 실패한 쓰기는 출력하고 기록하며 실행은 실패한다. `make ci-summary CI_REPORT=var/ci/<name>`은 기록하지 않았거나 끝을 기록하지 않은 실행에도 요약을 보고서와 job summary에 쓰고 실패한 각 setup step을 밝히며, job은 보고서를 artifact `ci-<name>-<run id>-<attempt>`로 upload한다. 두 step 모두 실패한 step 뒤에 실행한다. `tests/kit/ci.test.mjs`와 `tests/scripts/ci-workflow.test.mjs`가 이를 검사한다.
- **HY-94** 버전 0.1 전까지 변경은 그것을 소유한 unit test로 검사하고, `docs/plans/execution-checklist.md`의 모든 작업이 끝났을 때 `main`에 한 번 push한다. 저장소에는 pull request, merge queue, GitHub ruleset이 없다. 추적하는 pre-push hook `.githooks/pre-push`는 `make hooks`가 쓰며(`scripts/kit/git-hooks.mjs`), push gate(`scripts/kit/push-gate.mjs`)를 실행한다. push gate는 push하는 commit에도 working tree에도 checklist의 `[~]` 작업이 있으면 push를 거부한다. 모든 `make` 실행은 `core.hooksPath`를 `.githooks`로 설정하고, `make hooks-check`와 full run의 guard는 그것이 설정되지 않았거나 hook이 다르면 실패한다. `main`의 push는 `.github/workflows/ci.yml`을 실행하며(HY-91), 그 마지막 job `ci-passed`는 다른 모든 job 뒤에 실행되어 그 모든 job의 결과가 `success`일 때만 통과한다. `main`의 commit에서 이 job의 실행이 그 commit의 증거이며 release tag가 이를 요구한다(HY-95). `make push-gate-commit`은 hook을 건너뛴 push를 위해 `COMMIT`에 push gate를 실행하며 전체 suite의 target이다. `tests/kit/push-gate.test.mjs`, `tests/kit/git-hooks.test.mjs`, `tests/scripts/ci-workflow.test.mjs`가 이를 검사한다.
- **HY-95** 릴리스는 `main`의 commit에 붙인 tag `vX.Y.Z`이고, 메인테이너가 버전 올림 commit 뒤에, 그리고 그 commit의 CI 실행의 check `ci-passed`가 성공한 뒤에 push한다(HY-94). tag는 pull request로 올리지 않는다. tag의 push는 `.github/workflows/release.yml`(`on: push: tags: ['v*', '**/v*']`, 권한 `contents: write`. tag filter에서 `*`는 `/`와 맞지 않으므로 `**/v*`는 어떤 깊이의 Go module tag도 포함하며, 이 저장소에는 Go module이 없다)을 실행한다. job은 `ubuntu-26.04-arm`의 하나이고, 각 step이 앞의 step을 필요로 하므로 첫 실패에서 멈춘다. step은 `scripts/kit/kit.mk`의 target이며 `config/release.json`을 읽는다. `make release-verify`는 tag된 commit이 `origin/main`의 조상이고 GitHub API에서 읽은 그 commit의 최신 check run `ci-passed`가 결론 `success`로 완료되었는지 확인하며 test를 다시 실행하지 않는다. `make release-versions`는 `package.json`, `packages/hyper-client/package.json`, `packages/hyper-server-node/package.json`, `packages/hyper-build/package.json`, `packages/hyper-php/composer.json`, `packages/hyper-python/pyproject.toml`에 X.Y.Z가 있고 `CHANGELOG.md`와 `CHANGELOG.ko.md`에 section `## X.Y.Z`가 있는지 확인한다. `make release-assets`는 패키지를 빌드하고 `polyspec-hyper-client-npm-X.Y.Z.tgz`, `polyspec-hyper-server-npm-X.Y.Z.tgz`, `polyspec-hyper-build-npm-X.Y.Z.tgz`(`npm pack`), `polyspec-hyper-php-X.Y.Z.zip`(tag된 commit의 `packages/hyper-php`의 `git archive`)을 `var/release/assets`에 쓴다. 각 archive는 tree의 manifest를 그대로 담는다. 공개되는 manifest는 모든 polyspec 패키지를 정확한 버전으로 적는다. 이 저장소의 패키지는 릴리스의 버전으로, `@polyspec/template`, `@polyspec/template-compiler`, `polyspec/template`은 `TEMPLATE_TAG`의 버전으로 적고, `packages/hyper-php/composer.json`은 `version`을 선언하고 `repositories`가 없다. packed manifest가 polyspec 패키지를 경로, git source, URL, range 또는 `@dev`로 적거나, `repositories`를 선언하거나, 버전이 없거나, source manifest와 다르면 이 step은 실패한다. archive 이름은 `<package>-<language>-<version>.<ext>`이고 `@scope/`와 `vendor/`는 `scope-`와 `vendor-`로 쓰며 language는 `npm` 또는 `php`이다. 릴리스 asset은 npm tarball과 Composer zip뿐이고, Python 패키지 `packages/hyper-python`은 릴리스가 archive로 빌드하지 않고 git tag로 사용한다. `make release-publish`는 archive와 함께 `gh release create <tag> --verify-tag --title <tag> --notes-file <section X.Y.Z>`를 실행한다. `make release-coverage`는 `config/release.json`이 분류하지 않은 tracked manifest가 있으면 실패하고, `make release-consumer`는 archive를 깨끗한 consumer 프로젝트(`tests/release-install`)에 설치해 패키지마다 smoke 명령을 실행한다. 각 실패는 tag, check나 파일, 두 값을 적는다. step의 test는 `tests/kit/release.test.mjs`에 있고, `tests/scripts/ci-workflow.test.mjs`는 trigger, 권한, step의 순서를 요구한다.
- **HY-79** checkout의 어떤 `node_modules`나 `vendor` 디렉터리에도 symbolic link가 없다. npm은 모든 의존성을 사본으로 설치하고(`install-links=true`) bin link를 쓰지 않는다(`bin-links=false`, `.npmrc`). root package는 `@polyspec/hyper-client`(`file:packages/hyper-client`), `@polyspec/hyper-server`(`file:packages/hyper-server-node`), `@polyspec/template`을 선언하고 그 사이의 의존성에는 override를 두며, npm은 workspace를 언제나 link하므로 npm workspace를 두지 않는다. `make packages`는 각 package를 build하고 그 사본을 다시 설치한다. recipe는 TypeScript, esbuild, Vitest, Playwright를 그 package의 파일로 실행한다. package 디렉터리의 mirror는 그 `vendor`까지 복사하므로, private root `composer.json`은 개발용으로 `packages/hyper-php`를 root `vendor`에 설치한다. 그 path repository는 사본 `var/products/hyper-php`와 template 사본이고, autoload는 `packages/hyper-php/src`와 `packages/hyper-php/tests`의 namespace를 가리키므로 test는 tree를 실행한다. Composer는 root와 board에 `polyspec/hyper`를 `packages/hyper-php`의 추적 파일 사본 `var/products/hyper-php`(`scripts/copy-package.mjs`, `make hyper-php-copy`)에서 `symlink: false`로 설치한다. `tests/scripts/no-symlinks.test.mjs`는 `node_modules`나 `vendor` 아래의 symbolic link 하나에도 실패한다. bin link가 없으면 `npx tsc`와 `npm exec tsc`는 명령을 찾지 못하므로, `scripts/tsc.mjs`가 checkout의 TypeScript compiler를 그 package의 경로로 호출의 인자와 함께 실행하고, 각 npm package는 이것으로 build를 선언한다. `packages/hyper-client`나 `packages/hyper-server-node`에서 `npm run build`는 `tsconfig.build.json`을 compile하고, `npm run tsc -- <tsc arguments>`는 호출의 인자, 예를 들어 project file로 compiler를 실행한다. `tests/scripts/package-build.test.mjs`는 각 package를 이렇게 build한다.
- **HY-35** 브라우저는 렌더가 템플릿에 닿을 때 그 템플릿을 불러온다. 렌더하고, 렌더가 불러오지 않은 템플릿을 요청했으면 그 템플릿들을 색인의 URL로 불러온 뒤 다시 렌더한다. 렌더가 끝나거나 다른 이유로 실패할 때까지 반복한다. 데이터가 고르지 않은 분기의 템플릿처럼 어떤 렌더도 닿지 않는 템플릿은 불러오지 않는다. 그래서 여러 화면 가운데 하나를 고르는 라우트 템플릿은 보여 주는 화면만 불러온다.
  - 라우트의 진입 템플릿은 레이아웃, 제목, 페이지가 아닌 모든 영역 템플릿, 라우트 템플릿, 모든 라우트 영역 템플릿이다. 영역 요청이면 진입 템플릿 불러오기를 요청과 함께 시작해 동시에 진행한다. 응답 URL이 다른 라우트로 라우팅되면(예: 리다이렉트 뒤) 그 라우트의 진입 템플릿을 불러온다.
  - 서버가 렌더한 페이지를 열 때는 템플릿을 불러오지 않는다. 브라우저가 그 페이지의 영역을 처음 렌더할 때 필요한 템플릿을 불러온다.
  - 클라이언트 렌더 문서는 데이터를 내장하지 않으므로(HY-31) 브라우저는 `hyper/data.tpl`을 렌더하지 않는다. 그것을 렌더하는 Node 서버가 색인에 그것이 있는지 확인한다.
  - 색인에 없는 이름은 렌더를 실패시킨다(HY-47).
  - 불러온 템플릿은 페이지가 내려갈 때까지 유지한다.
  - 모든 페이지를 렌더하는 Node 서버는 열 때 색인의 모든 템플릿을 읽는다.
- **HY-76** 페이지는 자기가 쓰는 자원만 요청하고, 페이지가 열려 있는 동안 각 자원을 많아야 한 번 요청한다. 자원은 템플릿 파일, 스타일시트, 스크립트 파일이다.
  - 브라우저는 렌더가 템플릿에 닿을 때 그 템플릿을 불러온다(HY-35).
  - 레이아웃은 자기가 렌더하는 내용의 스타일시트만 링크한다. 브라우저는 렌더한 head마다 그 스타일시트 링크를 적용하고, 이미 적용한 링크는 그대로 둔다(HY-64). 애플리케이션이 모든 페이지에 링크하는 스타일시트는 모든 페이지가 쓰는 스타일시트다.
  - 에셋 빌드는 클라이언트 진입 파일 `public/assets/hyper-<hash>.js`를 쓴다. 진입 파일이 정적으로 불러오지 않고 `import()`로만 불러오는 코드는 조각 파일 `public/assets/hyper-chunk-<hash>.js`로 쓴다. 브라우저는 그 코드가 처음 실행될 때 `/assets/` 아래의 절대 URL로 조각을 불러온다. 그래서 정적 셸이 인라인한 진입 파일도 조각을 불러올 수 있고, 브라우저는 모듈 하나를 한 번만 불러온다.
  - 에셋 빌드는 애플리케이션이 이름을 정하는 파일을 쓰지 않는다. 템플릿 파일과 색인(HY-34), 진입 파일, 조각 파일, 진입 파일의 URL을 유일한 멤버 `hyper`로 담은 `--output` 디렉터리의 `manifest.json`, 정적 셸을 쓴다. 애플리케이션은 자기 스타일시트를 직접 두고 링크하며, 레이아웃이 링크하는 스타일시트처럼 정적 배포물이 같은 경로에 담을 `public/` 아래 파일을 `--static`으로 밝힌다. `public/assets`에는 이전 build의 파일이 남으므로 에셋 빌드는 `public/assets`의 다른 파일을 배포물에 넣지 않는다.
  - 정적 셸은 `<meta name="hyper-api">`와 인라인한 진입 파일을 담고 스타일시트는 담지 않는다. 브라우저는 페이지를 보이기 전에 렌더한 레이아웃의 스타일시트 링크를 적용하기 때문이다(HY-22, HY-64).
  - `tests/scripts/build-assets.test.mjs`는 진입 파일이 `import()`로 모듈을 불러오는 애플리케이션을 빌드한다.
- **HY-77** 옵션 `--tailwind <source>=<output>`이 application의 stylesheet를 가리키면 asset build는 그것을 Tailwind CSS로 compile한다. 두 경로는 application directory 기준 상대 경로다.
  - output은 cascade layer `theme`, `base`, `components`, `utilities`를 이 순서로 선언하고, 최신 stable Tailwind CSS의 theme 변수와 `templates/`와 `client/` 아래 file이 쓰는 utility class를 담으며, source의 rule을 바꾸지 않고 layer `components`에 담는다. 그래서 utility class가 그 rule보다 우선한다.
  - output은 layer `base`의 rule을 담지 않는다. 그래서 element는 Tailwind CSS 없이와 같이 application의 rule과 browser가 주는 모양을 가진다.
  - build는 output을 다른 output과 함께 쓰고, source를 읽을 수 없거나 Tailwind CSS가 거부하면 실패한다. `tests/scripts/build-assets.test.mjs`는 template이 utility class를 쓰는 application을 build한다.

## 유지 데이터

- **HY-37** 라우트 영역만 유지 경로를 선언할 수 있다. 브라우저에서 바뀌는 것은 라우트 영역뿐이기 때문이다(HY-30). 매니페스트 검사는 매니페스트 영역의 `keep`을 거부한다. 예: `"keep": { "notice.closed": "server", "sort": "localStorage" }`. 경로는 HY-33을 따른다. 유지 값은 종류가 가리키는 저장소에 남아 새로고침 후에도 유지된다.

| 종류 | 저장소 | 값이 바뀔 때의 요청 | 첫 SSR 문서 |
|---|---|---|---|
| `server` | 서버 세션 | 렌더가 기다리지 않는 백그라운드 요청 1회 | 값이 들어 있음 |
| `cookie` | 브라우저 코드가 쓰는 쿠키 `hy-keep`. `HttpOnly`일 수 없다 | 없음 | 값이 들어 있음 |
| `localStorage` | 브라우저 `localStorage` | 없음 | 로더 값이 들어 있음. 브라우저가 불러온 뒤 유지 값을 렌더한다 |
| `sessionStorage` | 탭의 브라우저 `sessionStorage` | 없음 | 로더 값이 들어 있음. 브라우저가 불러온 뒤 유지 값을 렌더한다 |

- **HY-38** 사용자가 브라우저에서 마지막으로 정한 값이 우선한다. 로더 데이터는 기본값이다. 유지 값은 영역 데이터에 그 경로가 있고, 유지 값이 template 데이터 모델의 값이며(±(2^53 − 1) 밖의 수는 아니다), 다음을 만족할 때 그 경로의 값에 맞는다.
  - null, 불리언, 숫자, 문자열은 타입이 같다.
  - 맵은 맵을 대체한다. 데이터 맵에 키가 있으면, 유지 맵은 키가 같고 모든 키의 값이 같은 키의 값에 맞는다.
  - 목록은 목록을 대체한다. 데이터 목록에 항목이 있으면, 모든 유지 항목이 그 첫 항목에 맞는다.

  빈 데이터 맵이나 목록은 형태를 알려 주지 않으므로 어떤 맵이나 목록도 맞는다. 그런 값은 아래의 렌더 확인이 다룬다.

  맞지 않는 유지 값은 무시한다.
  - 서버는 `server`와 `cookie` 값을 읽어 맞는 값을 `kept`로 보낸다(HY-17). 이 값은 `regions`를 바꾸지 않는다.
  - 영역은 데이터에 유지 값을 다음 순서로 적용해 렌더한다. `kept`의 값, `localStorage`와 `sessionStorage` 값, 저장이 끝나지 않은 `server` 값(HY-39). 서버는 `kept`의 값만 적용한다. 브라우저는 모두를 자기가 보관하고 렌더하는 데이터에 적용하며, 서버와 동기화하지 않는다. 서버가 렌더한 문서에서는 브라우저가 내장 데이터를 보관한 뒤에, 또는 브라우저 값이 저장되어 있어 데이터를 얻은 뒤에(HY-32, HY-93) 적용하고, 데이터가 바뀐 영역을 모두 렌더한다.
  - 유지 값을 적용한 영역이 단독으로(HY-13) 렌더되지 않으면, 그 영역은 로더 데이터로 렌더하고 그 유지 값을 `kept`와 보관 데이터에서 뺀다. 서버는 내장 데이터를 렌더하기 전에(HY-31) 그 값을 빼므로, 서버와 브라우저는 같은 문서를 렌더한다. 로더 데이터로도 렌더되지 않으면 렌더가 실패한다(HY-43, HY-47).
- **HY-39** `set`, `render`, `hy-set`이 경로를 바꾸면, 브라우저는 영역을 먼저 렌더한 뒤 유지 경로를 저장한다. 저장 대상은 바뀐 경로와 같거나, 그 아래에 있거나, 그 경로를 포함하는 모든 유지 경로이며, 각각 그 유지 경로에 지금 있는 값을 저장한다. `server` 값은 서버가 그 값에 204로 응답하거나 같은 경로의 이후 변경이 저장될 때까지 대기 상태이며, 대기 중에는 HY-38대로 적용한다. 한 경로의 저장은 한 번에 하나씩 보낸다. 그 경로의 저장이 진행 중일 때 생긴 변경은 그 저장이 끝난 뒤에 보내며, 가장 최근 값만 보낸다. 저장에 실패하면 값을 계속 대기 상태로 두고, 그 경로의 이후 변경이 없으면 영역을 실패로 표시한다(HY-47).
  - `server`: 폼 필드 `_csrf`(보관한 `shared.csrf`, HY-10), `region`, `path`, `value`(값의 JSON 텍스트)로 `POST <base path>/_hyper/keep`을 보내고 응답을 기다리지 않는다.
  - `cookie`: 쿠키 `hy-keep`을 `Path=/`, `SameSite=Lax`, 1년의 `Max-Age`로 쓴다. HTTPS에서는 쿠키 이름이 `__Host-hy-keep`이고 `Secure`도 붙는다. 그래서 형제 서브도메인 같은 다른 호스트가 이 쿠키를 심을 수 없다. 서버는 요청이 HTTPS를 쓰거나 애플리케이션이 HTTPS를 선언하면(HY-45) `__Host-hy-keep`을, 그렇지 않으면 `hy-keep`을 읽는다. 쿠키 값은 URL 인코딩한 JSON 객체 `{ "<region>": { "<path>": <value> } }`다.
- **HY-40** 서버는 `POST <base path>/_hyper/keep`에 다음과 같이 응답한다. 경로 `/_hyper/keep`은 예약되어 있으므로, 라우트 경로는 `/_hyper`로 시작할 수 없다.
  - 204: 값을 세션에 저장한 뒤
  - 403: CSRF 토큰이 맞지 않을 때
  - 400: 영역이 그 경로를 `server`로 선언하지 않았거나, 값이 JSON이 아니거나, JSON 텍스트가 4,096바이트보다 길거나, 값이 template 데이터 모델의 값이 아닐 때
- **HY-41** `conformance/keep.json`은 영역 데이터, 유지 값, HY-38을 적용한 뒤의 기대 데이터를 담는다. PHP 구현과 JavaScript 구현은 모든 사례를 통과한다.

## 요청 경계와 실패

- **HY-42** 요청 경로는 요청 대상의 경로다. 요청 대상에서 첫 `?`나 `#` 앞까지이며, 절대 형식 대상(`http://host/path`)에서는 authority 뒤의 부분이다. 그 이상 디코딩하지 않는다. 경로는 RFC 9112가 요청 대상에 요구하는 대로 출력 가능한 ASCII 문자 `!`부터 `~`까지로만 이루어져야 하며, 쿼리와 폼의 모든 이름과 값(HY-56, HY-57), `HX-Current-URL` 헤더는 유효한 UTF-8이어야 한다. 그렇지 않으면 서버는 어떤 로더나 액션도 실행하기 전에 상태 400으로 응답한다. 쿠키는 검사하지 않는다. 서버는 JSON 객체가 아닌 `hy-keep` 쿠키와 그 안의 맞지 않는 값(HY-38)을 무시하고, 자기가 만든 식별자가 아닌 세션 쿠키에는 새 세션을 시작한다(HY-45).
- **HY-43** 애플리케이션이 처리하지 않은 예외는 상태 500과 텍스트 `Internal Server Error`를 만든다. 응답에는 예외 메시지, 파일 경로, 스택 트레이스가 없으며, 서버는 이를 자기 로그에 쓴다. PHP 설정 `display_errors`는 PHP가 요청을 시작하기 전에 꺼져 있어야 한다. PHP는 애플리케이션이 실행되기 전에 시작 경고(예: `max_input_vars`)를 출력하기 때문이다.
- **HY-74** PHP 서버가 요청에 응답하는 동안 PHP가 내는 모든 경고, 알림, 폐기 예정 알림은 예외가 되고, 요청은 HY-43으로 실패한다. 정의되지 않은 변수, 정의되지 않은 배열 키, 잘못된 인자가 여기에 든다. 그렇지 않으면 PHP는 `null`이나 변환한 값으로 계속 실행해, 메시지는 로그에만 남기고 틀린 페이지를 상태 200으로 보낸다. 식이 `@`로 억누른 오류는 `error_reporting()`이 처리기에 알려 주는 대로 조용히 둔다. 서버는 처리기를 그 요청 동안만 설치하고, 끝나면 이전 처리기로 되돌린다.
- **HY-44** 공유 데이터와 영역 데이터는 template 데이터 모델의 값이다. ±(2^53 − 1) 밖의 수는 정수든 아니든, 문서든 JSON이든 HY-43으로 실패한다. 서버는 템플릿이 읽지 않는 값을 빼기(HY-73) 전에 공유 데이터 핸들러와 로더가 돌려준 모든 값을 검사한다. 그래서 데이터 모델 밖의 값은 어떤 템플릿도 읽지 않아도 실패한다. 공유 데이터 핸들러와 모든 로더는 맵을 돌려준다. PHP에서는 비어 있거나 목록이 아닌 배열이고, Node에서는 일반 객체나 `Map`이다. 목록 같은 다른 값은 HY-43으로 실패한다. 검사는 template 데이터 모델의 host binding(VAL-13, VAL-14)과, bind한 값에 native object(VAL-19)가 없는지의 확인이다. binding이 데이터 모델 값으로 바꾸는 값(PHP `stdClass`, `JsonSerializable`, Node 일반 객체)은 통과하고, binding이 native object로 두는 application object(PHP `DateTimeImmutable`, Node `Date` 등)는 두 서버 모두에서 HY-43으로 실패한다. JSON 응답은 요청의 parameter만 다시 검사한다. 이 검사가 공유 데이터와 영역 데이터를 이미 다뤘고, kept 값은 데이터 모델의 값일 때만 응답에 들어가기 때문이다(HY-38).
- **HY-45** 서버 세션 쿠키의 이름은 요청이 HTTPS를 쓰거나 애플리케이션이 HTTPS로 제공된다고 선언하면 `__Host-hy-session`이고, 그렇지 않으면 `hy-session`이다. TLS를 끝내는 프록시 뒤의 서버는 반드시 이렇게 선언해야 한다. 애플리케이션은 이름을 정하지 않는다. 브라우저는 `__Host-` 쿠키를 그 호스트에서만 받으므로, 형제 하위 도메인 같은 다른 호스트가 자기가 토큰을 아는 세션을 방문자에게 심을 수 없다. 쿠키는 `Path=/`를 가지고 `Domain`이 없으며 `HttpOnly`, `SameSite=Lax`이고, 접두사와 같은 조건에서 `Secure`다. 서버는 자기가 만든 세션 식별자만 받아들이고, 요청이 세션 데이터를 읽거나 쓸 때만 세션을 시작한다. 라우팅 전에 거부한 요청(HY-42)과 경로가 어떤 라우트와도 맞지 않는 요청은 세션을 만들지 않는다. 모든 응답은 `Content-Security-Policy: frame-ancestors <sources>`를 가지며, sources는 애플리케이션이 정하고 기본값은 `'self'`다.
- **HY-46** 리다이렉트 위치는 애플리케이션 경로다. 유효한 UTF-8이며 `/`로 시작하고, 두 번째 문자는 `/`도 `\`도 아니며, 제어 문자(C0, DEL, C1), 공백, `\`를 담지 않으며, 경로에 `.`이나 `..` 세그먼트가 없다. 점을 퍼센트 인코딩한 경우(`%2e`)도 마찬가지다.
- **HY-47** 영역 요청이 JSON이 아닌 응답을 받거나, 렌더, 유지 값 저장, 템플릿 불러오기, stylesheet 불러오기(HY-64)가 실패하면, 브라우저는 스왑하지 않고 히스토리도 바꾸지 않는다.
  - 영역 요소의 `hy-error` 속성을 응답 상태로, 네트워크나 렌더 실패에는 `0`으로 설정한다. 이후 성공적으로 렌더되는 모든 영역에서 이 속성을 제거한다.
  - 취소된 요청은 실패가 아니다. 제한 시간(`hx-timeout` 또는 `htmx.config.defaultTimeout`)이 지나 htmx가 중단한 요청은 네트워크 실패다.
  - `render`, `set`, `hy-set`은 영역 렌더가 성공한 뒤에만 보관 데이터를 바꾼다. 실패하면 보관 데이터는 그대로다.
  - 클라이언트에서 문서 렌더가 실패하거나, 서버 렌더의 히스토리 복원에서 stylesheet 불러오기가 실패하면 body에 `hy-error`를 설정한다.

## Node 서버

- **HY-54** Node 서버 package `@polyspec/hyper-server`는 이 문서의 서버 규칙을 PHP 서버와 같게 구현한다. 그 test는 같은 fixture로 PHP 서버 test의 사례를 실행한다. PHP 서버와 다른 점은 다음뿐이다.
  - 문서는 브라우저가 문서 JSON 값을 렌더하는 방법(HY-12, HY-31, HY-38)으로, 브라우저 코드와 asset build의 템플릿 파일(HY-34)로 렌더하고, reply가 요청하면 데이터를 내장한다(HY-92).
  - JSON 텍스트는 `JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES`를 준 PHP `json_encode`와 같은 바이트다. 문자열은 `"`, `\`, U+0020 아래 제어 문자(`\b`, `\f`, `\n`, `\r`, `\t`, 나머지는 `\u00xx`), U+2028과 U+2029(`\u2028`, `\u2029`)를 escape하고 다른 문자는 escape하지 않는다. ±(2^53 − 1) 안의 정수는 10진수로 쓴다. 그 밖의 수는 같은 수로 다시 읽히는 가장 짧은 숫자로 쓴다. 소수점 위치 p(수는 0.d × 10^p)가 −3부터 17 사이면 위치 표기로, 아니면 소수 자리가 하나 이상인 `d.ddde±x`로 쓴다. 음의 0은 `-0`이다. 유지 값(HY-38, HY-40)은 PHP `json_decode`처럼 decode한다. 정수 literal은 정수이고 다른 literal은 float이며, ±(2^53 − 1) 밖의 수나 유한하지 않은 수는 데이터 모델의 값이 아니고, 512단계로 중첩된 container, 짝 없는 surrogate escape, U+0000으로 시작하는 key는 실패한다. `conformance/json.json`에 두 서버가 통과하는 사례가 있다.
  - 데이터 모델의 JavaScript 값은 null, boolean, ±(2^53 − 1) 안의 number나 bigint, string, 배열, 문자열 key의 `Map`, plain object다. UTF-8 형태가 없는 짝 없는 surrogate를 담은 문자열과 그 밖의 값은 HY-43으로 실패한다.
  - loader와 action은 요청, reply(HY-52), 애플리케이션이 key로 bind한 service를 담은 context 인자 하나를 받는다.
  - session store는 각 session을 한 디렉터리의 파일에 저장하며, 파일 이름은 store가 만든 64자리 16진수 식별자다. session cookie는 PHP session cookie와 같은 속성과 순서로 쓰고(`<name>=<id>; path=/; secure; HttpOnly; SameSite=Lax`, `secure`는 HY-45의 조건에서), 한 session의 요청은 차례로 실행한다.

- **HY-97** Python 서버 `polyspec-hyper`의 `create_server`(`polyspec.hyper.server`)는 선택적 요청 hook `around`를 받는다. 서버는 애플리케이션에 주는 모든 요청마다, 서버가 만든 요청과 함수 `answer`로 이를 한 번 호출하고, `around`가 반환한 `Response`를 보낸다. `answer(request)`는 `around`가 없을 때의 서버처럼 요청에 대해 애플리케이션을 실행한다. 요청의 session cookie로 그 session을 열고, 응답 hook(HY-60)을 호출하는 `App.respond`로 응답하고, session을 닫은 뒤, 새 session의 cookie를 가장 먼저 둔 응답을 반환한다(HY-45). `around`는 요청이나 바꾼 사본으로 `answer`를 호출할 수 있다. 사본의 예는 `Request.with_header(name, value)`가 header를 설정한 사본이다(이름은 `Request.header`가 읽듯 대소문자를 구분하지 않고 비교한다). `around`는 `answer`가 반환한 응답을 바꿀 수 있고, `answer`를 호출하지 않고 자기 응답을 반환할 수 있다. 그때 서버는 그 요청에 대해 session을 열지 않고 애플리케이션의 loader, action, hook을 실행하지 않는다. client가 연결을 닫아 응답의 쓰기가 실패하면(HY-67), 서버는 마지막 `answer` 호출의 요청과 reply로 연결 끊김 hook을 호출하고, `around`가 `answer`를 호출하지 않았으면 호출하지 않는다. public 디렉터리의 파일은 `around` 전에 제공되며 `around`에 닿지 않는다. callable이 아닌 `around` 값은 `create_server`를 호출할 때 실패한다. `answer` 밖에서 `around`가 발생시킨 오류와 `Response`가 아닌 반환값은 HY-43이 처리하지 않는다. `http.server`가 오류를 표준 오류에 쓰고 응답 없이 연결을 닫는다.
  - Node 서버는 `app.server()`가 반환한 `node:http` 서버로 같은 것을 준다. consumer는 그 `request` listener를 애플리케이션의 listener를 호출하는 listener로 바꿔, 각 요청을 자기 context에서 실행하거나, 요청과 응답에 request id header를 더하거나, 애플리케이션보다 먼저 요청에 스스로 응답한다. 예를 들어 자기 web server에서 오지 않은 요청에 400으로 응답한다. `http.server` 요청 handler를 바꿀 수 없는 Python 서버의 애플리케이션에는 `around`가 이것들을 준다.

- **HY-55** `make server-parity`는 `examples/board/tests/parity/requests.json`의 단계를 PHP 서버와 board Node 서버에 동시에 실행한다. 각 서버는 자기 빈 데이터베이스와 session을 쓰고, 게시글의 생성 시각(`BOARD_TIME`)은 같다. 단계의 모든 요청에서 HTML 문서, 문서 JSON, 영역 JSON 모두 두 응답의 상태, header, body가 같아야 한다. 비교 전에 session cookie의 session 식별자를 `<session>`으로, 각 응답의 가린 CSRF token(HY-24)을 header와 body에서 `<csrf>`로 바꾸고, body에 가린 token이 들어 있으므로 `ETag` 값이 그 body의 tag인지(HY-53) 확인한 뒤 `<etag>`로 바꾼다. 이 확인에 쓰는 session token은 가린 값의 뒤쪽 절반과 앞쪽 절반의 XOR다. HTTP 서버 프로그램이 스스로 쓰는 header인 `Date`, `Connection`, `Keep-Alive`, `Content-Length`, `Transfer-Encoding`과 PHP 내장 서버의 `Host`, `X-Powered-By`는 비교하지 않는다. header는 이름과 값 쌍의 집합으로 비교하고, `Set-Cookie`는 값마다 비교한다. 같은 실행에서 PHP 서버에 대한 `make parity`의 브라우저 비교도 수행한다.

- **HY-61** npm package `@polyspec/hyper-client`와 `@polyspec/hyper-server`는 type 선언을 가진 JavaScript module을 배포하며, `make packages`가 이를 각 package의 `dist` 디렉터리에 쓴다. 각 package의 `exports`는 entry로 `dist/index.js`와 `dist/index.d.ts`를 가리키고, package는 build 출력 중 `dist`만 담는다. `@polyspec/hyper-client`는 선언 `templates-index.d.ts`(HY-34)와, build가 읽는 예약 템플릿 `hyper/data.tpl`의 source인 data 파일 `data-template.json`(HY-96)도 export한다. 따라서 Node는 type을 제거하지 않는 `node_modules`에서 bundler 없이 이를 실행한다. TypeScript 소스는 지울 수 있는 문법(`erasableSyntaxOnly`)만 쓰며, 선언은 `erasableSyntaxOnly`를 켠 package에서 type 검사를 통과한다. `make package-check`는 두 package를 그 `package-lock.json`에서 `npm ci --offline --install-links`로 `tests/package-install`에 설치하고(HY-89), 그 test를 선언에 대해 type 검사한 뒤 `node`로 실행한다. TypeScript 소스를 export하는 package는 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`으로 실패한다.

## 오류

- **HY-27** 상태 404와 405는 다음 경우에 응답한다.
  - 404: 라우트가 없는 경로, 또는 로더가 리소스 없음을 보고한 경우
  - 405: `GET`도 아니고 선언된 `POST`도 아닌 메서드
- **HY-50** loader나 action은 redirect로 요청을 멈출 수 있다. HY-25의 결과의 redirect를 던지며, 이 결과는 application 경로(HY-46)를 지정하고 flash 값과 바뀐 topic을 담을 수 있다. 서버는 상태 303과 base path를 붙인 `Location`으로 응답하고, HY-25처럼 flash 값과 바뀐 topic을 저장하며, 아무것도 렌더하지 않는다.
- **HY-51** loader나 action은 금지로 요청을 멈출 수 있다. 서버는 상태 403과 텍스트 `Forbidden`으로 응답하고, 그 요청의 다른 loader나 action을 실행하지 않는다.
- **HY-52** 요청의 모든 loader와 action은 그 요청의 reply를 받을 수 있다. reply는 이름이 `[a-z][a-z0-9_-]*`이고 `hy-`로 시작하지 않으며, 값이 `A-Z a-z 0-9 . _ ~ -` 문자이고, 선택적인 `Max-Age`를 가진 cookie를 더하거나, `Max-Age=0`으로 cookie를 지운다. 이런 cookie는 `Path=/`, `HttpOnly`, `SameSite=Lax`를 가지며 HY-45의 조건에서 `Secure`를 가진다. 다른 이름이나 값은 HY-43으로 실패한다. 페이지 응답은 `Cache-Control: no-store`를 가진다. reply는 상태 200인 페이지 응답의 `Cache-Control`을 정할 수 있으며 이 값은 `no-store`를 대신한다. 페이지는 방문자의 세션 토큰을 담으므로(HY-10, HY-24), 지시어 `private`나 `no-store`가 없거나 `public`이나 `s-maxage`가 있는 값은 HY-43으로 실패한다. 공유 캐시가 한 방문자의 페이지를 다른 방문자에게 주면 안 되기 때문이다. 서버 세션은 응답에 자기 cookie만 더하고 caching header는 더하지 않는다. HY-53의 304를 포함해 body가 없는 응답은 `Content-Type`을 가지지 않는다. 요청의 응답은 페이지든, redirect든, HY-27, HY-50, HY-51의 실패든 그 reply의 cookie를 담는다.
- **HY-53** 상태 200인 JSON 응답은 약한 `ETag` `W/"<digits>"`를 가진다. digits는 body에서 그 응답의 가린 토큰을 모두 세션 토큰으로 바꾼 뒤의 SHA-256 digest 처음 32개 16진수다(HY-24). 그래서 데이터와 세션 토큰이 같은 두 응답은 가림 값이 달라도 같은 tag를 가지며, 바이트가 다르므로 tag는 약하다(RFC 9110, 8.8.1절). 갱신한 세션(HY-72)은 토큰이 달라 tag도 다르다. `If-None-Match` header가 그 tag와 같은 `GET` 요청은 `Content-Type`을 뺀 200 응답의 header와 함께, body 없이 상태 304를 받는다. 304는 representation을 담지 않고(RFC 9110, 15.4.5절) php-fpm은 304의 `Content-Type`을 지우기 때문이다. action은 요청이 어떤 tag를 지정하든 실행된다.
- **HY-58** loader나 action은 잘못된 요청으로 요청을 멈출 수 있다. 서버는 상태 400과 텍스트 `Bad Request`로 응답하고, 그 요청의 다른 loader나 action을 실행하지 않는다. action은 200, 409, 422 중 정한 상태와 데이터로 라우트 페이지를 반환할 수도 있다. 서버는 라우트 데이터에 그 데이터를 병합해 라우트 페이지를 JSON 요청에는 JSON으로, 그 밖의 요청에는 문서로 렌더하고 그 상태로 응답한다. 다른 상태는 HY-43으로 실패한다. HY-26은 상태 422인 페이지이고, 상태 200인 페이지는 HY-52와 HY-53을 따른다.
- **HY-69** loader나 action은 PHP의 `Reply::status(403)`과 Node의 `reply.status(403)`으로 그 요청의 페이지에 상태 403을 줄 수 있다. 요청이 볼 수 없는 데이터 대신 다른 데이터를 보이는 페이지, 예를 들어 session이 필요한 페이지 대신 보이는 sign-in form을 위한 것이다. 그렇지 않으면 상태 200인 페이지 응답, 곧 `GET` 요청의 페이지나 상태 200인 action 결과 페이지(HY-58)는 상태 403을 가지며, 200일 때처럼 JSON 요청에는 JSON으로, 그 밖의 요청에는 문서로 렌더된다. 상태 400 이상인 모든 응답처럼 `Cache-Control: no-store`를 가지고(HY-65), 200이 아닌 모든 응답처럼 `ETag`가 없으며 304를 받지 않는다(HY-53). 상태 409나 422인 페이지, redirect, stop, 실패는 자기 상태를 유지한다. 다른 상태는 HY-43으로 실패한다. 403은 요청이 그 페이지를 볼 수 없음을 밝히기 때문이다. 401은 `WWW-Authenticate` challenge를 요구하고(RFC 9110), 200은 응답이 그 페이지라고 밝힌다.
- **HY-59** 애플리케이션은 body 한도, 즉 가장 큰 요청 body의 바이트 수(기본 8 MiB)와 폼 type, 즉 action과 `/_hyper/keep`이 받는 요청 body의 media type을 선언한다. 폼 type은 `application/x-www-form-urlencoded`와 `multipart/form-data` 중 하나나 둘이며, 기본값은 `application/x-www-form-urlencoded`다. 다른 한도나 폼 type은 애플리케이션을 열 때 실패한다. 서버는 요청을 다음 순서로 검사하며, 검사가 실패하면 어떤 loader나 action도 실행하지 않는다.
  1. 한도보다 큰 body는 모든 요청에서 HY-42보다 먼저 텍스트 `Content Too Large`와 함께 상태 413을 받는다. body의 크기는 그 길이이며, `Content-Length`가 더 크면 그 값이다. PHP는 `post_max_size`보다 큰 body를 비워 두기 때문이다. Node 서버는 body가 한도를 넘으면 읽기를 멈춘다.
  2. 라우팅과 HY-27 뒤에, action이나 `/_hyper/keep`으로 가는 `POST` 요청의 `Content-Type` media type이 매개변수를 빼고 대소문자 구분 없이 비교해 폼 type이 아니면 텍스트 `Unsupported Media Type`과 함께 상태 415를 받는다.
  3. 그다음 HY-24의 CSRF 검사가 403으로 응답한다.

  PHP의 `App::run`은 `post_max_size`가 한도보다 작거나, `multipart/form-data`가 폼 type인데 `enable_post_data_reading`이 켜져 있으면 응답하기 전에 실패한다(HY-57).
- **HY-60** 애플리케이션은 응답 hook을 선언할 수 있다. 서버는 애플리케이션의 모든 응답마다 요청, 응답, 밀리초 단위의 경과 시간으로 hook을 한 번 호출한다. hyper가 스스로 응답하는 400(HY-42, HY-58), 403(HY-24, HY-51), 404와 405(HY-27), 406과 정적 셸(HY-62), 413과 415(HY-59), 500(HY-43, HY-66)도 포함한다. 요청은 받은 그대로의 요청이며 base path를 포함한다. 응답은 `Content-Security-Policy`(HY-45)를 가진 애플리케이션의 응답이며, 그 뒤에 session이 더하는 session cookie는 포함하지 않는다. 경과 시간은 요청의 시작부터 monotonic clock으로 센다. PHP의 `App::run`과 `handle`은 front controller의 첫 문장이 얻은 값처럼 호출자에게서 `hrtime(true)` 값으로 시작을 받으며, 받지 않으면 자기 호출부터 센다. Node 서버는 `node:http`가 요청을 준 시각부터 `performance.now()`로 센다. 어떤 서버도 `REQUEST_TIME_FLOAT`나 `microtime(true)` 같은 wall clock 시각을 빼지 않는다. 시스템 시각을 조정하면 wall clock이 뒤로 가서 음수 경과 시간이 나오기 때문이다. Node 서버는 `node:http`가 해석하지 못하는 요청에 대한 400과 431 응답도 request line의 method와 target으로 만든 요청과 함께 보고하며, packet에 request line이 없으면 요청 없이 보고한다. hook은 요청의 reply(HY-52)도 받으므로, 요청의 loader와 action이 정한 값을 읽는다. 이 reply는 loader와 action이 받은 reply이며, 요청이 멈춤(HY-50, HY-51, HY-58), HY-27의 실패, HY-43의 오류로 끝났을 때도 같다. 서버가 라우팅 전에 응답했을 때(HY-42, HY-59, 라우트가 없는 경로, `/_hyper/keep`, `node:http`가 애플리케이션에 주지 못하는 응답)나 loader와 액션 없이 응답했을 때(HY-62의 405와 406 응답과 셸)는 새 빈 reply다. loader나 action은 그런 값을 reply의 note, 즉 이름과 임의의 값으로 기록한다. 같은 이름의 나중 note는 값을 바꾸고 위치는 유지한다. 서버는 note를 읽지 않으며, note는 응답에 포함되지 않는다. hook은 HY-43이나 HY-66의 500에 대해 그 실패도 받으므로, 애플리케이션은 원인을 자기 줄에 쓴다. 실패는 HY-43의 오류 message(PHP `Throwable`이나 Node `Error`의 message, 또는 다른 던져진 값의 텍스트)나 HY-66의 `the response to <method> <path> has <size> bytes, more than the response limit of <limit> bytes`이다. 다른 모든 응답에 대해서는 null을 받는다. Node 서버의 공개 디렉터리 파일은 애플리케이션의 응답이 아니다. hook이 던진 오류는 HY-43으로 처리하지 않으며 `handle`의 호출자에게 간다.
- **HY-65** 상태가 400 이상인 모든 응답은 `Cache-Control: no-store`를 가진다. 그래서 어떤 cache도 실패를 저장하지 않는다. HY-24, HY-27, HY-40, HY-42, HY-43, HY-51, HY-58, HY-59, HY-62, HY-66의 텍스트 응답, `node:http`가 해석하지 못하는 요청에 대한 Node 서버의 400과 431 응답(HY-60), 상태 409나 422의 페이지(HY-58), 상태 403의 페이지(HY-69)가 이에 해당한다. reply는 이 값을 바꾸지 않는다(HY-52). 이 header가 없으면 cache는 404나 405 응답을 heuristic freshness로 저장할 수 있다(RFC 9111).
- **HY-66** 애플리케이션은 응답 한도, 즉 가장 큰 응답 body의 바이트 수(기본 8 MiB)를 선언한다. 양의 정수가 아닌 한도는 애플리케이션을 열 때 실패한다. 한도는 서버가 응답 하나를 보내려고 들고 있는 body를 제한한다. 느린 클라이언트는 그 body를 서버 프로세스의 메모리와 응답을 buffer하는 웹 서버의 메모리에 붙잡아 둔다. body가 한도보다 큰 응답은 보내지 않는다. 서버는 `hyper: the response to <method> <path> has <size> bytes, more than the response limit of <limit> bytes`를 자기 로그에 쓰고, HY-43처럼 텍스트 `Internal Server Error`와 함께 상태 500으로 응답하며, 그 500을 요청의 reply와 함께 응답 hook(HY-60)에 보고한다. body의 크기는 바이트 단위의 길이다. 템플릿 프로그램은 문서를 문자열 하나로 렌더하므로, 서버는 body를 끝까지 렌더한 뒤에 크기를 비교한다.
- **HY-67** 애플리케이션은 연결 끊김 hook을 선언할 수 있다. 서버는 client가 완전한 응답을 받기 전에 연결을 닫은 요청에 대해, 받은 그대로의 요청, 밀리초 단위의 경과 시간(HY-60), 요청의 reply로 이 hook을 한 번 호출한다.
  - Node 서버는 응답을 쓰기 전에 연결이 닫혔다고 `node:http`가 알릴 때 닫힘을 안다. 그러면 실행 중인 loader, action, 렌더 뒤에 그 요청의 다른 loader, action, 렌더를 실행하지 않고, 응답을 쓰지 않으며, 응답 hook을 호출하지 않고, 연결 끊김 hook을 호출한다.
  - PHP는 닫힌 연결을 그 연결에 쓰기가 실패할 때만 알리며, 닫힌 연결에 작은 응답을 쓰는 것은 성공할 수 있다. `App::run`은 `ignore_user_abort`를 끄므로 PHP는 응답의 첫 실패한 쓰기에서 script를 끝내고, shutdown 함수가 `connection_aborted()`가 1이면 연결 끊김 hook을 호출한다. 그래서 PHP 서버는 닫힘을 알기 전에 응답을 끝까지 렌더하고 응답 hook(HY-60)을 호출하며, 응답의 모든 쓰기가 성공하면 닫힘을 알지 못한다.
  - `polyspec-hyper`의 Python 서버(`polyspec.hyper.server`의 `create_server`)는 PHP처럼 응답의 쓰기가 실패할 때만 닫힌 연결을 안다. `http.server`는 client가 닫은 연결에 쓰면 `BrokenPipeError`, `ConnectionResetError`, `ConnectionAbortedError`를 발생시킨다. 서버는 먼저 응답을 끝까지 렌더하고 응답 hook(HY-60)을 호출한 뒤 응답을 쓴다. 쓰기가 이 오류 중 하나로 실패하면 응답의 나머지를 쓰지 않고, 받은 그대로의 요청, 밀리초 단위의 경과 시간, 요청의 reply로 연결 끊김 hook을 한 번 호출한다. 경과 시간은 응답 hook과 같게, 요청 handler가 요청을 시작한 시각부터 단조 시계인 `time.perf_counter_ns()`로 센다. 응답의 모든 쓰기가 성공하면 닫힘을 알지 못한다. `App.respond`는 `App.handle`처럼 요청에 응답하고 응답과 요청의 reply를 반환하므로, 서버는 연결 끊김 hook이 받는 reply를 가진다. `App.handle`은 응답만 반환한다.
- **HY-28** 브라우저 코드의 오류는 htmx 응답 훅에서 던져진다. htmx는 이를 `htmx:error` 이벤트로 보고하고 스왑하지 않는다.
