<!-- doc-id: recipe -->
# Recipe of the servers

The PHP, Node and Python servers implement one protocol (`contracts/protocol.json`). Their recipe has three parts:

1. **The development spec**, `contracts/interfaces.json`. It names every concern of the servers, the units and files of
   each concern, and every public, internal and private member of those units. Each member has a language-neutral
   description and its exact native symbol and signature in each language.
2. **The test recipe**, the case files under `contracts/`. Each runner that `runners` of `contracts/interfaces.json` names reads the
   sections that name it.
3. **The checks of each language's own analyzers.**

`make recipe-check` checks parts 1 and 2 against the sources and the test runs.

## Rules

- **HYR-1 One spec.** `contracts/interfaces.json` is the one development spec of the three servers, and its schema is
  `scripts/schema/interfaces.schema.json`. A change of the structure changes the spec first. Then the files of all three
  languages change in the same change. No tool writes the spec.
  It also holds `caseFiles`, the declaration of the case files of HYR-7.

- **HYR-2 Concerns.** A concern has these fields:
  - `id`: its words in kebab-case.
  - `rules`: the HY- and HYC- rule ids that it implements. Every id is stated in `contracts/protocol.json`. Every
    HY- rule of `contracts/protocol.json` is named by a concern, or by the field `outside` of the spec, a list of
    `{rule, reason}`. An example is a rule of the browser code only. A rule in `outside` that a concern names, or an
    `outside` entry with an empty reason, fails HYR-8.
  - `cases`: the case files under `contracts/` that state its behaviour. A concern without a unit, or whose every unit
    has `only` for one language, may have `none` with the reason and the native tests of HYR-7; the check fails `none`
    for any other concern.
  - `units`: its units.

  Every file of `git ls-files` below `packages/server/php/src`, `packages/server/ts/src` and
  `packages/server/python/src/polyspec/hyper` belongs to exactly one concern, and every named file exists. A file of a
  unit holds exactly one unit (HYR-3). The barrel files (`index.ts`, `__init__.py`) and `py.typed` belong to the
  concern `index` and hold no unit. They hold only the re-exports of the public members and the public types of
  HY-106, and HYR-8 checks that list instead of the unit checks.

- **HYR-3 One unit per file.** A unit has these fields:
  - `id`: its words;
  - `kind` in each language: one of `class`, `interface`, `trait` (PHP) or `functions`, a group of module functions;
  - its file in each language.

  In every language a file holds exactly one unit.
  - A PHP `functions` unit is one class of static methods.
  - A unit that only some languages have carries `only` (HYR-6).
  - Each class, interface and trait of a concern is its own unit, and so is each Python class, `Protocol` and
    `TypedDict` included. A Node `interface` is a unit of kind `interface` when another language holds a unit of the
    same words, and a type of HYR-5 otherwise; the check fails a type whose words are the words of a unit. Examples:
    Result and its four stops, Session and Flash, ClientRendering and Choice, SessionStore and ArraySession.

- **HYR-4 File names.** The file of a unit is the words of the unit, written by the rule of its language.
  - PHP: PascalCase, `<Words>.php`, in the namespace `Polyspec\Hyper`.
  - Node: kebab-case, `<words>.ts`.
  - Python: snake_case.
    - `<words>.py` is a module that HY-106 or HY-100 makes public.
    - `_<words>.py` is an internal module.
    - A module that HY-100 names keeps that name: `server`, `wsgi` and `asgi`.
  - Word boundaries.
    - A word boundary is a lowercase letter or a digit followed by an uppercase letter.
    - An acronym is one word, written as a word: PascalCase `Csrf`, camelCase `csrf`, snake_case `csrf`. So no name of
      the spec holds two uppercase letters in a row, and the check fails such a name.
    - Member names follow the same boundaries (HYR-5).
  - Test units. A unit of the test tree, such as the case runner and the case reader of HYR-7, follows the same words
    in the test directory of its language: PHP `packages/server/php/tests/<Words>.php` in the namespace
    `Polyspec\Hyper\Tests`, Node `packages/server/ts/tests/<words>.ts`, and Python
    `packages/server/python/tests/<words>.py` without a leading `_`, because no test module is public or internal API of
    HY-106. The case runner and the case reader of a language are the `runners` and `caseReaders` entries of
    `contracts/interfaces.json`, as HYR-7 states.

  For example, the unit `media selection` is `MediaSelection.php`, `media-selection.ts` and `_media_selection.py`.

