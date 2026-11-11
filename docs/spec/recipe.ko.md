<!-- doc-id: recipe -->
<!-- source-sha256: 5b07cbd0c4affeacca72393679d438feca29a90b84eeab488e7e4cf0b47e6036 -->
# 서버의 레시피

PHP, Node, Python 서버는 하나의 프로토콜(`protocol.md`)을 구현한다. 이 서버들의 레시피는 세 부분으로 이루어진다.

1. **개발 spec**, `contracts/interfaces.json`. 이 파일은 서버의 모든 concern, 각 concern의 unit과 파일, 그리고 그 unit들의
   모든 public, internal, private member를 정한다. 각 member는 언어 중립 설명과, 각 언어에서의 정확한 native symbol 및
   signature를 가진다.
2. **test recipe**, `contracts/` 아래의 case 파일. 언어마다 하나의 runner가 이 파일들을 모두 읽는다.
3. **각 언어의 고유 analyzer를 실행하는 check.**

`make recipe-check`는 1번과 2번 부분을 source와 test 실행 결과에 맞춰 검사한다.

## 규칙

- **HYR-1 One spec.** `contracts/interfaces.json`은 세 서버의 유일한 개발 spec이며, 이 spec의 schema는
  `scripts/schema/interfaces.schema.json`이다. 구조를 바꾸는 변경은 spec을 먼저 바꾼다. 그다음 세 언어의 파일이 같은
  변경에서 함께 바뀐다. spec을 쓰는 tool은 없다.

- **HYR-2 Concerns.** concern은 다음 필드를 가진다.
  - `id`: kebab-case로 쓴 단어들.
  - `rules`: concern이 구현하는 HY- 규칙 id. 모든 id는 `protocol.md`에 적혀 있다. `protocol.md`의 모든 HY- 규칙은
    concern이 이름으로 가리키거나, spec의 `outside` 필드(`{rule, reason}`의 목록)가 가리킨다. 예를 들어 브라우저 코드에만
    해당하는 규칙이 그러하다. concern이 가리키는 `outside`의 규칙이거나 reason이 빈 `outside` 항목이면 HYR-8에 실패한다.
  - `cases`: concern의 동작을 적는 `contracts/` 아래의 case 파일. unit이 없는 concern, 또는 모든 unit이 한 언어를 가리키는
    `only`를 가진 concern만 `none`을 가질 수 있으며, 이때 reason과 HYR-7의 native test를 함께 적는다. 그 밖의 concern이
    `none`이면 check가 실패시킨다.
  - `units`: concern의 unit들.

  `packages/server/php/src`, `packages/server/ts/src`, `packages/server/python/src/polyspec/hyper` 아래의 `git ls-files`
  파일은 모두 정확히 하나의 concern에 속하며, 이름이 적힌 파일은 모두 존재한다. unit의 파일은 정확히 하나의 unit을 가진다
  (HYR-3). barrel 파일(`index.ts`, `__init__.py`)과 `py.typed`는 `index` concern에 속하며 unit을 가지지 않는다. 이 파일들은
  HY-106의 public member와 public type을 re-export하는 내용만 가지며, HYR-8은 unit 검사 대신 이 목록을 검사한다.

- **HYR-3 One unit per file.** unit은 다음 필드를 가진다.
  - `id`: 단어들;
  - 각 언어의 `kind`: `class`, `interface`, `trait`(PHP) 중 하나, 또는 module 함수들의 묶음인 `functions`;
  - 각 언어의 파일.

  모든 언어에서 파일은 정확히 하나의 unit을 가진다.
  - PHP의 `functions` unit은 static method들의 class 하나다.
  - 일부 언어에만 있는 unit은 `only`를 가진다(HYR-6).
  - concern의 각 class, interface, trait은 자기 unit이며, Python의 각 class도 `Protocol`과 `TypedDict`를 포함하여 자기
    unit이다. Node의 `interface`는 다른 언어가 같은 단어의 unit을 가지면 kind `interface`의 unit이고, 그렇지 않으면 HYR-5의
    type이다. check는 unit의 단어와 같은 단어를 가진 type을 실패시킨다. 예: Result와 그 네 개의 stop, Session과 Flash,
    ClientRendering과 Choice, SessionStore와 ArraySession.

- **HYR-4 File names.** unit의 파일은 unit의 단어들을 그 언어의 규칙으로 쓴 이름이다.
  - PHP: PascalCase, `<Words>.php`, namespace `Polyspec\Hyper`에 속한다.
  - Node: kebab-case, `<words>.ts`.
  - Python: snake_case.
    - `<words>.py`는 HY-106 또는 HY-100이 public으로 만드는 module이다.
    - `_<words>.py`는 internal module이다.
    - HY-100이 이름을 정하는 module은 그 이름을 유지한다: `server`, `wsgi`, `asgi`.
  - 단어 경계.
    - 단어 경계는 소문자 또는 숫자 뒤에 대문자가 오는 자리다.
    - 약어는 한 단어이며 단어로 쓴다: PascalCase `Csrf`, camelCase `csrf`, snake_case `csrf`. 따라서 spec의 어떤 이름도
      대문자를 연속해서 두 개 가지지 않으며, check는 그런 이름을 실패시킨다.
    - member 이름도 같은 경계를 따른다(HYR-5).

  예를 들어 unit `media selection`은 `MediaSelection.php`, `media-selection.ts`, `_media_selection.py`다.

