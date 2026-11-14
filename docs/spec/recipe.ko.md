<!-- doc-id: recipe -->
<!-- source-sha256: 8e396390d22b83feb99e93b96ee74cfd3cb204bed069df2f1fbe84c2b2a6079f -->
# 서버의 레시피

PHP, Node, Python 서버는 하나의 프로토콜(`contracts/protocol.json`)을 구현한다. 이 서버들의 레시피는 세 부분으로 이루어진다.

1. **개발 spec**, `contracts/interfaces.json`. 이 파일은 서버의 모든 concern, 각 concern의 unit과 파일, 그리고 그 unit들의
   모든 public, internal, private member를 정한다. 각 member는 언어 중립 설명과, 각 언어에서의 정확한 native symbol 및
   signature를 가진다.
2. **test recipe**, `contracts/` 아래의 case 파일. `contracts/interfaces.json`의 `runners`가 가리키는 각 runner가 자기를 가리키는
   section을 읽는다.
3. **각 언어 고유 analyzer의 check.**

`make recipe-check`는 1번과 2번 부분을 source와 test 실행 결과에 맞춰 검사한다.

## 규칙

- **HYR-1 One spec.** `contracts/interfaces.json`은 세 서버의 유일한 개발 spec이며, 이 spec의 schema는
  `scripts/schema/interfaces.schema.json`이다. 구조를 바꾸는 변경은 spec을 먼저 바꾼다. 그다음 세 언어의 파일이 같은
  변경에서 함께 바뀐다. spec을 쓰는 tool은 없다.
  이 spec은 HYR-7의 case 파일을 선언하는 `caseFiles`도 담는다.

- **HYR-2 Concerns.** concern은 다음 필드를 가진다.
  - `id`: kebab-case로 쓴 단어들.
  - `rules`: concern이 구현하는 HY- 및 HYC- 규칙 id. 모든 id는 `contracts/protocol.json`에 적혀 있다. `contracts/protocol.json`의
    모든 HY- 규칙은 concern이 이름으로 가리키거나, spec의 `outside` 필드(`{rule, reason}`의 목록)가 가리킨다. 예를 들어 브라우저 코드에만
    해당하는 규칙이 그러하다. concern이 가리키는 `outside`의 규칙이거나 reason이 빈 `outside` 항목이면 HYR-8에 실패한다.
  - `cases`: concern의 동작을 적는 `contracts/` 아래의 case 파일. unit이 없는 concern, 또는 모든 unit이 한 언어를 가리키는
    `only`를 가진 concern만 `none`을 가질 수 있으며, 이때 reason과 HYR-7의 native test를 함께 적는다. 그 밖의 concern이
    `none`이면 check가 실패시킨다. 빈 목록은 `none`처럼 실패한다.
  - `group`: unit의 파일을 담는 디렉터리를 정하는 HYR-4의 group. unit이 있는 concern은 `groups`의 group 하나를 적고,
    unit이 없는 concern은 적지 않는다.
  - `units`: concern의 unit들.

  `packages/php/src`, `packages/ts/src`, `packages/python/src/polyspec/hyper` 아래의 `git ls-files`
  파일은 모두 정확히 하나의 concern에 속하며, 이름이 적힌 파일은 모두 존재한다. unit의 파일은 정확히 하나의 unit을 가진다
  (HYR-3). barrel 파일(`index.ts`와 package의 `__init__.py`), `py.typed`, 그리고 Python의 각 group 디렉터리의
  `__init__.py`(HYR-4)는 `index` concern에 속하며 unit을 가지지 않는다. barrel 파일은 HY-106의 public member와 public
  type을 re-export하는 내용만 가지며, HYR-8은 unit 검사 대신 이 목록을 검사한다.

- **HYR-3 One unit per file.** unit은 다음 필드를 가진다.
  - `id`: 단어들;
  - 각 언어의 `kind`: `class`, `interface`, `trait`(PHP) 중 하나, 또는 module 함수들의 묶음인 `functions`;
  - 각 언어의 파일.

  모든 언어에서 파일은 정확히 하나의 unit을 가진다.
  - PHP의 `functions` unit은 생성자가 없고 다른 class를 확장하지 않으며 abstract가 아닌 static method들의 class
    하나다. 다른 class를 확장하거나 abstract인 class는 instance를 가지기 때문이다.
  - Node의 `functions` unit은 export한 함수마다 JSDoc tag `@internal`이 있을 때 internal이다.
  - 일부 언어에만 있는 unit은 `only`를 가진다(HYR-6).
  - concern의 각 class, interface, trait은 자기 unit이며, Python의 각 class도 `Protocol`과 `TypedDict`를 포함하여 자기
    unit이다. Node의 `interface`는 다른 언어가 같은 단어의 unit을 가지면 kind `interface`의 unit이고, 그렇지 않으면 HYR-5의
    type이다. check는 unit의 단어와 같은 단어를 가진 type을 실패시킨다. 예: Result와 그 네 개의 stop, Session과 Flash,
    ClientRendering과 Choice, SessionStore와 ArraySession.