- **HYR-5 Members.**
  - **Scope.** The members of a unit are these:
    - all of its methods and module functions, whether public, internal or private;
    - its constructor;
    - the properties that HY-106 makes public API.

    HY-106 makes no constant public API, so no constant is a member, and every constant is internal or private: the
    readers read each constant for its visibility only, and the check fails a PHP `public const` without `@internal` on
    it or its class, a Node exported `const` without `@internal`, and a Python module-level name without `_` in a
    public module. A constant that becomes public API needs that rule first.
  - **Properties.** A property is a declaration in the class body:
    - a PHP typed property, or a constructor-promoted parameter;
    - a Node class field, or a Node parameter property (a constructor parameter with `public`, `private`,
      `protected` or `readonly`);
    - a property signature of a Node interface unit;
    - a Python class-level annotated attribute.
    An assignment in a method body is not a property.
  - **Fields of a member.**
    - `id`: `<unit>.<member>`, with the language-neutral name in camelCase.
    - `kind`: one of constructor, method, static method, function or property.
    - `visibility`: one of public, internal or private.
    - `inputs`, `output` and `errors`: in the terms of the vocabulary. The vocabulary is the terms of
      `contracts/protocol.json`, the units and types of the spec, and `list<T>`, `map<T>`, `optional<T>` and
      `function(...) -> T` of them; no union term, a Node `Promise<T>` is `T`, an iterator or generator is `list<T>`,
      and a callable is `function(...) -> T`. A term outside it fails HYR-8.
      An error is a status that a statement of `contracts/protocol.json` names or an error unit of the spec.
    - `state`: one sentence of what it does.
    - `native`: for each language, the exact `symbol` and the exact `signature` (see below).
  - **Types.** A type is a type declaration that is no unit (HYR-3): a Node `type` alias or `interface`, and a Python
    `type` statement. The spec lists it once under `types` with `id` (its words in camelCase), `visibility` (as for a
    member), `unit` (the unit whose file holds it in each language), a neutral `shape` and, for each language that
    declares it, `native: {symbol, declaration}`.
    - The shape is `fields`, a map from neutral names to vocabulary terms with an `optional` list, for a record;
      `function` with `inputs` and `output` for a function type; or a vocabulary term.
    - The check fails a type that is missing, added, moved or of another visibility, and a declaration whose fields,
      written by the names of HYR-5, differ from the shape.
    - An options record is the runtime form of named parameters (HY-106): its fields are the named `inputs` of the
      member that takes it, and the check fails when they differ from the named parameters of that member in another
      language. A field that only some languages have carries `only` (HYR-6), as a member does.
  - **Symbol.** The symbol is `<path>::<qualified name>`.
    - `<path>` is the repository-relative path of the file.
    - The qualified name of a PHP member is `Polyspec\Hyper\<Unit>::<member>`.
    - In Node and Python it is `<Unit>.<member>` for a class member, and `<member>` for a module function.
    - A constructor is `__construct` in PHP, `constructor` in Node and `__init__` in Python.
  - **Names.**
    - PHP and Node keep the camelCase name.
    - Python writes it in snake_case.
  - **Visibility.**
    - A member has one neutral `visibility`. Public and internal are the two classes of HY-106. Private is the access
      of the language, inside the internal class.
    - Public, in each language:
      - PHP: `public`, with no `@internal` on the member or on its class;
      - Node: exported, not `private`, with no `@internal` on the member or on its class;
      - Python: no leading `_` on the member, in a public module (HYR-4).
    - Internal, in each language:
      - PHP: `public`, with the docblock line `@internal` on the member or on its class;
      - Node: exported, with the JSDoc tag `@internal` on the member or on its class;
      - Python: a leading `_` on the member or on its module, as HY-106 states. A member without `_` in a `_` module
        is internal.
    - Private, in each language:
      - PHP: `private`;
      - Node: `private` for a class member, and not exported for a module function;
      - Python: a leading `_`, and the spec declares it `private`. Python has no access modifier, so the spec decides,
        and the Python reader checks the use by name, with no type inference: it fails a `private` member whose name
        appears as an import name or alias or as an attribute name (`ast.Attribute.attr`) in another file of the
        package. So a private name is unique in the package, and a homonym fails until the spec and the source rename
        one of them.
    - The PHP and Node readers take private from the modifier, and the check fails a member whose modifier differs
      from its neutral visibility.