- **HYR-5 Members.**
  - **Scope.** unit의 member는 다음과 같다.
    - 모든 method와 module 함수, public, internal, private을 가리지 않는다;
    - constructor;
    - HY-106이 public API로 만드는 property.

    HY-106은 constant를 public API로 만들지 않으므로 constant는 member가 아니며, 모든 constant는 internal 또는 private이다.
    reader는 각 constant를 visibility만을 위해 읽으며, check는 constant 자신과 그 class 어디에도 `@internal`이 없는 PHP
    `public const`, `@internal`이 없는 Node의 export된 `const`, public module에서 `_`가 없는 Python module 수준 이름을
    실패시킨다. constant가 public API가 되려면 그 규칙이 먼저 필요하다.
  - **Properties.** property는 class 본문의 선언이다.
    - PHP의 타입이 붙은 property, 또는 constructor에서 승격된 parameter;
    - Node의 class field, 또는 Node의 parameter property(`public`, `private`, `protected`, `readonly`가 붙은 constructor
      parameter);
    - Node interface unit의 property signature;
    - Python의 class 수준 annotated attribute.
    method 본문의 대입은 property가 아니다.
  - **Fields of a member.** member의 필드는 다음과 같다.
    - `id`: `<unit>.<member>`, 언어 중립 이름을 camelCase로 쓴다.
    - `kind`: constructor, method, static method, function, property 중 하나.
    - `visibility`: public, internal, private 중 하나.
    - `inputs`, `output`, `errors`: 어휘의 용어로 쓴다. 어휘는 `scripts/schema/interfaces.schema.json`의 닫힌 목록이다. 즉
      `protocol.md`의 데이터 모델 타입, spec의 unit과 type, 그리고 이들의 `list<T>`, `map<T>`, `optional<T>`,
      `function(<T>, …) -> <T>`다. 이 밖의 용어는 HYR-8에 실패한다. error는 `protocol.md`의 status 또는 spec의 error unit이다.
    - `state`: member가 하는 일을 한 문장으로 쓴다.
    - `native`: 언어마다 정확한 `symbol`과 정확한 `signature`(아래 참조).
  - **Types.** type은 unit(HYR-3)이 아닌 타입 선언이다: Node의 `type` alias 또는 `interface`, 그리고 Python의 `type` 문.
    spec은 각 type을 `types` 아래에 한 번 적으며, `id`(camelCase로 쓴 단어들), `visibility`(member와 같다), `unit`(각
    언어에서 그 type을 가진 파일의 unit), 중립 `shape`, 그리고 선언하는 언어마다 `native: {symbol, declaration}`을 가진다.
    - shape는 record이면 중립 이름에서 어휘 용어로 가는 map인 `fields`와 `optional` 목록, 함수 타입이면 `inputs`와
      `output`을 가진 `function`, 또는 어휘 용어 하나다.
    - check는 빠졌거나, 추가되었거나, 옮겨졌거나, visibility가 다른 type을 실패시키며, HYR-5의 이름으로 쓴 필드가 shape와
      다른 선언을 실패시킨다.
    - options record는 이름 붙은 parameter의 runtime 형식이다(HY-106). 그 필드는 그것을 받는 member의 이름 붙은
      `inputs`이며, 다른 언어에서 같은 member의 이름 붙은 parameter와 다르면 check가 실패시킨다. 일부 언어에만 있는
      필드는 member처럼 `only`를 가진다(HYR-6).
  - **Symbol.** symbol은 `<path>::<qualified name>`이다.
    - `<path>`는 파일의 repository 기준 상대 경로다.
    - PHP member의 qualified name은 `Polyspec\Hyper\<Unit>::<member>`다.
    - Node와 Python에서 class member는 `<Unit>.<member>`, module 함수는 `<member>`다.
    - constructor는 PHP에서 `__construct`, Node에서 `constructor`, Python에서 `__init__`이다.
  - **Names.**
    - PHP와 Node는 camelCase 이름을 유지한다.
    - Python은 snake_case로 쓴다.
  - **Visibility.**
    - member는 중립 `visibility`를 하나 가진다. Public과 internal은 HY-106의 두 분류다. Private은 internal class 안에서의
      그 언어의 접근이다.
    - 언어별 public:
      - PHP: `public`이며, member나 그 class에 `@internal`이 없다;
      - Node: export되고 `private`이 아니며, member나 그 class에 `@internal`이 없다;
      - Python: public module(HYR-4)에서 member 앞에 `_`가 없다.
    - 언어별 internal:
      - PHP: `public`이며, member나 그 class의 docblock에 `@internal` 줄이 있다;
      - Node: export되고, member나 그 class에 JSDoc tag `@internal`이 있다;
      - Python: HY-106이 정하는 대로 member나 그 module 앞에 `_`가 있다. `_` module 안에서 `_`가 없는 member는 internal이다.
    - 언어별 private:
      - PHP: `private`;
      - Node: class member는 `private`, module 함수는 export되지 않는다;
      - Python: 앞에 `_`가 있고 spec이 `private`으로 선언한다. Python에는 접근 modifier가 없으므로 spec이 정하며, Python
        reader는 타입 추론 없이 이름으로 사용을 검사한다. 같은 package의 다른 파일에서 `private` member의 이름이 import
        이름, alias, 또는 attribute 이름(`ast.Attribute.attr`)으로 나타나면 실패시킨다. 따라서 private 이름은 package 안에서
        유일해야 하며, 동명이인은 spec과 source가 둘 중 하나의 이름을 바꿀 때까지 실패한다.
    - PHP와 Node reader는 private을 modifier에서 읽으며, modifier가 중립 `visibility`와 다른 member는 check가 실패시킨다.