- **HYR-4 Files and directories.** unit의 파일은 unit의 단어들을, 그 concern의 group 디렉터리 안에, 각각 그 언어의
  규칙으로 쓴 이름이다.
  - Groups. spec의 `groups`는 group을 열 개 이하로 적으며, 각 group은 kebab-case id이고, 모든 group은 어떤 concern이
    가리킨다(HYR-2). group은 source의 디렉터리이며 public 이름의 일부가 아니다(HY-106.18).
    - `app`은 애플리케이션과 그것을 여는 데 쓰는 것을 담는다: build id, container, context handler, warnings guard,
      public member의 인자 수 세기.
    - `host`는 애플리케이션을 그 런타임의 서버에 연결하는 진입점을 담는다(HY-100).
    - `http`는 요청, reply, 응답, 요청의 cookie를 담는다.
    - `result`는 handler의 result와 그 stop을 담는다.
    - `form`은 요청 body의 form 값과 파일을 담는다.
    - `session`은 session, 그 flash와 CSRF token, session store interface, session store를 담는다.
    - `data`는 data model, JSON codec, kept 값을 담는다.
    - `page`는 page를 rendering하는 것을 담는다: region과 route를 가진 manifest, server program, region plan, client
      rendering.
    - `representation`은 route의 representation과, `Accept` header로 그 하나를 고르는 선택을 담는다.
  - PHP: PascalCase, `src/<Group>/<Words>.php`, namespace `Polyspec\Hyper`에 속한다.
    `packages/php/composer.json`의 `autoload.psr-4`는 `Polyspec\Hyper\`를 PHP unit이 있는 group 디렉터리의
    목록에 연결하고, root `composer.json`도 같은 디렉터리를 연결한다.
  - Node: kebab-case, `src/<group>/<words>.ts`. barrel은 `src/index.ts`다.
  - Python: snake_case, package `polyspec/hyper/<group>/` 안에 둔다.
    - `<words>.py`는 HY-106이 public으로 만드는 unit의 module이다.
    - `_<words>.py`는 internal module이다.
    - Python unit이 있는 각 group 디렉터리는 docstring만 있고 다른 문장이 없는 `__init__.py`를 가진다.
    - barrel은 `polyspec/hyper/__init__.py`다.
  - 단어 경계.
    - 단어 경계는 소문자 또는 숫자 뒤에 대문자가 오는 자리다.
    - 약어는 한 단어이며 단어로 쓴다: PascalCase `Csrf`, camelCase `csrf`, snake_case `csrf`. 따라서 spec의 어떤 이름도
      대문자를 연속해서 두 개 가지지 않으며, check는 그런 이름을 실패시킨다.
    - member 이름도 같은 경계를 따른다(HYR-5).
  - Test unit. HYR-7의 case runner와 case reader처럼 test tree에 있는 unit은 같은 단어로 그 언어의 test 디렉터리에 둔다:
    PHP `packages/php/tests/<Words>.php`(namespace `Polyspec\Hyper\Tests`), Node `packages/ts/tests/<words>.ts`,
    Python `packages/python/tests/<words>.py`. 어떤 test module도 HY-106의 public 또는 internal API가 아니므로 Python
    이름에 `_`를 붙이지 않는다. 각 언어의 case runner와 case reader는 `contracts/interfaces.json`의 `runners`와 `caseReaders` 항목이며,
    HYR-7이 정하는 대로다.

  예를 들어 group `representation`의 unit `media selection`은 `src/Representation/MediaSelection.php`,
  `src/representation/media-selection.ts`, `polyspec/hyper/representation/_media_selection.py`다.

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
    - Python의 class 수준 annotated attribute. 이름이 `_` 하나로 시작하면 internal이고, 이름이 `__`로 시작하고 `__`로
      끝나지 않으면 Python이 name mangling으로 표시하는 그 class의 private이며 member가 아니다.
    method 본문의 대입은 property가 아니다.
  - **Fields of a member.**
    - `id`: `<unit>.<member>`, 언어 중립 이름을 camelCase로 쓴다.
    - `kind`: constructor, method, static method, function, property 중 하나.
    - `visibility`: public, internal, private 중 하나.
    - `inputs`, `output`, `errors`: 어휘의 용어로 쓴다. 어휘는 `contracts/protocol.json`의 용어, spec의 unit과 type, 그리고 이들의
      `list<T>`, `map<T>`, `optional<T>`, `function(...) -> T`다. union 용어는 없고, Node의 `Promise<T>`는 `T`이며, iterator 또는
      generator는 `list<T>`, callable은 `function(...) -> T`다. 이 밖의 용어는 HYR-8에 실패한다. error는
      `contracts/protocol.json`의 statement가 이름을 붙이는 status 또는 spec의 error unit이다.
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
    - PHP class의 member `invoke`는 그 object를 호출할 수 있게 하는 method `__invoke`이다.
    - Python class의 member `iter`는 그 object를 순회할 수 있게 하는 method `__iter__`이다.
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
      - Python: 앞에 `_`가 있고 spec이 `private`으로 선언한다. 이름이 `__`로 시작하고 `__`로 끝나지 않는
        method는 실패한다. `__`로 private을 표시하는 것은 property뿐이기 때문이다. `_`를 붙인 형태가 없는 constructor
        `__init__`은 spec이 private으로 선언하면 private이며, check는 package의 다른 파일이 그 class를 호출하면
        실패한다: import가 묶은 이름의 호출로, alias나 import한 module의 attribute를 거친 호출도 포함하며, 그 class의
        module에서, 또는 상대 import나 절대 import로 package에서 온 이름이다. spec이 internal로 선언한 constructor는 internal module에 있어야 한다. Python에는 접근 modifier가 없으므로 spec이 정하며, Python
        reader는 타입 추론 없이 이름으로 사용을 검사한다. 같은 package의 다른 파일에서 `private` member의 이름이 import
        이름, alias, 또는 attribute 이름(`ast.Attribute.attr`)으로 나타나면 실패시킨다. 따라서 private 이름은 package 안에서
        유일하며, 같은 이름은 spec과 source가 둘 중 하나의 이름을 바꿀 때까지 실패한다.
    - PHP와 Node reader는 private을 modifier에서 읽으며, modifier가 중립 `visibility`와 다른 member는 check가 실패시킨다.
  - **Stated members.** 둘 이상의 언어가 가지는 모든 member는 말해진다.
    - public member는 직접 말해진다: 그 member를 가지는 언어마다, `runners`가 그 언어를 가리키는 `caseFiles`의 section
      하나가 `members`에 그것을 적고, 그 언어의 step이 그것을 호출한다(HYR-7).
    - 한 언어만 가지는 member는 section이 그것을 적거나 HYR-7의 native test가 그 아래에 적혀 있으면 그 언어에서 직접
      말해진다.
    - internal member는 public member처럼 직접 말해지거나, 호출자를 통해 말해진다: 그 member를 가지는 언어마다 직접 말해진
      member 하나가 소스의 호출로 그것에 닿고, 그것에 닿는 직접 말해진 member들이 그 member를 가지는 모든 언어에서 같다.
      두 언어는 둘 다 가지는 member에 대해서만 비교한다.
    - private member는 같은 두 조건으로 호출자를 통해 말해진다.
    - check는 소스의 호출을 member 이름과 그 receiver의 class로 읽으며, 그 class를 적힌 것에서만 얻는다:
      - `this`, `self`, `cls`, `$this`는 그 함수의 class를 가지고, `super`와 `parent`는 그것이 상속하는 class를 가진다.
      - class 이름, import한 module 뒤에 쓴 class, class의 `new`는 그 class를 가진다. TypeScript와 PHP의 interface와
        Python의 protocol은 class이고, 그것을 구현하는 class는 그것을 상속한다.
      - parameter, property, 변수는 적힌 타입의 class를 가진다: PHP의 타입 선언, TypeScript와 Python의 타입
        annotation이며, `?`, `| null`, `Optional` 안의 것도 같다.
      - class의 `new`, class가 알려진 호출, 또는 그런 값들의 조건식(`??`, `?:`, `||`, `or`, `a if c else b`, PHP의
        `match`)이 대입된 변수나 property는 그 class를 가진다. TypeScript의 object pattern이 묶는 이름,
        `const { a } = value`는 그 이름의 property를 읽는 것이다. 호출이 없는 PHP의 읽기, `$this->a`는 property에만
        닿는다. PHP는 property와 method를 따로 두기 때문이다. constructor를 쓰지 않고 property를 초기화하는
        TypeScript class는 그것이 상속하는 class의 constructor를 호출하는 constructor를 가진다.
      - receiver의 class가 알려진 호출이나 property 읽기는 spec의 member이고, 그 값은 그 member의 `output`이 가리키는
        class를 가진다. 그런 값을 도는 loop의 변수는 `list`나 `map` 안의 class를 가진다. spec의 member가 아닌 함수나
        method의 호출은 그 적힌 반환 타입의 class를 가진다.
      - 적힌 타입이 class의 목록(`X[]`, `Array<X>`, `list[X]`, `Sequence[X]` 등)인 parameter나 property를 도는 loop의
        변수는 그 class를 가진다. PHP의 parameter는 그 함수의 doc comment에 있는 `@param list<X>`, `array<K, X>`,
        `X[]`가 그 목록이다.
      - class의 member는 그것이 상속하는 가장 가까운 class의 그 이름의 member이기도 하며, class에 대한 호출은 그것을
        상속하는 unit들의 그 이름의 member에도 닿는다.
      - property에 대한 대입은 호출이 아니다. PHP에서 `(`가 뒤따르는 이름은 method이고 그 밖의 이름은 property다.
      - 그 밖의 receiver는 class가 없고, 그 뒤의 이름은 호출이 아니다. 그래서 check는 PHP 배열의 원소나 어떤 member도
        돌려주지 않은 목록의 원소를 통한 호출, generator의 변수를 통한 호출, compiler만 추론하는 타입의 값을 통한 호출,
        실행 중에 계산되는 이름을 통한 호출을 읽지 않는다. 소스가 그렇게만 호출하는 member는 닿지 않는 것으로
        보고되며, 그 고침은 그 자리에 타입을 적거나 그 member를 적는 section이다.
    - check는 어떤 언어에 대해 직접 말해지지 않은 public member, 어느 section도 적지 않고 직접 말해진 member가 닿지도
      않는 internal member, 아무것도 닿지 않는 private member, 닿는 member들이 두 언어 사이에서 다른 internal 또는
      private member를 실패시킨다. check는 세 수를 따로 센다: 직접 말해진 member, 호출자를 통해 말해진 internal member,
      호출자를 통해 말해진 private member.

- **HYR-6 Only some languages.** 일부 언어에만 있는 unit, member, type의 필드 또는 case는 `only: {languages, sentence}`를
  가진다.
  - `sentence`는 차이를 요구하는 `contracts/protocol.json`의 statement id 하나다;
  - `contracts/protocol.json`의 statement는 문장 하나다. 문장은 첫 단어부터, 공백이나 규칙의 끝이 뒤따르는 마침표까지다.
    `session.save_handler`나 `6.3.0`처럼 code span이나 식별자 안의 마침표는 문장을 끝내지 않는다. 예는 HY-54, HY-100,
    HY-104, HY-105, HY-106, HY-115에서 온다.

  `only`가 없는 언어에서 빠진 unit, member 또는 type의 필드는 결함이다. 어떤 규칙도 이름을 붙이지 않은 runtime 관용구, 예를 들어
  Node.js 오류의 `code`는 unit도 member도 아니다. 각 사용자는 그것을 자기 코드에 쓰며, 다른 언어가 자기 코드에 쓰는 것과 같다
  (Python의 `except FileNotFoundError`).

  Node 서버가 HY-54에 따라 브라우저 코드에서 가져오는 concern(manifest, region, router, reads, renderer)은 HY-54 문장과
  함께 `only` PHP와 Python인 unit이다. 이들의 동작은 case 파일을 통해(HYR-7) 세 서버에서 같다.
  일부 언어만 읽거나 비교하는 case 필드도 같은 방식으로 `only`를 가지며, `browser`는 브라우저 패키지를 가리키는 언어
  이름이다.

- **HYR-7 Test recipe.**
  - **Runners.** 서버 언어마다 정확히 하나의 case runner가 있으며, 그 이름은 `contracts/interfaces.json`의 `runners`가 정한다.
    이 runner는 `contracts/` 아래 모든 case 파일의 section 가운데 `caseFiles`의 `runners`가 그 언어를 가리키는 section을 실행한다.
    `runners`는 `php`, `node`, `python`, `browser`, `build` 각각의 runner를 적는다. `browser`와 `build`는 section을
    `caseReaders.node`를 통해 읽으며, check는 다섯 runner의 결과를 모두 센다.
    `runners`는 `php`, `node`, `python`에 대해 step의 디렉터리(`steps`)와 runner의 registry(`registry`), 곧 각 section을
    그 step에 대응시키는 파일도 적는다.
  - **S-3b case 변경의 고정 사본.** S-3b 변경이 host 코드가 아직 실행하지 않는 형태로 바꾼 section은 `runners`에 `php`,
    `node`, `python`이 없고, `fixedCopy`가 `tests/legacy`의 `<name>-before-s3b.json`을 가리킨다. 그 파일은 그 변경 전의
    section과 그것이 쓰는 fixture를 담으며, 그 선언은 `tests/legacy/interfaces.json`에 있다. host runner는 그 사본을 읽는다.
    runner가 없는 section은 `fixedCopy`를 가지며, check는 그 section을 담은 파일의 고정 사본이 아닌 `fixedCopy`를
    실패시킨다. 고정 사본의 step은 그 live 파일의 step이고, 그 sentence는 S-3b가 폐기한 statement를 가리킬 수 있으며,
    어느 runner도 읽지 않는 live section은 사본을 통해 member를 밝힌다. section의 규칙을 core로 옮기는 commit(C-7)이
    그 runner를 되돌리고 사본에서 section을 지운다.
  - **Steps.** 한 언어에서 section의 step은 그 언어의 `steps` 디렉터리 아래, case 파일의 words와 section의 이름이 정하는
    자리에 있는 함수 하나다: PHP는 `<Words>Steps.php`의 class `<Words>Steps`의 static method `<section>`, Node는
    `<words>.ts`가 export하는 객체 `steps`의 property `<section>`, Python은 `<words>_steps.py`의 snake_case 함수
    `<section>`이다. 한 언어의 registry는 `runners`가 그 언어를 가리키는 section 각각을 그 함수에 대응시키고 다른 항목을
    가지지 않는다. check는 그 자리에 step이 없는 section과, 빠졌거나 다른 함수를 가리키거나 `caseFiles`가 그 언어에 주지
    않은 section을 가리키는 registry 항목을 실패시킨다.
    - step은 검사 대상 코드로 입력을 준비하지 않고 관찰한 값을 쓰지도 않는다: case의 JSON 텍스트는 자기 test tree의
      reader로 읽으며(PHP `Support\Json`, Node `case-rules.ts`의 `parsed`, Python `steps/recorded.py`의 `decoded`),
      `members`에 JSON codec의 member를 적은 section만 codec을 호출한다. check는 자기 section이 적지 않은 unit
      `json-codec` 또는 `outside-number`의 member에 닿는 step을 실패시킨다.
  - **Reading a case.** runner는 각 case를 그 언어의 case reader를 통해서만 읽는다. case reader는 모든 언어에서 같은
    member를 가진 test tree의 unit 하나다: public member `cases`, `section`, `id`, `has`, `input`, `compare`, `outcome`,
    `fail`, `line`과 private member `declaration`, `matches`, `equal`. `compare`는 필드를, `outcome`은 단계의 결과를
    비교한다.
    - `contracts/interfaces.json`의 `caseFiles`는 case 파일의 역할과 비교의 유일한 출처다(HYR-11). 파일마다 최상위 key(`fixtures`)를,
      case 배열(`sections`)마다 그 `runners`, case가 쓰는 fixture(`uses`), case가 결과를 말하는 member(`members`, 아래), 모든 필드와 그 역할, 그리고 각 expected 필드, 단계가 함께
      확인하는 각 input 필드, 단계의 각 결과에 대해 비교 방법, 그 `state`, 관찰된 동작을 적는 `sentence`를 적는다. check는 각
      `sentence`를 `only`(HYR-6)처럼 검증한다.
    - section의 `members`는 spec의 member id를 적는다. section은 자기 expected 필드나 outcome이 그 member가 돌려주는 값
      또는 그 member가 만든 변화를 비교할 때에만 그 member를 적으며, 호출이 거부되는지만 비교하는 section은 아무것도
      적지 않는다. 적힌 member마다 `runners`의 언어 하나가 그것을 가진다. 적힌 member를 가지는 각 runner 언어의 step은
      그것을 호출한다: step, 또는 step이 닿는 test tree의 함수가 constructor는 그 class의 `new`(Python은 class의 호출)를,
      static method나 module 함수는 class나 import 뒤의 그 이름을, 그 밖의 member는 객체 뒤의 그 이름을 쓴다. step은
      자기가 이름을 쓴 함수에, 그리고 자기가 만든 test tree의 class의 모든 method에 닿는다. check는 HYR-5가 소스를 읽듯이
      호출을 읽는다. 그래서 실행 중에 계산되는 이름은 호출이 아니고, 서버만 호출하는 member는 호출이 아니며, class
      자리에 쓴 객체는 그 constructor의 호출이 아니고, 적힌 class가 없는 receiver에 대한 호출은 호출이 아니다.
    - case reader는 case의 입력 필드와 쓰는 fixture를 runner에 넘기며, 각 expected 필드를 관찰된 값과 `caseFiles`가
      정한 비교로 직접 비교한다. runner는 비교하지 않는다.
    - 파일이 `caseFiles`가 선언하지 않은 key, section, 필드를 가지거나(`only`(HYR-6)와 `requirements`(HYR-11)는 뺀다), `fields`가 없고
      비교나 sentence가 없는 expected 필드를 가지면 reader는 첫 case 전에 그 파일을 `FILE_UNDECLARED <path>`로 실패시키고,
      runner는 그 파일의 case마다 `CASE <file> <id> FAIL FILE_UNDECLARED <path>`를 쓴다.
    - reader는 runner의 단계가 일으킨 오류에 `CASE_ERROR <message>`로, 그 runner에 대해 아무것도 비교하지 않는 case에
      `CASE_EMPTY`(HYR-11)로, 비교가 실패한 첫 expected 필드에 `FIELD_DIFFERS <name>`으로, case가 끝난 뒤 읽히지 않은 입력 필드나
      쓰는 fixture에 `FIELD_UNKNOWN <name>`으로, 비교되지 않은 expected 필드에 `FIELD_UNCOMPARED <name>`으로 case를 실패시킨다.
      실패한 case의 reason은 이 순서에서 첫 번째 것이다. 중첩된 필드는 `received.headers`처럼 점으로 이은 경로로 부른다.
    - case가 가지지 않은 필드의 `compare`는, `caseFiles`가 그 필드를 `optional`로 선언하지 않았으면, case를
      `CASE_ERROR the case has no field <name>`으로 실패시킨다.
    - case는 `only`(HYR-6)를 가질 수 있다. reader는 그것을 읽고, 그것이 가리키는 언어의 runner에만 그 case를 준다.
  - **Results.**
    - 모든 runner는 case마다 한 줄을 `RECIPE_RESULTS`가 가리키는 결과 파일에 쓴다: `CASE <file> <id> PASS` 또는
      `CASE <file> <id> FAIL <reason>`.
    - case가 실패하면 0이 아닌 코드로 종료한다.
    - `make recipe-check`는 성공 여부를 종료 상태와 그 파일의 줄에서 얻는다. 줄이 없는 case는 실패하며, 다른 출력은 결과를
      제공하지 않는다.
    - check는 각 runner의 case id를 `caseFiles`의 `runners`가 그 runner를 가리키는 section에서 얻으며, 그런 case
      id를 빠뜨리거나 그런 id가 아닌 id를 출력하는 runner가 있으면 실패한다. `only`를 가진 case는 그것이 가리키는 언어에서만 센다.
  - **Native tests.** native test는 case 파일을 실행하지 않는, 한 언어의 test tree에 있는 테스트다. 한 언어를 가리키는
    `only`를 가진 unit이나 member, 또는 `cases: none`인 concern에 대해서만 존재한다. 두 언어가 가진 동작은
    `only: {languages, sentence}`(HYR-6)를 가진 case이며, 다른 runner는 그 case를 빼고 실행한다. check는 각 언어의 case
    id를 `runners`가 그 언어를 가리키는 section의, `only`가 없는 case와 `only`가 그 언어를 가리키는 case에서 얻는다.
    - spec은 각 native test를 그 unit, member 또는 concern 아래에 `<test file>::<test name>: <reason>` 형식으로 적는다.
    - HYR-8은 언어마다 그 언어의 파서로 test tree의 모든 test를 나열한다. runner도 아니고 spec에 이름이 적히지도 않은 test, spec에 이름이 적혔으나 없는
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
  - 어떤 concern도 가리키지 않는 group, `group`에 어긋나는 concern, 문장을 가진 Python group `__init__.py`(HYR-4);
  - 빠지거나, 추가되거나, 옮겨지거나, 타입이 바뀌거나, 다른 visibility를 가진 member 또는 type;
  - HYR-5에 어긋나는 constant;
  - HYR-6, HYR-11 또는 HYR-2에 어긋나는 `only`, 필드 또는 결과의 `sentence`, 또는 case의 `requirements`;
  - HYR-2에 어긋나는 규칙이나 case 참조, 또는 `outside` 항목;
  - re-export가 spec의 public member 및 public type과 다른 barrel 파일;
  - `git ls-files contracts/*.json`의 파일 가운데 `interfaces.json`과 `protocol.json`이 아니며 `caseFiles` 항목이 없는 파일,
    그리고 어떤 파일도 가지지 않는 `caseFiles`의 항목, section 또는 필드;
  - HYR-7에 어긋나는 결과, case reader, step, registry, native test;
  - HYR-7에 어긋나는 section의 `members` 항목, 그리고 HYR-5에 따라 말해지지 않은 member.

  실행할 때마다 먼저 reader의 mutation case를 실행하며, reader가 mutation을 통과시키면 실패한다. 통과한 실행은 HYR-5의
  세 수를 출력한다.

- **HYR-9 Analyzers.** 각 언어는 자기 analyzer도 실행한다: `make analyse-php`, `make typecheck`, `make hyper-lint`.

- **HYR-10 Update.**
  - `make recipe-candidates`는 spec의 schema로 `var/` 아래에 candidate를 쓴다. reader가 native 필드인 `symbol`,
    `signature`, `declaration`, `kind`, `visibility`를 채운다.
  - 다음 필드는 검토된 spec 변경에서 손으로 쓴다:
    - 중립 필드 `inputs`, `output`, `errors`, `state`와 type의 `shape`;
    - concern 필드 `rules`와 `cases`;
    - `caseFiles`: 각 case 파일, 각 section의 `members`, 그 필드 각각의 비교 방법(HYR-11);
    - `steps`와 `registry`를 가진 `runners`;
    - unit 묶음;
    - `only`.
  - candidate는 이 필드들 각각을 손으로 쓴 것으로 표시한다.
  - spec의 변경은 candidate와 spec의 필드 단위 diff로 쓴다. 그다음 source가 그것을 따른다.

- **HYR-11 Case comparisons.** case 파일의 필드는 하나의 역할을 가진다: `id`, `label`, `input`, `expected` 또는 `response`.
  각 expected 필드와 단계의 각 결과는 `caseFiles`의 `compare`를 가지며, 그 값은 다음 아홉 종류 중 하나다:
  - `exact`: 관찰된 값이 expected 값과 JSON 값으로 같다. map은 같은 key와 같은 값을 임의의 순서로 가지면 같고, list는 같은
    순서의 같은 item을 가지면 같으며, null은 null하고만 같다;
  - `ordered`: `exact`와 같되, 모든 map의 key가 같은 순서에 있다;
  - `subset`: expected map의 모든 key가 관찰된 map의 key이며 값이 같다;
  - `absent`: expected list의 어떤 이름도 관찰된 map의 key가 아니다;
  - `contains`: expected 텍스트, 또는 expected list의 모든 텍스트가 관찰된 텍스트의 일부다;
  - `excludes`: expected list의 어떤 텍스트도 관찰된 텍스트의 일부가 아니다;
  - `prefix`: expected list가 관찰된 list의 첫 item들과 같다;
  - `keys`: expected list가 관찰된 map의 key를 그 순서대로 나열한 list와 같다;
  - `raises`: expected 값이 true이면 단계는 HY-106의 open error의 category인 `value` category의 오류로 실패하고, 그 오류의
    class는 HY-132.7의 class다. 값이 텍스트이면 단계는 같은 방식으로 실패하고 오류의 kind는 그 텍스트다. false이면 단계는
    실패하지 않는다.
  - response 필드는 `compare`를 가지지 않으며 이름으로 비교된다: `status`와 `body`는 `exact`, `headers`는 `subset`, `allHeaders`는
    `exact`, `absentHeaders`는 `absent`, `bodyContains`는 `contains`, `bodyNotContains`는 `excludes`. header 이름은 HY-130이
    정하는 대로 비교된다.
  - `fields`를 가진 expected 필드는 자체로 비교되지 않으며, 각 하위 필드가 자기 비교로 비교된다.
  - 단계의 결과는 필드 없이 비교된다: `raises`는 값 true를 기대하고, `exact`는 단계가 관찰한 두 값을 비교한다.
  - case가 명시하지 않은 필드는 비교되지 않는다.
  - `caseFiles`가 가리키는 모든 runner는 모든 case를 이 비교들로만 비교한다. 자기 runner에 대해 아무것도 비교하지 않는 case는
    `CASE_EMPTY`로 실패하며, `only`가 그 runner를 빼는 필드와 결과는 세지 않는다.
  - 단계의 `raises`: runner는 단계의 모든 error를 잡아 그것 또는 null을 reader에 넘기고, reader는 그 class가 section의
    member에 대한 HY-132.7의 class와 정확히 같은지, case가 kind를 적으면 그 kind인지 확인한다. 각 언어의 runner는 그 class를
    unit이 core를 부르는 member의 목록에서 정한다. `members`가 모두 그 목록에 있는 section은 HY-132.2의 category class를
    기대하고, 그 목록의 member를 하나도 적지 않거나 member가 없는 section은 category의 기반 class를 기대하며, 그 일부만 적은
    section은 `CASE_ERROR`로 실패한다. 하나의 case가 두 class를 기대할 수 없기 때문이다.
  - 각 case는 `requirements`를 가진다. 이는 response 필드가 확인하는 규칙의 목록이다. `requirements`는 필드가 아니다: reader는
    그것을 건너뛰고, check는 그것을 읽는다. case의 유효 규칙은 `requirements`와, 명시된 필드의 `sentence` 및 section의 결과의
    `sentence`에 있는 규칙이다. check는 다른 requirement를 반복하거나 명시된 필드의 `sentence` 규칙을 반복하는 requirement,
    response 필드를 명시하면서 유효 규칙이 비어 있는 case, 그리고 `outside`에 있거나, 그 파일을 `cases`가 이름으로 가리키는
    어떤 concern의 `rules`에도 없는 유효 규칙을 실패시킨다.

## 첫 정렬 (H28.11)

첫 spec은 다음 결정을 순서대로 적용한 HYR-10의 candidate다. 아래 목록이 정하지 않는 결정은 그 이유와 함께 item에 적는다.

1. **같은 개념, 다른 이름.** `contracts/protocol.json`의 규칙이 쓰는 이름을 쓴다. 그렇지 않으면 두 언어가 공유하는 이름을 쓴다.
   그렇지도 않으면 item이 결정하고 그 결정을 나열한다.
2. **두 언어에 있는 member.** 규칙이 차이를 만들지 않는 한 셋째 언어가 그 member를 추가한다(HYR-6).
3. **한 언어에만 있는 member.** 다음 중 하나가 성립하지 않는 한 호출자에 접어 넣고 제거한다.
   - 규칙이 그 언어에 한정하는 member다(HYR-6);
   - HY-106의 public API이며, 다른 언어가 그때 추가한다.
4. **한 언어에만 있는 unit.** 자기 sentence와 함께 `only`를 가지거나, 다른 언어가 추가한다.
5. **다른 parameter.** 규칙의 parameter를 쓴다. 그렇지 않으면 두 언어의 parameter를 쓴다. 규칙이 정하는 runtime 형식의 차이,
   예를 들어 Node handler의 인자 하나인 `HandlerArgument`(HY-105, HY-106)는 그 규칙의 sentence와 함께 `only`다. 어떤 규칙도 정하지 않는 차이,
   예를 들어 Node request 경로의 abort signal은 남기 전에 규칙이 필요하다. 그 밖에는 정렬한다.
6. **접어 넣은 helper.** 접어 넣은 함수는 한 unit의 member다. 자기 파일만 쓰면 `private`이다. 다른 파일이 쓰면
   `internal`이며(Node와 PHP에서는 `@internal`과 함께 export, Python에서는 `_`), 그 파일은 그 unit을 통해 호출한다.
7. **파일.** `contracts/interfaces.json`의 concern이 정한 unit을 쓴다. concern은 HYR-3, HYR-4, HYR-6에 따라 unit을
   정한다. 그 나눔의 결정은 `docs/plans/execution/plan.md`의 wave 28 배경이 나열한다.
8. **테스트.** 둘 이상의 언어가 가진 동작의 native test는 그 concern의 case 파일의 case가 되거나, case가 이미 그것을
   적으면 제거된다. 이는 그 concern을 옮기는 commit에서 한다.

## H28.11이 contracts/protocol.json에 먼저 쓰는 규칙

이 규칙들은 서버가 가지고 있지만 어떤 규칙도 적지 않은 동작을 정한다. 이 규칙들은 spec보다 먼저 쓴다.

1. **요청의 cookie.** 새 규칙 HY-129(가장 높은 HY id에 1을 더한 번호)는 모든 서버가 구현하는 `Cookie` 헤더의 parse
   하나를 정한다. PHP 서버는 헤더를 `$_COOKIE`가 아니라 `$_SERVER['HTTP_COOKIE']`에서 읽는다.
   - 원인: PHP 8.5.10 CGI SAPI(`HTTP_COOKIE`를 가진 `php-cgi`)를 측정한 결과, PHP는 `.`이나 공백이 든 이름을 바꾸고
     (`a.b=1`은 `a_b`가 된다), `[`가 든 이름을 배열로 만들고(`a[x]=1`), `=`가 없는 pair를 빈 값으로 남기고, 이름을
     디코드하지 않으며, 값의 `+`를 그대로 둔다. 이 형태들은 다른 어떤 runtime에도 없는 PHP 변수 이름에서 온다. 지금
     Node와 Python은 PHP와 서로 다르다. Node는 앞의 모든 white space를 제거하고 `+`를 space로 디코드하며, Python은 space만
     제거한다.
   - 규칙은 다음과 같다.
     - 헤더는 받은 field 값의 바이트 그대로다. 클라이언트는 `Cookie` 줄 하나를 보내며(RFC 6265 section 5.4), HTTP/2에서
       서버는 cookie 줄을 `; `로 잇는다(RFC 9113 section 8.2.3). 줄을 따로따로 받는 host는 parse 전에 그 줄들을 `; `로 잇는다.
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
   - `contracts/cookies.json`은 이 각 항목의 case를 하나씩 가진다.
   - cookies unit은 세 서버 모두에 있으며 `only`가 없다.
2. **public session store.** HY-106은 "the session stores of HY-104"라고 쓰고, 애플리케이션이 쓰는 HY-115의 Redis store를
   빠뜨린다. 이 문장은 "the session stores of HY-104 and HY-115"로 고친다.
3. **case 비교.** HYR-11은 case 파일의 비교를 정한다. HY-130은 response의 header를 정하고, HY-4, HY-5, HY-38, HY-62, HY-73,
   HY-106, HY-129는 비교가 정하던 사실을 얻는다.
   - 원인: HYR-7은 reader가 각 expected 필드를 그 파일의 규칙이 정한 비교로 비교하게 했으며, 일부 파일의 필드에는 규칙이 없었다.

## H28.11의 작업 순서

H28.11은 H28.2, H28.3, H28.4, H28.7, 그리고 이 branch가 가진 H28.10의 서버 commit과 함께 한 번의 통합으로 main에 올라간다.
main은 HY-116부터 HY-122까지와 HY-124부터 HY-128까지를 적고 `contracts/context.json`과 `contracts/representations.json`을 가지지만, main의 어떤
서버도 이를 구현하지 않으므로, 그 item들이 올라가기 전에는 main에서 `make recipe-check`가 통과할 수 없다(HYR-2, HYR-7).
마지막 단계까지 이 branch에서 `make recipe-check`는 실패하며, 각 단계는 자기 item의 check를 GREEN으로 유지한다.

1. 이 규칙들을 감사한다(같은 고정 범위). 핵심 발견 사항이 열려 있지 않을 때까지 반복한다.
2. contracts/protocol.json의 위 규칙을 case와 함께 쓰고, 세 서버에서 RED와 GREEN을 거친다.
3. reader, mutation case, schema, check를 쓴다. check가 존재하기 전에 RED를 확인한다.
4. 첫 정렬에 따라 candidate로부터 spec을 쓰고 diff를 검토한다. spec은 H28.7이 쓰는 unit을 가진 representation concern을
   포함하여 각 concern의 `rules`, `cases`, `only` sentence를 채우며, check는 HYR-2의 coverage와 HYR-6의 `only` 문장을 검증한다.
5. 각 언어의 case reader와 runner를 결과 파일과 함께 추가한다.
6. 세 언어의 source를 spec에 맞춘다. concern마다 한 commit으로 하며, 각 commit은 그 concern의 case를 추가하고 HYR-7이
   허용하지 않는 native test를 제거하고, 자기 owner test가 GREEN이다.
7. representation concern의 unit으로 세 서버에 H28.7을 쓴다. `contracts/representations.json`과 `contracts/client.json`의
   case와 함께, `make recipe-check`가 통과할 때까지 한다.
8. branch를 한 번의 통합으로 main에 올린다. H28.2, H28.3, H28.4, H28.7, H28.11은 이와 함께 완료되며, H28.10은 build와
   browser 부분까지 끝나야 완료된다.