- **HYR-6 Only some languages.** A unit, a member, a field of a type or a case that only some languages have carries
  `only: {languages, sentence}`:
  - `sentence` is one statement id of `contracts/protocol.json` that requires the difference.
  - A statement of `contracts/protocol.json` is one sentence. A sentence runs from its first word to the period that is
    followed by a space or by the end of the rule. A period inside a code span or an identifier, such as
    `session.save_handler` or `6.3.0`, does not end a sentence. Examples come from HY-54, HY-100, HY-104, HY-105,
    HY-106 and HY-115.

  A unit, a member or a field of a type that is missing in a language without `only` is a defect. A runtime idiom that no
  rule names, such as the `code` of a Node.js error, is no unit and no member of its own: each user writes it in its own
  code, as the other languages write theirs (Python `except FileNotFoundError`).

  The concerns that the Node server takes from the browser code by HY-54 (manifest, region, router, reads and the
  renderer) are units `only` PHP and Python with the HY-54 sentence. Their behaviour is the same across all three
  servers through their case files (HYR-7).
  A field of a case that only some languages read or compare carries `only` in the same way, and `browser` names the
  browser package as a language.

- **HYR-7 Test recipe.**
  - **Runners.** Each server language has exactly one case runner, which `runners` in `contracts/interfaces.json` names.
    It runs every section of every case file under `contracts/` whose `runners` in `caseFiles` names its language.
    `runners` names the runner of each of `php`, `node`, `python`, `browser` and `build`. `browser` and `build` read
    their sections through `caseReaders.node`, and the check counts the results of all five runners.
  - **Reading a case.** A runner reads each case only through the case reader of its language, one unit of the test
    tree with the same members in every language: the public members `cases`, `section`, `id`, `has`, `input`,
    `compare`, `outcome`, `fail` and `line`, and the private members `declaration`, `matches` and `equal`. `compare`
    compares a field and `outcome` an outcome of the step.
    - `caseFiles` of `contracts/interfaces.json` is the one source of the roles and comparisons of the case files
      (HYR-11). For each file it names its top-level keys (`fixtures`) and, for each case array
      (`sections`), its `runners`, the fixtures that its cases use (`uses`), every field with its role and, for each
      expected field, each input field that a step also checks and each outcome of a step, the comparison, its `state`,
      and the `sentence` that states the observed behaviour. The check verifies each `sentence` as it verifies `only`
      (HYR-6).
    - The case reader gives the input fields and the used fixtures of a case to the runner, and compares each expected
      field with the observed value itself, by the comparison that `caseFiles` names. The runner does not compare.
    - The reader fails a file with `FILE_UNDECLARED <path>` before its first case when the file holds a key, a section
      or a field that `caseFiles` does not declare, other than `only` (HYR-6) and `requirements` (HYR-11), or an expected
      field without `fields` that has no comparison or sentence, and the runner writes
      `CASE <file> <id> FAIL FILE_UNDECLARED <path>` for each case of the file.
    - It fails a case with `CASE_ERROR <message>` for an error that the step of the runner raised, with `CASE_EMPTY`
      for a case that compares nothing for its runner (HYR-11), with `FIELD_DIFFERS <name>` for the first expected
      field whose comparison fails, and, after the case, with `FIELD_UNKNOWN <name>` for an input field or a used
      fixture that was not read and with `FIELD_UNCOMPARED <name>` for an expected field that was not compared. The
      reason of a failed case is the first of these in that order. A nested field is named by its dotted path, such as
      `received.headers`.
    - A case may carry `only` (HYR-6); the reader reads it and gives the case only to the runners of the languages
      that it names.
  - **Results.**
    - Every runner writes one line per case to the results file named by `RECIPE_RESULTS`: `CASE <file> <id> PASS`, or
      `CASE <file> <id> FAIL <reason>`.
    - It exits nonzero when a case fails.
    - `make recipe-check` takes success from the exit status and from the lines of that file. A case without a line
      fails, and no other output supplies a result.
    - The check takes the case ids of each runner from the sections whose `runners` in `caseFiles` name it,
      and fails when a runner misses such a case id or prints an id that is not one. A case with `only` counts only
      for the languages that it names.
  - **Native tests.** A native test is a test of the test tree of one language that runs no case file. It exists only
    for a unit or member whose `only` names one language, or for a concern with `cases: none`. A behaviour that two
    languages have is a case with `only: {languages, sentence}` (HYR-6), which the other runners leave out, and the
    check takes the case ids of each language from the sections whose `runners` name it, from the cases without `only`
    and those whose `only` names it.
    - The spec names each one under that unit, member or concern as `<test file>::<test name>: <reason>`.
    - HYR-8 lists every test of each language's test tree by that language's own parser. It fails for a test that is
      neither the runner nor named in the spec, for a named test that is missing, for an empty reason, and for a
      native test named under a unit or member whose `only` does not name exactly one language, or a concern with
      cases.
    - So a behaviour that more than one language has is tested only by its case file, and the native test of such a
      behaviour is removed in the commit that adds its case.