- **HYR-6 Only some languages.** 일부 언어에만 있는 unit, member, type의 필드 또는 case는 `only: {languages, rule, quote}`를
  가진다.
  - `rule`은 HY- id다;
  - `quote`는 차이를 요구하는 그 규칙의 문장 전체 하나다. 문장은 첫 단어부터, 공백이나 규칙의 끝이 뒤따르는 마침표까지다.
    `session.save_handler`나 `6.3.0`처럼 code span이나 식별자 안의 마침표는 문장을 끝내지 않는다. 예는 HY-54, HY-100,
    HY-104, HY-105, HY-106, HY-115에서 온다.

  `only`가 없는 언어에서 빠진 unit, member 또는 type의 필드는 결함이다. 규칙의 문장 전체가 아닌 quote도 결함이다. 어떤 규칙도 이름을
  붙이지 않은 runtime 관용구, 예를 들어 Node.js 오류의 `code`는 unit도 member도 아니다. 각 사용자는 그것을 자기 코드에
  쓰며, 다른 언어가 자기 코드에 쓰는 것과 같다(Python의 `except FileNotFoundError`).

  Node 서버가 HY-54에 따라 브라우저 코드에서 가져오는 concern(manifest, region, router, reads, renderer)은 HY-54 문장과
  함께 `only` PHP와 Python인 unit이다. 이들의 동작은 case 파일을 통해(HYR-7) 세 서버에서 같다.

- **HYR-7 Test recipe.**
  - **Runners.** 언어마다 고정된 경로에 정확히 하나의 case runner가 있다. 이 runner는 `contracts/` 아래의 모든 case
    파일을 실행한다.
  - **Reading a case.** runner는 각 case를 그 언어의 case reader를 통해서만 읽는다. case reader는 모든 언어에서 같은
    member를 가진 test tree의 unit 하나다.
    - case reader는 case의 입력 필드를 runner에 넘기며, 각 기대 필드를 관찰된 값과 직접 비교한다. 비교 방법은 case 파일의
      규칙이 정한 것이다(예: `representations.json`에 대한 HY-123). runner는 비교하지 않는다.
    - case가 끝난 뒤 reader는 읽히지 않은 필드에 `FIELD_UNKNOWN <name>`으로, 비교되지 않은 기대 필드에
      `FIELD_UNCOMPARED <name>`으로 실패시킨다.
    - 필드 중 하나에 대한 비교를 규칙이 정하지 않은 case 파일은 파일 전체가 실패한다.
  - **Results.**
    - runner는 case마다 한 줄을 `RECIPE_RESULTS`가 가리키는 결과 파일에 쓴다: `CASE <file> <id> PASS` 또는
      `CASE <file> <id> FAIL <reason>`.
    - case가 실패하면 0이 아닌 코드로 종료한다.
    - `make recipe-check`는 성공 여부를 종료 상태와 그 파일의 줄에서 얻는다. 줄이 없는 case는 실패하며, 다른 출력은 결과를
      제공하지 않는다.
    - 언어가 파일의 case id를 빠뜨리거나, 파일이 가지지 않은 id를 출력하면 check가 실패한다. `only`를 가진 case는 그것이
      가리키는 언어에서만 센다.
  - **Native tests.** native test는 case 파일을 실행하지 않는, 한 언어의 test tree에 있는 테스트다. 한 언어를 가리키는
    `only`를 가진 unit이나 member, 또는 `cases: none`인 concern에 대해서만 존재한다. 두 언어가 가진 동작은
    `only: {languages, rule, quote}`(HYR-6)를 가진 case이며, 다른 runner는 그 case를 빼고 실행한다. check는 각 언어의 case
    id를 `only`가 없는 case와 `only`가 그 언어를 가리키는 case에서 얻는다.
    - spec은 각 native test를 그 unit, member 또는 concern 아래에 `<test file>::<test name>: <reason>` 형식으로 적는다.
    - HYR-8은 언어마다 그 언어의 파서로 test tree의 모든 test를 나열한다. runner도 spec의 이름도 아닌 test, 빠진 이름 붙은
      test, 빈 reason, 그리고 `only`가 정확히 한 언어를 가리키지 않는 unit이나 member 또는 case가 있는 concern 아래에 적힌
      native test는 실패시킨다.
    - 따라서 둘 이상의 언어가 가진 동작은 case 파일로만 테스트되며, 그런 동작의 native test는 그 case를 추가하는 commit에서
      제거한다.

- **HYR-8 The check.** `make recipe-check`는 `contracts/interfaces.json`을 읽고, source의 모든 unit과 member를 언어마다
  그 언어의 파서로 읽는다.
  - PHP:
    - 자동 로드된 package에 대해 모든 visibility를 대상으로 하는 `ReflectionClass`, `ReflectionMethod`,
      `ReflectionProperty`, `ReflectionClassConstant`;
    - `@internal`을 위한 `getDocComment()`;
    - trait method를 위한 `getDeclaringClass()`.
  - Node: 모든 선언, 그 modifier, export, JSDoc tag를 대상으로 하는 TypeScript compiler API.
  - Python: 모든 `def`, 모든 `class`, 모든 `type` 문(`ast.TypeAlias`), 모든 class 수준 annotated attribute, 모든 module 수준
    대입을 대상으로 하는 `ast`. private인 것도 포함한다. Python의 type alias는 `type`으로 쓰며, module 수준 대입은
    constant다.

  check는 spec과 source의 정렬된 key를 필드 단위로 정확히 비교한다. 다음의 경우 실패한다.
  - 어떤 unit도 이름 붙이지 않은 파일, 또는 이름 붙었으나 없는 파일;
  - HYR-3 또는 HYR-4에 어긋나는 unit;
  - 빠지거나, 추가되거나, 옮겨지거나, 타입이 바뀌거나, 다른 visibility를 가진 member 또는 type;
  - HYR-5에 어긋나는 constant;
  - HYR-6에 어긋나는 `only`;
  - HYR-2에 어긋나는 규칙이나 case 참조, 또는 `outside` 항목;
  - re-export가 spec의 public member 및 public type과 다른 barrel 파일;
  - HYR-7에 어긋나는 결과, case reader 또는 native test.

  실행할 때마다 먼저 reader의 mutation case를 실행하며, reader가 mutation을 통과시키면 실패한다.

- **HYR-9 Analyzers.** 각 언어는 자기 analyzer도 실행한다: `make analyse-php`, `make typecheck`, `make hyper-lint`.

- **HYR-10 Update.**
  - `make recipe-candidates`는 spec의 schema로 `var/` 아래에 candidate를 쓴다. reader가 native 필드인 `symbol`,
    `signature`, `declaration`, `kind`, `visibility`를 채운다.
  - 다음 필드는 검토된 spec 변경에서 손으로 쓴다:
    - 중립 필드 `inputs`, `output`, `errors`, `state`와 type의 `shape`;
    - concern 필드 `rules`와 `cases`;
    - unit 묶음;
    - `only`.
  - candidate는 이 필드들 각각을 손으로 쓴 것으로 표시한다.
  - spec의 변경은 candidate와 spec의 필드 단위 diff로 쓴다. 그다음 source가 그것을 따른다.

## 첫 정렬 (H28.11)

첫 spec은 다음 결정을 순서대로 적용한 HYR-10의 candidate다. 아래 목록이 정하지 않는 결정은 그 이유와 함께 item에 적는다.

1. **같은 개념, 다른 이름.** `protocol.md`의 규칙이 쓰는 이름을 쓴다. 그렇지 않으면 두 언어가 공유하는 이름을 쓴다.
   그렇지도 않으면 item이 결정하고 그 결정을 나열한다.
2. **두 언어에 있는 member.** 규칙이 차이를 만들지 않는 한 셋째 언어가 그 member를 추가한다(HYR-6).
3. **한 언어에만 있는 member.** 다음 중 하나가 성립하지 않는 한 호출자에 접어 넣고 제거한다.
   - 규칙이 그 언어에 한정하는 member다(HYR-6);
   - HY-106의 public API이며, 다른 언어가 그때 추가한다.