- **HYR-8 The check.** `make recipe-check` reads `contracts/interfaces.json`, and reads every unit and member of the
  sources with each language's own parser:
  - PHP:
    - `ReflectionClass`, `ReflectionMethod`, `ReflectionProperty` and `ReflectionClassConstant` over the autoloaded
      package, with every visibility;
    - `getDocComment()` for `@internal`;
    - `getDeclaringClass()` for a trait method.
  - Node: the TypeScript compiler API, for every declaration, its modifiers, its export and its JSDoc tags.
  - Python: `ast`, for every `def`, every `class`, every `type` statement (`ast.TypeAlias`), every class-level
    annotated attribute and every module-level assignment, private ones included. A Python type alias is written with
    `type`; a module-level assignment is a constant.

  It compares the sorted keys of the spec and of the sources exactly, field by field. It fails for:
  - a file that no unit names, or a named file that is missing;
  - a unit against HYR-3 or HYR-4;
  - a member or a type that is missing, added, moved, retyped, or of another visibility;
  - a constant against HYR-5;
  - an `only`, a field or outcome `sentence`, or a case `requirements` against HYR-6, HYR-11 or HYR-2;
  - a rule or case reference, or an `outside` entry, against HYR-2;
  - a barrel file whose re-exports differ from the public members and the public types of the spec;
  - a file of `git ls-files contracts/*.json` other than `interfaces.json` and `protocol.json` with no `caseFiles`
    entry, and an entry, section or field of `caseFiles` that no file holds;
  - a result, a case reader or a native test against HYR-7.

  Each run first runs the readers' mutation cases, and fails when a reader passes a mutation.

- **HYR-9 Analyzers.** Each language also runs its own analyzers: `make analyse-php`, `make typecheck` and
  `make hyper-lint`.