4. **한 언어에만 있는 unit.** 규칙과 함께 `only`를 가지거나, 다른 언어가 추가한다.
5. **다른 parameter.** 규칙의 parameter를 쓴다. 그렇지 않으면 두 언어의 parameter를 쓴다. 규칙이 정하는 실행 형식의 차이,
   예를 들어 Node handler의 context 인자(HY-105, HY-106)는 그 규칙과 함께 `only`다. 어떤 규칙도 정하지 않는 차이,
   예를 들어 Node request 경로의 abort signal은 남기 전에 규칙이 필요하다. 그 밖에는 정렬한다.
6. **접어 넣은 helper.** 접어 넣은 함수는 한 unit의 member다. 자기 파일만 쓰면 `private`이다. 다른 파일이 쓰면
   `internal`이며(Node와 PHP에서는 `@internal`과 함께 export, Python에서는 `_`), 그 파일은 그 unit을 통해 호출한다.
7. **파일.** "Concerns and units" 절의 unit을 쓴다. 이 절은 HYR-3, HYR-4, HYR-6에 따라 그것을 정한다. 이 규칙들과
   다르면 규칙이 우선하며, item이 결정을 나열한다.
8. **테스트.** 둘 이상의 언어가 가진 동작의 native test는 그 concern의 case 파일의 case가 되거나, case가 이미 그것을
   적으면 제거된다. 이는 그 concern을 옮기는 commit에서 한다.

## H28.11이 protocol.md에 먼저 쓰는 규칙

이 규칙들은 서버가 가지고 있지만 어떤 규칙도 적지 않은 동작을 정한다. 이 규칙들은 spec보다 먼저 쓴다.

1. **요청의 cookie.** 새 규칙 HY-129(가장 높은 HY id에 1을 더한 번호)는 모든 서버가 구현하는 `Cookie` 헤더의 parse
   하나를 정한다. PHP 서버는 헤더를 `$_COOKIE`가 아니라 `$_SERVER['HTTP_COOKIE']`에서 읽는다.
   - 원인: PHP 8.5.10 CGI SAPI(`HTTP_COOKIE`를 가진 `php-cgi`)를 측정한 결과, PHP는 `.`이나 공백이 든 이름을 바꾸고
     (`a.b=1`은 `a_b`가 된다), `[`가 든 이름을 배열로 만들고(`a[x]=1`), `=`가 없는 pair를 빈 값으로 남기고, 이름을
     디코드하지 않으며, 값의 `+`를 그대로 둔다. 이 형태들은 다른 어떤 runtime에도 없는 PHP 변수 이름에서 온다. 지금
     Node와 Python은 PHP와 서로 다르다. Node는 앞의 모든 공백을 제거하고 `+`를 공백으로 디코드하며, Python은 공백만
     제거한다.
   - 규칙은 다음과 같다.
     - 헤더는 받은 field 값의 바이트 그대로다. 클라이언트는 `Cookie` 줄 하나를 보내며(RFC 6265 section 5.4), HTTP/2에서
       서버는 cookie 줄을 `; `로 잇는다(RFC 9113 section 8.2.3). 줄을 떨어뜨려 받는 host는 parse 전에 `; `로 잇는다.
       Node는 `node:http`의 `cookie`를 쓰며, 이것은 `; `로 잇는다. Python `server.py`는 첫 줄만이 아니라 모든 `Cookie`
       줄을 읽는다. `asgi.py`는 scope의 `cookie` 헤더들을 `; `로 잇고, 다른 헤더처럼 `, `로 잇지 않는다.
     - 이미 이어진 헤더를 받는 host는 그것을 주어진 그대로 받는다. PHP는 SAPI에서 `HTTP_COOKIE`를 받고, `wsgi.py`는
       `HTTP_COOKIE`를 받아 Latin-1로 인코딩해 바이트로 되돌린다. PHP 내장 서버는 여러 HTTP/1.1 `Cookie` 줄을 `, `로
       잇는다(PHP 8.5.10 측정: `a=1`과 `b=2` 두 줄은 `a=1, b=2`가 된다). 이들을 그렇게 잇는 WSGI 서버도 같다. 이런 요청은
       RFC 6265 section 5.4를 어기며, 서버는 주어진 값을 parse하고, 규칙은 이 차이를 숨기지 않고 적는다.
     - 헤더는 각 `;`에서 pair로 나뉜다. pair 양 끝의 공백과 탭은 제거한다. pair는 첫 `=`에서 이름과 값으로 나뉜다.
     - pair는 다음 경우에 cookie를 만들지 않는다. `=`가 없을 때, 이름이 비었을 때, 이름이 유효한 UTF-8이 아닐 때, 또는
       percent-decode한 뒤의 값이 유효한 UTF-8이 아닐 때. 이름은 디코드하지 않는다. 값은 percent-decode한다. 16진수 두 자리가
       붙은 `%`는 그 두 자리의 바이트이며, `+`를 포함한 그 밖의 모든 바이트는 그 자체다.
     - cookie를 만드는 pair 중에서는 같은 이름의 첫 번째가 채택된다.
   - PHP session은 이 parse에서 식별자를 읽는다. native session 옵션은 `session.use_cookies`를 false로 설정하므로 PHP는
     session cookie를 읽지도 보내지도 않는다. parse가 HY-45의 식별자를 주면 서버는 `session_start()` 전에 `session_id()`로
     그것을 넘긴다. 그렇지 않으면 식별자 없이 session을 시작한다. 서버는 HY-45의 session cookie를 직접 보낸다. PHP 서버의
     어떤 부분도 `$_COOKIE`를 읽지 않는다. 지금 `NativeSession.php`는 `$_COOKIE[$name]`을 읽고 `Request.php`는 `$_COOKIE`로
     cookie를 만들며, 이는 한 헤더를 두 번 parse하게 한다.
   - `contracts/cookies.json`은 이 각 항목의 case를 하나씩 가지며, case reader는 각 case의 cookie를 정확히 비교한다.
   - cookies unit은 세 서버 모두에 있으며 `only`가 없다.