- **HYR-10 Update.**
  - `make recipe-candidates` writes a candidate under `var/` with the schema of the spec. The readers fill the native
    fields: `symbol`, `signature`, `declaration`, `kind` and `visibility`.
  - These fields are written by hand in the reviewed change of the spec:
    - the neutral fields `inputs`, `output`, `errors`, `state` and the `shape` of a type;
    - the concern fields `rules` and `cases`;
    - `caseFiles`, the case files and the comparison of each of their fields (HYR-11);
    - the unit grouping;
    - `only`.
  - The candidate marks each of these fields as hand-written.
  - A change of the spec is written from the field-by-field diff between the candidate and the spec. The sources
    then follow it.

- **HYR-11 Case comparisons.** A field of a case file has one role: `id`, `label`, `input`, `expected` or `response`.
  Each expected field and each outcome of a step has a `compare` in `caseFiles`, one of these nine kinds:
  - `exact`: the observed value equals the expected value as a JSON value, where a map equals a map with the same keys
    and equal values in any order, a list equals a list with equal items in the same order, and null equals only null;
  - `ordered`: as `exact`, and the keys of every map are in the same order;
  - `subset`: every key of the expected map is a key of the observed map with an equal value;
  - `absent`: no name of the expected list is a key of the observed map;
  - `contains`: the expected text, or every text of the expected list, is part of the observed text;
  - `excludes`: no text of the expected list is part of the observed text;
  - `prefix`: the expected list equals the first items of the observed list;
  - `keys`: the expected list equals the keys of the observed map in their order;
  - `raises`: when the expected value is true, the step fails with the open error of HY-106, and when it is false, the step
    does not fail.
  - Response fields have no `compare` and are compared by name: `status` and `body` `exact`, `headers` `subset`,
    `allHeaders` `exact`, `absentHeaders` `absent`, `bodyContains` `contains` and `bodyNotContains` `excludes`. Header
    names are compared as HY-130 states.
  - An expected field with `fields` is not compared itself, and each of its fields is compared by its own comparison.
  - An outcome of a step is compared without a field: `raises` expects the value true, and `exact` compares the two values
    that the step observes.
  - A field that a case does not state is not compared.
  - Every runner that `caseFiles` names compares every case by these comparisons and by no other. A case that compares
    nothing for its runner fails with `CASE_EMPTY`; fields and outcomes whose `only` leaves that runner out do not count.
  - `raises` on a step: the runner catches every error of the step and gives it, or null, to the reader, which checks that
    its class is exactly the open error of HY-106.
  - Each case carries `requirements`, the rules that its response fields check. `requirements` is not a field: the reader
    skips it, and the check reads it. A case's effective rules are its `requirements` plus the rules of the sentences of
    its stated fields and of its section's outcomes. The check fails a requirement that repeats another requirement or the
    rule of a stated field's sentence, a case that states a response field and whose effective rules are empty, and an
    effective rule that is in `outside` or in the `rules` of no concern whose `cases` name the file.

## The first alignment (H28.11)

The first spec is the candidate of HYR-10 with these decisions applied in order. The item lists every decision that
the list below does not settle, with its reason.

1. **Same concept, different names.** Use the name that a rule of `contracts/protocol.json` writes. Otherwise use the name that two
   languages share. Otherwise the item decides and lists the decision.
2. **A member in two languages.** The third language adds it, unless a rule makes the difference (HYR-6).
3. **A member in one language.** It is folded into its callers and removed, unless one of these holds:
   - a rule makes it specific to that language (HYR-6);
   - it is public API of HY-106, which the other languages then add.
4. **A unit in one language.** It carries `only` with its sentence, or the other languages add it.
5. **Different parameters.** Use the parameters of a rule. Otherwise use those of two languages. A difference of the
   runtime form that a rule states, such as the context argument of a Node handler (HY-105, HY-106), is `only` with
   the sentence of that rule. A difference that no rule states, such as the abort signal of the Node request path, needs a rule before
   it stays. Otherwise it is aligned.
6. **Folded helpers.** A folded function is a member of one unit. It is `private` when only its own file uses it.
   It is `internal` (exported with `@internal` in Node and PHP, `_` in Python) when another file uses it, and that
   file calls it through that unit.
7. **Files.** Use the units of the section "Concerns and units", which states them by HYR-3, HYR-4 and HYR-6. Where it differs
   from these rules, the rules govern and the item lists the decision.
8. **Tests.** A native test of a behaviour that more than one language has becomes a case of its concern's case file,
   or is removed when a case already states it, in the commit that moves that concern.

## The rules that H28.11 writes in contracts/protocol.json first

These rules state behaviour that the servers have and that no rule states. They are written before the spec.

1. **The cookies of a request.** A new rule, HY-129 (the highest HY id plus one), states one parse of the `Cookie`
   header that every server implements, and the PHP server reads the header from `$_SERVER['HTTP_COOKIE']` instead
   of `$_COOKIE`.
   - Cause: a measurement of the PHP 8.5.10 CGI SAPI (`php-cgi` with `HTTP_COOKIE`) shows that PHP renames a name
     with `.` or a space (`a.b=1` gives `a_b`), makes a name with `[` an array (`a[x]=1`), keeps a pair without `=`
     as an empty value, decodes no name, and keeps `+` in a value. These forms come from the names of PHP variables,
     which no other runtime has. Node and Python today differ from PHP and from each other: Node removes all leading
     white space and decodes `+` to a space, and Python removes only spaces.
   - The rule states:
     - The header is the bytes of its field value as received. A client sends one `Cookie` line (RFC 6265 section
       5.4), and over HTTP/2 the server joins the cookie lines with `; ` (RFC 9113 section 8.2.3). A host that
       receives the lines apart joins them with `; ` before the parse: Node takes `cookie` of `node:http`, which
       joins with `; `; Python `server.py` reads every `Cookie` line and not only the first; `asgi.py` joins the
       `cookie` headers of the scope with `; `, and not with `, ` as for other headers.
     - A host that receives the header joined takes it as it is given: PHP takes `HTTP_COOKIE` from its SAPI, and
       `wsgi.py` takes `HTTP_COOKIE` and encodes it in Latin-1 back to its bytes. The PHP built-in server joins
       several HTTP/1.1 `Cookie` lines with `, ` (measured with PHP 8.5.10: two lines `a=1` and `b=2` give
       `a=1, b=2`), and so does a WSGI server that joins them so. Such a request breaks RFC 6265 section 5.4, the
       server parses the value that it is given, and the rule states this difference instead of hiding it.
     - The header splits at each `;` into pairs. Spaces and tabs at both ends of a pair are removed. A pair splits at
       its first `=` into a name and a value.
     - A pair gives no cookie when it has no `=`, when its name is empty, when its name is not valid UTF-8, or when
       its value after percent-decoding is not valid UTF-8. The name is not decoded. The value is percent-decoded:
       `%` with two hexadecimal digits is the byte of those digits, and every other byte, `+` included, is itself.
     - Of the pairs that give a cookie, the first of a name counts.
   - The PHP session reads its identifier from this parse. The native session options set `session.use_cookies` to
     false, so PHP neither reads nor sends a session cookie. When the parse gives an identifier of HY-45, the server
     passes it with `session_id()` before `session_start()`; otherwise it starts the session with no identifier.
     The server sends the session cookie of HY-45 itself. No part of the PHP server reads `$_COOKIE`.
     Today `NativeSession.php` reads `$_COOKIE[$name]` and `Request.php` builds the cookies from `$_COOKIE`, which
     makes two parses of one header.
   - `contracts/cookies.json` holds one case for each of these points.
   - The cookies unit exists in all three servers, with no `only`.
2. **The public session stores.** HY-106 names "the session stores of HY-104" and leaves out the Redis stores of
   HY-115, which an application uses. The sentence is corrected to "the session stores of HY-104 and HY-115".