2. **public session store.** HY-106은 "the session stores of HY-104"라고 쓰고, 애플리케이션이 쓰는 HY-115의 Redis store를
   빠뜨린다. 이 문장은 "the session stores of HY-104 and HY-115"로 고친다.

## H28.11의 작업 순서

H28.11은 H28.2, H28.3, H28.4, H28.7, 그리고 이 branch가 가진 H28.10의 서버 commit과 함께 한 번의 통합으로 main에 올라간다.
main은 HY-116부터 HY-128까지를 적고 `contracts/context.json`과 `contracts/representations.json`을 가지지만, main의 어떤
서버도 이를 구현하지 않으므로, 그 item들이 올라가기 전에는 main에서 `make recipe-check`가 통과할 수 없다(HYR-2, HYR-7).
마지막 단계까지 이 branch에서 `make recipe-check`는 실패하며, 각 단계는 자기 item의 check를 GREEN으로 유지한다.

1. 이 규칙들을 감사한다(같은 고정 범위). 핵심 발견 사항이 열려 있지 않을 때까지 반복한다.
2. protocol.md의 위 규칙을 case와 함께 쓰고, 세 서버에서 RED와 GREEN을 거친다.
3. reader, mutation case, schema, check를 쓴다. check가 존재하기 전에 RED를 확인한다.
4. 첫 정렬에 따라 candidate로부터 spec을 쓰고 diff를 검토한다. spec은 H28.7이 쓰는 unit을 가진 representation concern을
   포함하여 각 concern의 `rules`, `cases`, `only` 문장 전체를 채우며, check는 HYR-2의 coverage와 HYR-6의 quote를 검증한다.
5. 각 언어의 case reader와 runner를 결과 파일과 함께 추가한다.
6. 세 언어의 source를 spec에 맞춘다. concern마다 한 commit으로 하며, 각 commit은 그 concern의 case를 추가하고 HYR-7이
   허용하지 않는 native test를 제거하고, 자기 owner test가 GREEN이다.
7. representation concern의 unit으로 세 서버에 H28.7을 쓴다. `contracts/representations.json`과 `contracts/client.json`의
   case와 함께, `make recipe-check`가 통과할 때까지 한다.
8. branch를 한 번의 통합으로 main에 올린다. H28.2, H28.3, H28.4, H28.7, H28.11은 이와 함께 완료되며, H28.10은 build와
   browser 부분까지 끝나야 완료된다.

## Concern과 unit

표기:
- `(pub)`는 HY-106 또는 HY-100이 public으로 만드는 Python module을 표시한다. 그 밖의 모든 Python module은 앞에 `_`가 있다.
- `only <languages>: <rule> "<quote>"`는 그 언어들에만 있는 unit을 표시한다(HYR-6).
- 화살표(`←`)는 unit이 나온 현재 파일을 가리킨다.
- **Open**은 첫 정렬이 정하고 item이 나열하는 결정을 표시한다.

### 애플리케이션과 파이프라인

1. **app**
   - app: `App.php` / `app.ts` / `app.py` (pub).
     - public member: open, bind, handle. PHP의 run과 Node의 server 및 listener는 `only` HY-100 "PHP through a front
       controller that calls `App::run`"과 "Node through the `node:http` request listener of `App.listener`,
       which `App.server` installs"다.
     - Node의 `open-checks.ts`는 `app.ts`로 다시 접어 넣는다. PHP와 Python이 open check를 App에 두는 것과 같다.
2. **media selection** (HY-116, HY-119, HY-62)
   - media selection: `MediaSelection.php` (← App.php negotiate) / `media-selection.ts` (← negotiate.ts) /
     `_media_selection.py` (← _media.py).