3. **The case comparisons.** HYR-11 states the comparisons of the case files. HY-130 states the headers of a response;
   HY-4, HY-5, HY-38, HY-62, HY-73, HY-106 and HY-129 gain the facts that the comparisons had stated.
   - Cause: HYR-7 had the reader compare each expected field by the rule of its file, and some files had no rule for their
     fields.

## The order of work for H28.11

H28.11 lands on main in one integration with H28.2, H28.3, H28.4, H28.7 and the server commits of H28.10 that this
branch holds. Main states HY-116 to HY-122 and HY-124 to HY-128 and holds `contracts/context.json` and `contracts/representations.json`,
which no server of main implements, so `make recipe-check` cannot pass on main before those items land (HYR-2,
HYR-7). Until the last step `make recipe-check` fails on this branch, and each step keeps the checks of its own item
GREEN.

1. Audit these rules (same fixed scope), until no core finding is open.
2. Write the rules of contracts/protocol.json above, with their cases, RED and GREEN in the three servers.
3. Write the readers, the mutation cases, the schema and the check, RED before the check exists.
4. Write the spec from the candidate by the first alignment, and review the diff. The spec fills `rules`, `cases`
   and the `only` sentences of each concern, the representation concern included with the units that H28.7
   writes, and the check verifies the coverage of HYR-2 and the `only` sentences of HYR-6.
5. Add the case reader and the runner of each language with the results file.
6. Move the sources of the three languages to the spec, one concern per commit. Each commit adds the cases of its
   concern and removes the native tests that HYR-7 does not allow, with its owner tests GREEN.
7. Write H28.7 in the three servers in the units of the representation concern, with the cases of
   `contracts/representations.json` and `contracts/client.json`, until `make recipe-check` passes.
8. Land the branch on main in one integration. The items H28.2, H28.3, H28.4, H28.7 and H28.11 complete with it; H28.10
   completes only with its build and browser parts.

## Concerns and units

Notation:
- `(pub)` marks a Python module that HY-106 or HY-100 makes public. Every other Python module has a leading `_`.
- `only <languages>: <rule> "<quote>"` marks a unit that only those languages have (HYR-6).
- An arrow (`←`) names the current file that the unit comes from.
- **Open** marks a decision that the first alignment settles and the item lists.

### Application and pipeline

1. **app**
   - app: `App.php` / `app.ts` / `app.py` (pub).
     - Public members: open, bind and handle. PHP run and Node server and listener are `only` HY-100 "PHP through a
       front controller that calls `App::run`" and "Node through the `node:http` request listener of `App.listener`,
       which `App.server` installs".
     - Node `open-checks.ts` folds back into `app.ts`, as PHP and Python hold the open checks in App.
2. **media selection** (HY-116, HY-119, HY-62)
   - media selection: `MediaSelection.php` (← App.php negotiate) / `media-selection.ts` (← negotiate.ts) /
     `_media_selection.py` (← _media.py).
3. **accept**
   - accept: `Accept.php` / `accept.ts` / `_accept.py`.
4. **media type** (HY-106)
   - media type: `MediaType.php` / `media-type.ts` / `media_type.py` (pub).
5. **build** (HY-48, HY-125)
   - build: `Build.php` / `build.ts` / `_build.py`.
6. **context** (HY-124 to HY-128)
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
     ASGI callable of `create_asgi` or the `http.server` server of `create_server`". It is the one pipeline of those
     three hosts.
   - wsgi: — / — / `wsgi.py` (pub). `only python`: HY-100, the same sentence.
   - asgi: — / — / `asgi.py` (pub). `only python`: HY-100, the same sentence.

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
    - named values: `NamedValues.php` (a trait) / `named-values.ts` / `_named_values.py`. Node and Python get the
      shared part that PHP holds in the trait. In Node and Python the kind is `class`, a base of fields and files.
    - uploaded file: `UploadedFile.php` / `uploaded-file.ts` / `uploaded_file.py` (pub).
14. **cookies**
    - cookies: `Cookies.php` (← Request.php `$_COOKIE`) / `cookies.ts` (← form.ts parseCookies) / `_cookies.py` (←
      _pipeline.cookie_values). All three servers parse the header by HY-129 ("The rules that H28.11 writes in
      contracts/protocol.json first", item 1).
15. **container** (HY-105)
    - container: `Container.php` / `container.ts` (← services.ts) / `container.py` (pub).

### Session

16. **session store** (HY-104)
    - session store: `SessionStore.php` (an interface) / `session-store.ts` (← session.ts) / `session_store.py`
      (pub, ← session.py).
    - array session: `ArraySession.php` (`@internal`) / `array-session.ts` (`@internal`, ← session.ts
      MemorySessionStore) / `_array_session.py` (← session.py). No rule names a store in memory, and a store in memory
      cannot share sessions between processes and servers as HY-104 requires, so by HY-106 it is internal. It is the
      store of the tests. The barrels export it today against HY-106 (Python `__init__.py` `ArraySession`, Node
      `index.ts` `MemorySessionStore`); those exports are removed in the alignment of this concern, and no consumer
      imports them.
17. **session** (HY-96, HY-120)
    - session: `Session.php` / `session.ts` / `_session.py`.
    - flash: `Flash.php` / `flash.ts` (← session.ts `export interface Flash`) / `_flash.py` (← _session.py).
    - Both are internal: HY-106 names no session value and no flash, and "Every other symbol that a package declares
      is internal". PHP and Node mark them `@internal`.
18. **csrf**
    - csrf: `Csrf.php` / `csrf.ts` / `_csrf.py`. Members masked, mask and verify, the names that PHP and Python
      share (alignment rule 1). Node `maskedToken`, `maskToken` and `verifyToken` are renamed to them.
19. **native sessions** (HY-104, HY-115)
    - native session: `NativeSession.php` / — / —. `only php`: HY-104, the sentence of the native session handler.
    - redis cluster sessions: `RedisClusterSessions.php` / — / —. `only php`: HY-115.
    - redis sentinel sessions: `RedisSentinelSessions.php` / — / —. `only php`: HY-115.
    - session record: — / `session-record.ts` (`@internal`) / `_session_record.py`. `only node, python`: HY-104, the
      sentence "The PHP server keeps a session with the native session handler of PHP, with `serialize_handler` set to
      `php_serialize` by its session options." Internal, because no rule makes the record public.
    - file sessions: — / `file-sessions.ts` / `file_sessions.py` (pub, a session store of HY-104). `only node,
      python`: HY-104, the same sentence.
    - redis sessions: — / `redis-sessions.ts` / `redis_sessions.py` (pub, a session store of HY-115 by the corrected
      HY-106). `only node, python`: the HY-115 sentence that gives PHP its native Redis handler, copied whole.
    - flock: — / `flock.ts` / —. `only node`: HY-104 "The Node server calls `flock` through `node:ffi` with
      `LOCK_NB` and tries again after a pause of at most 50 ms, because a call that blocks would stop its event
      loop." Python calls `fcntl.flock` of its standard library, so it has no binding.
    - Every `only` names one statement (HYR-6). The spec copies each one exactly, and the check verifies
      it against contracts/protocol.json.
20. **error code**
    - No unit. `errorCode` of `error-code.ts` is the Node.js idiom of reading the `code` of an error, which no rule
      names (HYR-6). Each user, file-sessions.ts and server.ts, reads the code in its own code, as Python writes
      `except FileNotFoundError`, and `error-code.ts` is removed.

### Data and rendering

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
    - Each is `only php, python`: HY-54, the sentence by which the Node server renders with the browser code. Their
      behaviour is checked in all three servers by the case files.
25. **page**
    - page: `Page.php` (← App.php page) / `page.ts` / `_page.py` (← app.py page). It holds the page assembly, the
      document with the kept fallback, and the loader map.
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
    - No unit. `index.ts` and `__init__.py` re-export the public members, and `py.typed` marks the typed package. PHP
      has no barrel because it loads by namespace (HYR-2).