3. **accept**
   - accept: `Accept.php` / `accept.ts` / `_accept.py`.
4. **media type** (HY-106)
   - media type: `MediaType.php` / `media-type.ts` / `media_type.py` (pub).
5. **build** (HY-48, HY-125)
   - build: `Build.php` / `build.ts` / `_build.py`.
6. **context** (HY-124부터 HY-128까지)
   - context: `Context.php` / `context.ts` / `_context.py`.
7. **warnings guard** (HY-74)
   - warnings guard: `WarningsGuard.php` (← the error handler of App) / `warnings-guard.ts` (← warnings.ts) /
     `_warnings_guard.py`.
8. **host** (HY-97, HY-99, HY-100)
   - delivery: `Delivery.php` / — / —. `only php`: HY-100 "PHP through a front controller that calls `App::run` under
     a SAPI".
   - server: — / `server.ts` (← http.ts) / `server.py` (pub). `only node, python`: HY-100 "the `http.server` server of
     `create_server`, and Node through the `node:http` request listener".
   - pipeline: — / — / `_pipeline.py`. `only python`: HY-100 "Python through the WSGI callable of `create_wsgi`, the
     ASGI callable of `create_asgi` or the `http.server` server of `create_server`". 이것은 그 세 host의 pipeline 하나다.
   - wsgi: — / — / `wsgi.py` (pub). `only python`: HY-100, 같은 문장.
   - asgi: — / — / `asgi.py` (pub). `only python`: HY-100, 같은 문장.

### Request, reply and response

9. **request**
   - request: `Request.php` / `request.ts` / `request.py` (pub).
10. **reply**
    - reply: `Reply.php` / `reply.ts` / `reply.py` (pub).
11. **response**
    - response: `Response.php` / `response.ts` / `response.py` (pub).
12. **result** (HY-25, HY-50, HY-51, HY-58)
    - result: `Result.php` / `result.ts` / `result.py` (pub).
    - redirect: `Redirect.php` / `redirect.ts` (← result.ts) / `redirect.py` (pub, ← result.py).
    - not found: `NotFound.php` / `not-found.ts` (← result.ts) / `not_found.py` (pub, ← result.py).
    - forbidden: `Forbidden.php` / `forbidden.ts` (← result.ts) / `forbidden.py` (pub, ← result.py).
    - bad request: `BadRequest.php` / `bad-request.ts` (← result.ts) / `bad_request.py` (pub, ← result.py).
13. **form values** (HY-56, HY-57, HY-113)
    - fields: `Fields.php` / `fields.ts` (← form.ts) / `_fields.py`.
    - files: `Files.php` / `files.ts` (← form.ts) / `_files.py` (← _fields.py).
    - multipart: `Multipart.php` / `multipart.ts` (← form.ts) / `_multipart.py` (← _fields.py).
    - named values: `NamedValues.php` (trait) / `named-values.ts` / `_named_values.py`. Node과 Python은 PHP가 trait에 두는
      공유 부분을 받는다. Node와 Python에서 kind는 `class`이며, fields와 files의 base다.
    - uploaded file: `UploadedFile.php` / `uploaded-file.ts` / `uploaded_file.py` (pub).
14. **cookies**
    - cookies: `Cookies.php` (← Request.php `$_COOKIE`) / `cookies.ts` (← form.ts parseCookies) / `_cookies.py` (←
      _pipeline.cookie_values). 세 서버 모두 HY-129에 따라 헤더를 parse한다("The rules that H28.11 writes in
      protocol.md first", item 1).
15. **container** (HY-105)
    - container: `Container.php` / `container.ts` (← services.ts) / `container.py` (pub).

### Session

16. **session store** (HY-104)
    - session store: `SessionStore.php` (interface) / `session-store.ts` (← session.ts) / `session_store.py`
      (pub, ← session.py).
    - array session: `ArraySession.php` (`@internal`) / `array-session.ts` (`@internal`, ← session.ts
      MemorySessionStore) / `_array_session.py` (← session.py). 어떤 규칙도 메모리 store를 이름 붙이지 않으며, 메모리
      store는 HY-104가 요구하는 대로 process와 서버 사이에서 session을 공유할 수 없으므로 HY-106에 따라 internal이다.
      이것은 테스트의 store다. barrel은 현재 이것을 HY-106에 어긋나게 export한다(Python `__init__.py`의 `ArraySession`,
      Node `index.ts`의 `MemorySessionStore`). 이 export들은 이 concern의 정렬에서 제거하며, 어떤 consumer도 이를
      import하지 않는다.
17. **session** (HY-96, HY-120)
    - session: `Session.php` / `session.ts` / `_session.py`.
    - flash: `Flash.php` / `flash.ts` (← session.ts `export interface Flash`) / `_flash.py` (← _session.py).
    - 둘 다 internal이다. HY-106은 session 값과 flash를 이름 붙이지 않으며, "Every other symbol that a package declares
      is internal"이다. PHP와 Node는 이들에 `@internal`을 붙인다.
18. **csrf**
    - csrf: `Csrf.php` / `csrf.ts` / `_csrf.py`. member는 masked, mask, verify이며, PHP와 Python이 공유하는 이름이다
      (정렬 규칙 1). Node의 `maskedToken`, `maskToken`, `verifyToken`은 이 이름으로 바꾼다.
19. **native sessions** (HY-104, HY-115)
    - native session: `NativeSession.php` / — / —. `only php`: HY-104, native session handler의 문장.
    - redis cluster sessions: `RedisClusterSessions.php` / — / —. `only php`: HY-115.
    - redis sentinel sessions: `RedisSentinelSessions.php` / — / —. `only php`: HY-115.
    - session record: — / `session-record.ts` (`@internal`) / `_session_record.py`. `only node, python`: HY-104, 문장
      "The PHP server keeps a session with the native session handler of PHP, with `serialize_handler` set to
      `php_serialize` by its session options.". 어떤 규칙도 record를 public으로 만들지 않으므로 internal이다.
    - file sessions: — / `file-sessions.ts` / `file_sessions.py` (pub, HY-104의 session store). `only node,
      python`: HY-104, 같은 문장.
    - redis sessions: — / `redis-sessions.ts` / `redis_sessions.py` (pub, 고쳐진 HY-106에 따른 HY-115의 session store).
      `only node, python`: PHP에 native Redis handler를 주는 HY-115 문장을 전체 그대로 옮긴 것.
    - flock: — / `flock.ts` / —. `only node`: HY-104 "The Node server calls `flock` through `node:ffi` with
      `LOCK_NB` and tries again after a pause of at most 50 ms, because a call that blocks would stop its event
      loop.". Python은 표준 라이브러리의 `fcntl.flock`을 호출하므로 binding이 없다.
    - 모든 quote는 규칙의 문장 전체 하나다(HYR-6). spec은 각 quote를 정확히 복사하며, check는 그것을 protocol.md와
      대조한다.
20. **error code**
    - unit이 없다. `error-code.ts`의 `errorCode`는 오류의 `code`를 읽는 Node.js 관용구이며, 어떤 규칙도 이것을 이름 붙이지
      않는다(HYR-6). 각 사용자(file-sessions.ts와 server.ts)는 Python이 `except FileNotFoundError`를 쓰듯 자기 코드에서
      code를 읽으며, `error-code.ts`는 제거한다.

### 데이터와 렌더

21. **data model**
    - data model: `DataModel.php` / `data-model.ts` (← values.ts) / `_data_model.py`.
22. **json codec**
    - json codec: `JsonCodec.php` (← JsonEncoder.php) / `json-codec.ts` (← json.ts) / `_json_codec.py`.
23. **kept**
    - kept: `Kept.php` / `kept.ts` / `_kept.py`.
24. **browser code concerns** (HY-54)
    - manifest: `Manifest.php` / — / `_manifest.py`.
    - region: `Region.php` / — / `_region.py`.
    - router: `Router.php` / — / `_router.py`.
    - reads: `Reads.php` / — / `_reads.py`.
    - renderer: `Renderer.php` / — / `_renderer.py`.
    - 각각은 `only php, python`이다: HY-54, Node 서버가 브라우저 코드로 렌더한다는 문장. 이들의 동작은 case 파일로 세 서버
      모두에서 검사된다.
25. **page**
    - page: `Page.php` (← App.php page) / `page.ts` / `_page.py` (← app.py page). page 조립, kept fallback을 가진
      document, loader map을 가진다.
26. **region planner**
    - region planner: `RegionPlanner.php` / `region-planner.ts` (← planner.ts) / `_region_planner.py` (← _planner.py).
27. **client rendering** (HY-34, HY-106)
    - client rendering: `ClientRendering.php` / `client-rendering.ts` (← app.ts) / `client_rendering.py` (pub, ←
      client.py).
    - choice: `Choice.php` / `choice.ts` (← app.ts `export interface Choice`) / `choice.py` (pub, ← client.py).

### Representations (wave 28)

28. **representations** (HY-2, HY-106, HY-118, HY-122)
    - representation entries: `RepresentationEntries.php` / `representation-entries.ts` /
      `_representation_entries.py`.
    - representation: `Representation.php` / `representation.ts` / `representation.py` (pub).
    - representation response: `RepresentationResponse.php` / `representation-response.ts` /
      `_representation_response.py`.

### Index

29. **index** (HY-106)
    - unit이 없다. `index.ts`와 `__init__.py`가 public member를 re-export하며, `py.typed`는 타입이 있는 package를
      표시한다. PHP는 namespace로 로드하므로 barrel이 없다(HYR-2).
