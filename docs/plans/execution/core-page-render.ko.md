<!-- doc-id: core-page-render-execution -->
<!-- source-sha256: cffb8ab741e2aa8a7f941e0f7baa766724fd86bca70cc4200915e9eb892dfc20 -->
# 서버의 core page render: 설계

[English](core-page-render.md).

이 문서는 [실행 체크리스트](checklist.ko.md)의 행 H35.32-2의 설계다. [계획](plan.ko.md)이 H35.32 설계의 입력 아래에 적은 여덟 질문에 답하고, 이 이동이 더하는 규칙을 적고, 바뀌는 statement의 초안을 쓰고, 행의 순서를 정한다. 이 문서는 행 H35.32-3부터 H35.32-8까지와 H35.32-1, 그리고 명세 변경의 입력이다.

## 범위와 코드의 상태

Node 서버는 `Page.respond`(`packages/ts/src/page/page.ts:49-139`)에서 브라우저 코드의 `decodeResponse`와 `renderDocument`(`page.ts:136-137`)로 JS render engine 위에서 페이지를 렌더한다. 이 이동은 그것을 core의 `PageRequest::next`(`packages/rust/src/steps.rs:538`)로 바꾸며, `next`는 `Templates::render_document`(`packages/rust/src/render.rs:361`)로 렌더한다.

core는 이 이동을 위해 다음 부분을 가진다.

- `Pages::open`, `Pages::register`, `PageRequest::new`, `PageRequest::next`(`steps.rs:145`, `:188`, `:465`, `:538`).
- `data_model::check`(`packages/rust/src/data_model.rs:16-20`): template 라이브러리의 `bind_value`와 그다음의 `to_json_value`. `next`는 `State::Context`의 arm에서 context에 이것을 호출하고(`steps.rs:563-570`), `answer`는 읽기 경로 전에 공유 데이터와 각 영역의 데이터에 호출한다(`steps.rs:733-738`. `keep`은 `:740`과 `:756`).
- `check_function_entry`(`render.rs:73-81`, member `rules.check_function_entry`, HYC-24.7), 그리고 template 언어의 message를 그대로 넘기는 `Templates::register`(`render.rs:125-129`, HYC-24.8).
- `Pages::render_document`와 `Pages::render_parts`(`steps.rs:262-297`). 라우트, 공유 데이터, 각 영역의 데이터, `now`를 받으며, record `DocumentParts`(`steps.rs:202-207`)가 함께 있다.

binding의 Node wrapper는 있고(`packages/ts/src/app/core-rules.ts:476-488`: `appRoute`, `pageTag`, `pageHeaders`, `pageOpen`, `pageRequest`, `pageDocument`, `pageParts`), `core-rules.ts` 밖의 `packages/ts/src`의 어떤 파일도 이들을 호출하지 않는다(검색: `packages/ts/src`, `packages/cli/lib`, `scripts`에서 `grep -rnE "appRoute|pageOpen|pageHeaders|pageRequest|routeReads"`).

template 라이브러리는 그 저장소의 snapshot `template-pin-7ddb9554`(`packages/rust/src`, `packages/ts/generated`, `packages/ts/render`, `docs/spec`)에서 읽었다. `packages/rust/Cargo.toml:35`는 crate를 branch로 받으므로 빌드가 받는 revision은 이 트리에 적혀 있지 않다. snapshot에서 읽은 사실에는 "snapshot"이라고 적는다.

각 답은 다음을 담는다: 규칙과 그 이유, 현재 코드, 각 서버가 지금 하는 일, 그 지점을 관찰하는 case와 결과가 바뀌는 case의 수, 규칙이 바꾸는 것, 확인하지 못한 것.

## 질문 1 — 액션이 세션을 갱신한 뒤의 토큰 (HY-72.3)

규칙. `PageRequest`를 다시 만들지 않는다. 액션 다음 step의 입력 `Input::Action`이 선택 member `csrf`, 곧 새 토큰을 가린 값을 얻고, `next`는 다음 handler를 요청하기 전에 `PageInput.csrf`를 그 값으로 바꾼다. 이유: 액션은 요청의 step이고(`steps.rs:542-544`), step의 순서는 core가 정하며, 두 번째 `PageRequest`는 host가 영역 선택(`steps.rs:477`)을 반복하게 한다.

현재 코드. `PageRequest::new`는 입력을 복제한다(`steps.rs:484`). `shared_data`는 `State::Shared`의 두 arm에서만 `self.input.csrf`를 읽고(`steps.rs:574`, `:580`), 이 arm은 `State::Action`의 arm(`steps.rs:549-562`) 뒤에 실행된다. `Input::Action`은 `outcome`만 가진다(`steps.rs:372`). core에는 `session::renew`(`packages/rust/src/session.rs:379-382`)가 있으나 binding은 이를 선언하지 않는다.

세 서버의 현재. 각 서버는 액션이 돌아온 뒤 갱신하고 새로 가린 값을 가진 request를 페이지에 준다: Node `packages/ts/src/app/app.ts:736-738`, PHP `packages/php/src/App/App.php:858-861`, Python `packages/python/src/polyspec/hyper/app/app.py:712-714`.

case. 11개가 갱신을 관찰한다. `contracts/app.json`의 8개(`an_action_that_renews_the_session_replaces_the_token_and_renews_the_store_once`, `the_flash_values_of_a_redirect_stay_after_the_renewal`, `a_masked_value_of_the_token_before_a_renewal_is_refused`, `a_masked_value_of_the_token_after_a_renewal_is_accepted`, `a_route_loader_that_renews_the_session_fails_and_renews_nothing`, `the_page_of_an_action_that_renewed_the_session_carries_a_masked_value_of_the_new_token`, `a_renewed_session_has_another_tag_for_the_same_data`, `an_action_that_renews_the_session_reads_the_old_browser_and_the_shared_handler_after_it_the_new`)와 `contracts/context.json`의 3개(`an_action_that_finds_another_revision_renders_the_page_with_409`, `a_loader_that_renews_the_session_fails_the_409_page`, `the_409_page_after_a_renewal_carries_the_new_token`)다. 결과가 바뀌는 것은 0개다.

바꾸는 것. H35.32-3이 `Input::Action`과 `packages/rust/interface.json`의 `page_step_input`의 variant `action`에 member를 더한다. host는 액션 뒤에 세션을 갱신하고, `csrfMask`로 새 토큰을 가리고, 그 값을 액션 입력에 주고, `computePageHeaders`를 위해 새로 가린 값과 새 토큰의 쌍을 보관한다(`PageResponse.masked_token`과 `token`, `packages/rust/src/front.rs`). statement는 바뀌지 않는다.

저장된 유지 값. `PageInput.stored`는 `PageRequest`를 만들 때, 곧 액션과 로더 전에 준다(`steps.rs:327`, 읽는 곳은 `:762`). Node와 PHP는 로더 뒤에 저장된 유지 값을 읽는다(`page.ts:116`과 `:155`, `packages/php/src/Page/Page.php:118`과 `:211`). 두 순서는 요청의 handler가 세션의 저장된 유지 값을 바꿀 때에만 다른 결과를 준다. 그 순서를 고정하는 case는 0개다(검색: `contracts/app.json`과 `contracts/keep.json`의 case 중 유지 값을 쓰는 handler. 찾지 못함). 확인하지 못함: handler가 세션의 유지 값을 쓰는 interface를 가지는지. kept endpoint는 별도의 요청이다. 갱신은 유지 값을 그대로 두므로(HY-72.2) 액션 입력에 member `stored`는 필요하지 않다.

## 질문 2 — HY-44를 판정하는 곳

규칙. host는 HY-44의 검사를 갖지 않는다. 두 곳이 값을 판정한다. 생성된 binding의 경계가 언어의 값을 변환하며 데이터 모델에 형태가 없는 값을 실패시키고, core의 `data_model::check`가 변환된 값을 판정한다. 둘 다 template 데이터 모델의 kind와 message로 실패하며, hyper는 이를 그대로 넘긴다(HY-44.9). 이유: 그러면 세 서버가 값 하나에 kind 하나와 message 하나를 주고, 읽기 경로가 빼는 값은 읽기 경로를 적용하기 전에 판정된다.

HY-44.9와 case가 어긋나는 것이 결함이다. `contracts/context.json`의 세 case가 message `a number outside ±(2^53 − 1) is not a value of the data model (HY-44)`를 비교한다(`a_context_value_outside_the_data_model_fails`, `a_shared_value_outside_the_data_model_that_no_template_reads_fails_a_document`, `a_shared_value_outside_the_data_model_that_no_template_reads_fails_a_region_request`, `contracts/context.json:1222`, `:1840`, `:1874`). 그 글자는 template 데이터 모델이 아니라 각 host의 표(`packages/ts/src/data/data-model.ts:8-14`, `packages/php/src/Data/DataModel.php:22-28`, `packages/python/src/polyspec/hyper/data/_data_model.py`의 `FAILURES`)가 쓴다. template 데이터 모델의 글자는 `number <n> is outside the safe range`다(snapshot, `packages/rust/src/value/bind.rs:36-46`, `value/host.rs:86-106`). 세 case는 template 데이터 모델의 글자로 바뀌고, 세 표는 없앤다.

이동 뒤에 값을 거부하는 곳. 경계는 생성된 binding의 `in_template_value`(`packages/ts/native/generated/lib.rs`, 함수 `describe`, `describe_object_value`, `map_entries`)이며, template 라이브러리의 `value_in`(snapshot, `value/host.rs:78-141`)을 호출한다. "읽음"은 적힌 함수를 읽어 확인했다는 뜻이고, "실행"은 행을 시작하기 전에 실행으로 확인한다는 뜻이다.

| handler의 입력 | 거부하거나 변환하는 곳 | kind | message | 확인 |
| --- | --- | --- | --- | --- |
| handler의 결과인 일반 객체 | 경계가 거부한다: `map_entries`는 `Map`만 받는다 | binding의 `invalid_argument_type` | binding의 것 | 읽음(`lib.rs`, `map_entries`). 그래서 Node host가 먼저 결과를 `Map`으로 바꾼다 |
| 결과 안의 일반 객체 | 경계가 map으로 변환한다(`describe_object_value`, `HostValue::PlainObject`. `host.rs:129`) | 없음 | 없음 | 읽음 |
| `Map` | 경계가 변환한다(`HostValue::Map`) | 없음 | 없음 | 읽음 |
| ±(2^53 − 1) 안의 bigint | 경계가 수로 변환한다(`describe`, `HostValue::Int`. `host.rs:86-101`) | 없음 | 없음 | 읽음 |
| 범위 밖의 bigint | 경계 | `data_number_range` | `number <n> is outside the safe range` | 읽음(`host.rs:88-106`). `<n>`의 글자는 실행 |
| 유한하지 않은 수 | 경계(`check_number`) | `data_number_not_finite` | `number is not finite` | 읽음(`bind.rs:36-38`) |
| 범위 밖의 수 | 경계(`check_number`) | `data_number_range` | `number <n> is outside the safe range` | 읽음(`bind.rs:40-45`). `<n>`의 글자는 실행 |
| 한계보다 깊은 list와 map | core(`data_model::check`, `bind_value`). 경계는 결과의 각 값을 0단계부터 센다 | `data_depth` | `lists and maps nest deeper than 64 levels` | 읽음(`bind.rs:51-57`). 세는 경계는 실행(깊이 규칙을 본다) |
| 짝 없는 surrogate를 가진 문자열 | 경계(`text`, `String::from_utf16`) | `data_invalid_utf8` | `a string is not valid Unicode text: <cause>` | 실행: `contracts/app.json`의 case `a_string_with_a_lone_surrogate_in_the_data_of_a_route_loader_fails_a_region_request`를 행 시작 전에 core에 대해 실행한다 |
| `Date` | 경계(`HostValue::Date`) | `data_unsupported_type` | `a date is not a template value` | 읽음(`host.rs:135`) |
| 함수 | 경계(`HostValue::Callable`) | `data_unsupported_type` | `a function is not a template value` | 읽음(`host.rs:136`) |
| 애플리케이션 객체 | 경계는 native object로 둔다(`host.rs:133`). core가 거부한다(`to_json_value`) | `data_unsupported_type` | `a native object has no JSON form` | 읽음(`bind.rs:231-235`, `data_model.rs:17-18`) |
| PHP `JsonSerializable` | HY-44.6은 통과시킨다. `value_in`은 모든 객체를 native object로 두며(`host.rs:133`) core는 그것을 거부한다 | — | — | 실행, H35.32-1에서: PHP 경계는 읽지 않았다 |

이 표에서 따르는 세 가지.

- 수의 message는 언어가 가진 대로의 수를 적는다. case의 context는 JSON text `{"n":9007199254740993}`이다. 이것을 double로 읽는 runner는 `9007199254740992`를, 정수로 읽는 runner는 `9007199254740993`을 준다. case에는 세 runtime에서 글자가 같은 수, 예를 들어 float `1e20`이 필요하거나, case가 message가 아니라 kind를 비교한다. 이것은 세 runner의 실행으로 정한다.
- `packages/ts/src/data/values.ts:15-17`의 `toValue`와 JS engine의 `bindValue`(`data-model.ts:40`)가 Node 서버를 떠나면, 경계가 안쪽의 일반 객체를 map으로, bigint를 수로 바꾼다. host에 남는 변환은 handler의 결과 자체 하나다. HY-44.4는 Node handler가 일반 객체나 `Map`을 돌려주게 하고 경계는 `Map`만 받으므로, `Page.loaderMap`(`page.ts:143-147`)은 일반 객체에 대해 `new Map(Object.entries(result))`가 되고, 결과가 map인지의 검사(HY-44.4, HY-44.5)를 가진다. 이것은 결과의 형태 검사이며 HY-44의 검사가 아니다.
- `page.ts:90`의 `JsonCodec.encode`는 끝난다.

검사의 시점. 값은 그 handler가 돌아올 때, 서버가 다음 handler를 호출하기 전에 실패한다. 증거: 경계는 host가 handler의 결과를 `next`에 줄 때 그것을 변환하므로, 표에 있는 경계의 모든 거부는 이미 그 시점에 일어난다. core만 거부하는 native object도 같은 시점에 실패해야 하며, 그렇지 않으면 데이터 모델 밖의 두 값이 두 시점에 실패한다. 이 트리는 context를 그 arm에서(`steps.rs:566`), 나머지를 `answer`에서(`steps.rs:735-738`) 검사한다. 공유 데이터와 로더와 액션의 데이터의 검사는 그것을 받는 arm으로 옮긴다. 지금 Node는 돌아올 때마다 검사하고(`page.ts:143-147`), PHP와 Python은 모든 로더 뒤에 검사한다(`Page.php:112`, `_page.py:136`). 시점을 관찰하는 case는 0개다(검색: handler가 데이터 모델 밖의 값을 돌려주고 기대 호출이 뒤의 handler를 적는 case. 찾지 못함). PHP와 Python은 H35.32-1에서 바뀐다.

깊이. 64단계 한계(VAL-20)는 handler가 돌려준 map을 1단계로 하여 세며, context, 공유 데이터, 각 영역의 데이터에 똑같이 적용한다. 증거: `data_model::check`는 각 map을 감싸지 않고 판정한다. 지금 서버는 감싼 값을 검사한다: `{shared, regions}`(`page.ts:90`, `Page.php:112`, `_page.py:136`)와 `{context}`(`packages/ts/src/app/context.ts:20`, `packages/php/src/App/Context.php:28`, `packages/python/src/polyspec/hyper/app/_context.py:22`). 그래서 지금은 64단계의 공유 map이나 context가 실패하고 63단계는 통과하며, 63단계나 64단계의 영역 map은 실패하고 62단계는 통과한다. 이동 뒤에는 각각 64단계가 통과하고 65단계가 실패한다. 깊이를 관찰하는 case는 0개다(검색: `contracts/app.json`과 `contracts/context.json`의 case의 `depth`와 `data_depth`). 지금 서버의 셈은 감싼 형태에서 끌어낸 것이며 실행으로 확인한다. JSON text에는 자기 깊이 한계가 없으므로(snapshot의 `to_json_value`에 단계 검사가 없다), 영역 데이터를 세 단계 안에 두는 JSON 응답이 문서가 통과하는 곳에서 실패하지 않는다.

case. 45개가 HY-44 또는 데이터 모델의 kind를 적는다. `contracts/app.json`의 42개와 `contracts/context.json`의 3개다. 상태가 바뀌는 것은 0개이고, message가 바뀌는 것은 3개다(위).

바꾸는 것. core(H35.32-4): arm에서의 검사. 나머지는 만들어져 있다. host: 세 `FAILURES` 표와 host의 검사가 끝난다. Node 서버는 한 변경에서, PHP와 Python은 H35.32-1에서 끝난다. statement: HY-44.10과 HY-44.11(아래). case: 세 message, 깊이의 case 하나, 시점의 case 하나.

## 질문 3 — Node 서버 `App.open`의 입력

규칙. Node 서버의 `App.open`은 PHP와 Python 서버처럼 매니페스트의 절대 경로와 서버 프로그램의 절대 경로를 받고, 그 디렉터리의 `templates/`, `reads.json`, `build.json`을 읽는다. option `templates`와 `build`는 끝난다. `Pages::open`은 매니페스트의 bytes를 받듯이 `reads.json`의 bytes를 받는다. 이유: 같은 파일을 읽는 세 서버는 같은 파일에서 실패하고, byte order mark가 있거나 잘렸거나 UTF-8이 아닌 `reads.json`은 core에서 한 번 판정된다.

현재 코드. Node는 template index와 AST 파일을 읽고 브라우저 패키지로 읽기 경로를 계산한다(`app.ts:320-335`). 필수 option은 `manifest`, `build`, `templates`, `handlers`, `timezone`이다(`APP_REQUIRED`, `app.ts:166`). PHP는 `{program}/templates`, `{program}/reads.json`, `{program}/build.json`을 열고(`App.php:81-83`, `packages/php/src/Page/Renderer.php:43-47`), Python도 같다(`packages/python/src/polyspec/hyper/page/_renderer.py:39-42`). `Pages::open`은 매니페스트를 bytes로, 읽기 경로를 값으로 받는다(`steps.rs:145-150`, `:156`, `:158`).

두 행이 먼저다.

- H31.4-2. `Templates::new`는 이름이 `hyper/data.tpl`인 source를 거부하고(`render.rs:96-100`), 빌드는 지금 그 파일을 `program/templates/`에 쓴다(`packages/cli/lib/program.mjs:35-36`). HY-31.9와 HY-31.10은 빌드가 `program/templates/` 아래에 사본을 쓰지 않고 core를 호출하지 않는 서버를 위해 `program/legacy/hyper/data.tpl`을 쓴다고 적으며, 행 H31.4-2가 그것을 구현한다(`docs/features.md`, 행 `legacy-data-template`). Node 서버는 그 뒤에야 프로그램을 연다.
- H35.34. 빌드의 `reads.json`은 contract 프로그램 39개 중 6개에서 key `[object Object]`를 담는다(체크리스트의 행 H35.34). Node 서버는 이동 뒤 그 파일을 읽으므로, CLI가 core로 읽기 경로를 계산할 때까지 그 프로그램을 틀리게 렌더한다.

바뀌는 것을 이름으로 적는다.

- case의 `only` 항목: 15개. `contracts/app.json`의 `opens`: `a_template_index_that_is_cut_fails_the_open`(Node, HY-48.11)은 없앤다. `a_reads_json_that_starts_with_a_byte_order_mark_fails_the_open`, `a_reads_json_that_is_cut_fails_the_open`, `a_reads_json_that_is_not_utf8_fails_the_open`(PHP와 Python, HY-73.23)과 `an_open_without_reads_json_names_it_as_the_first_missing_output`, `an_open_without_build_json_names_it_as_the_first_missing_output`, `an_open_without_templates_names_it_as_the_first_missing_output`(PHP와 Python, HY-48.10)은 제한을 잃고 Node 서버에서 실행된다. `contracts/arguments.json`의 `counts`: `app_open_without_build_is_refused`와 `app_open_without_templates_is_refused`(Node, HY-48.11)는 없애고, `app_open_without_program_is_refused`(PHP와 Python, HY-48.16)는 제한을 잃는다. `contracts/app.json`의 `cases`: 아래 HY-54.3의 다섯 case(PHP와 Python)는 H35.32-1에서 바뀐다.
- `contracts/interfaces.json`: `only` 항목 21개가 retire되는 id를 적는다. `concerns` 아래: `app.absolutePaths`, `app.templateIndex`, `app.readJsonFile`, `app.readJsonText`(HY-48.11), `app.routeTemplates`(HY-48.12), 그리고 `manifest`, `region`, `router`, `reads`, `renderer`(HY-54.3). `types` 아래: HY-48.11이 3개, HY-54.3이 4개, HY-48.16이 2개. `caseFiles` 아래: HY-73.23이 1개, HY-54.3이 1개. 항목 `appOptions`(`contracts/interfaces.json:15222`)는 member `build`, `templates`, `program`이 바뀐다.
- `contracts/protocol.json`과 그 문서 밖에서 retire되는 id를 적는 줄을 `grep -c`로 센 수: HY-54.3은 `contracts/app.json`(5), `contracts/interfaces.json`(10), `packages/ts/tests/steps/app.ts`(1), `packages/ts/tests/steps/manifest.ts`(1). HY-73.23은 `contracts/app.json`(3), `contracts/interfaces.json`(1), `packages/rust/src/reads.rs`(5), `steps.rs`(3), `read_paths.rs`(1), `packages/rust/tests/contracts.rs`(2), `docs/features.md`(1). HY-48.11은 `contracts/arguments.json`(2), `contracts/app.json`(1), `contracts/interfaces.json`(14), `app.ts`(1), `core-rules.ts`(1), `packages/ts/tests/build.test.ts`(2), `examples/board/node/main.ts`(1), `docs/operations/development.md`(1). HY-48.12는 `contracts/interfaces.json`(3), `app.ts`(2). 체크리스트, 계획, changelog도 이들을 적는다.
- option을 넘기는 곳: `examples/board/node/main.ts:82`, `tests/scripts/fixtures/upload-server/server.mjs:125`, `scripts/contract-programs.mts:121`과 `scripts/build-templates.mts:19`(Node 서버를 위해 `templates.index.json`을 쓴다), `scripts/fixture-program.mts`, 그리고 test step `packages/ts/tests/steps/client.ts`, `arguments.ts`, `hooks.ts`. `index:`는 test 파일 8개에서 넘긴다: `app.test.ts`, `support.ts`, `steps/app.ts`, `steps/context.ts`, `steps/functions.ts`, `steps/redis-sessions.ts`, `steps/representations.ts`, `steps/session-requests.ts`.
- `docs/operations/repository-rules.md:10`의 HR-34는 빌드의 출력을 나열한다. `public/assets` 아래의 `hyper/data.tpl`의 AST 파일은 이동 뒤 읽는 곳이 없으므로(브라우저는 그것을 결코 렌더하지 않는다, HYC-12.6), 그 규칙과 빌드가 함께 바뀐다.

## 질문 4 — 템플릿 함수의 두 번째 인자

규칙. 모든 서버의 option `functions`의 type은 생성된 binding의 형태다. 함수는 인자 목록과, 두 번째 인자로 환경, 곧 `timezone`과 `now`를 가진 값을 받는다. 어떤 host도 함수를 감싸지 않는다. 이유: binding은 모든 target에서 그 형태를 주며, host의 wrapper는 그 형태의 두 번째 구현이 된다.

현재 코드와 형태의 증거.

- template 명세는 한 문단에서 두 형태를 적는다(snapshot, `docs/spec/functions.md:182`). 첫 문장은 `HostFunction`과, `env`가 `timezone`과 `now`를 가진 `FunctionContext`를, PHP에는 배열을 적으며, 이것은 손으로 쓴 패키지다. 뒷부분은 Rust core가 interface contract의 형태로 함수를 받고 생성된 binding이 그것을 준다고 적는다: `Fn(&[Value], &Environment)`이며 `Environment`는 `timezone`과 `now`를 가진다.
- 생성된 선언(snapshot): `packages/ts/generated/index.d.ts:168-171`(`Environment`), `:204`와 `:487`(`(argument0: readonly unknown[], argument1: Environment) => unknown`). wasm 선언 `packages/ts/wasm/generated/index.d.ts:204`, `:474`도 같은 형태다. Python `packages/python/generated/python/polyspec/template/_native.pyi:42-43`(`Callable[[list[object], Environment], object]`). PHP stub `packages/php-ext/generated/polyspec_template.stub.php:93`은 class `Environment`를 선언하고 함수를 `\Closure`로 적으므로(`:266`), stub은 closure의 parameter를 적지 않는다.
- `engine.register`의 conformance case `a_host_function_by_its_name`(snapshot, `contracts/core-cases.json:216`, FUN-43)은 함수에 인자 `0`으로 목록을, `1`로 `{"timezone": "Z", "now": 0}`을 준다.
- hyper의 core도 같은 형태다: `PageFunction`(`steps.rs:112-113`), 그리고 `host_function`은 `context.env`를 넘긴다(`steps.rs:118-120`).
- JS engine은 `{env: {…}}`로 함수를 호출한다(snapshot, `packages/ts/render/chunk-6S74TFTF.mjs:1731`).

(a) Node 서버에서 바뀌는 것. option은 `@polyspec/template/render`의 `HostFunction`으로 `Record<string, HostFunction>`이라 적혀 있고(`app.ts:7`, `:129`), 그 두 번째 인자는 `{env: {…}}`다. 이것이 binding의 함수 type이 된다. 깨지는 것: `contracts/functions.json`의 case 4개 중 0개. test와 예제의 함수 0개. 두 번째 인자를 읽는 함수가 없기 때문이다: Node의 `suffix`(`packages/ts/tests/steps/functions.ts:14`), PHP의 것(`packages/php/tests/Support/Steps/FunctionsSteps.php:85`), Python의 것(`packages/python/tests/render/render_functions.py:16`. parameter를 선언하고 읽지 않는다), 브라우저 test의 것(`packages/client/tests/functions.test.ts`). `examples/board`는 함수를 등록하지 않는다(검색: `examples/board/{src,node,python,app,client}`의 `functions`, 0건). signature를 보여 주는 문서는 0개다(검색: `docs/operations`, `docs/features.md`, 패키지의 README에서 `HostFunction`과 `functions`). 이 저장소 밖에서 함수가 `context.env`를 읽는 Node 애플리케이션은 깨지며, changelog entry가 그것을 적는다.

(b) 브라우저. 브라우저 코드는 함수를 JS engine에 그대로 넘기므로(`packages/client/src/engine.ts:5-7`, `packages/client/src/hyper.ts:114`), 브라우저가 그 engine으로 렌더하는 동안, 곧 H35.33이 wasm binding으로 옮길 때까지 브라우저 함수는 `{env: {…}}`를 받는다. 그동안 환경을 읽는 함수는 signature가 둘이다. 함수 하나를 서버와 브라우저에 등록하고 환경을 읽는 애플리케이션은 둘 다 받도록 쓴다: `second.env ?? second`를 읽는다. 인자만 읽는 함수는 바뀌지 않는다. 비용은 그런 함수마다의 그 한 줄과, H35.33 뒤 그것을 없애는 일이다.

(c) HYC-24.2는 서버와 브라우저가 같은 이름을 등록한다고 적으며, 같은 signature를 적지 않는다. 바뀌는 것은 `createApplication`에 관한 절이다. 새 글은 아래의 HYC-24.9이며 형태는 HYC-24.10이 적는다. 둘 다 그동안에도 그 뒤에도 참이다.

확인하지 못함: PHP extension이 closure의 두 번째 인자로 넘기는 것(stub이 적지 않는다). H35.32-1이 같은 case로 확인한다.

## 질문 5 — `openPage`, `routeRequest`, `computePageHeaders`

규칙. Node 서버의 한 변경은 host의 값만 받는 `computePageHeaders`와 `pageTag`를 채택한다(`front.rs`, `page_headers`. `PageResponse`). `openPage`와 `routeRequest`는 채택하지 않으며, Node binding에 `Store`를 주는 session-store release 뒤의 행이 채택한다. 이유: `open_page`는 `&mut dyn Store`로 세션을 읽고(`packages/rust/src/opening.rs:86-90`), Node 서버의 세션은 host의 class다(`packages/ts/src/session/`). 그 채택은 세션 interface를 바꾸며, 이것은 렌더와 다른 변경이다.

세 서버의 현재. Node는 브라우저 router로 routing하고 host에서 협상하며(`app.ts:555-600`), header와 tag를 스스로 만든다(`page.ts:119-133`, `createHash`는 `:128`). PHP는 tag를 core에서 받는다(`Page.php:155`).

뒤의 행까지 host는 지금 계산하는 값으로 `PageInput`을 만든다: `csrf`(`app.ts:598`), `changed`(`RegionPlanner.changedTopics`, `page.ts:67`), `stored`(`session.kept`, `page.ts:155`), `keepCookie`(`page.ts:152`), `heldHash`. `RegionPlanner.select`는 끝난다. `PageRequest::new`가 영역을 선택한다(`steps.rs:477`).

case. 바뀌는 것은 0개다. 뒤의 행은 `contracts/routes.json`(34), `contracts/rest.json`(12), `contracts/representations.json`(70), `contracts/client.json`(63)의 case를 유지한다.

## 질문 6 — 부분, 읽기 경로, context 자리의 case가 실행되는 곳

규칙. test만을 위한 binding member는 없다. 부분의 Node step은 page render가 쓰는 `Pages.render_parts`와 `Pages.render_document`를 호출한다. `keepRead`, `withContext`, 템플릿 하나의 렌더는 binding에 더하지 않는다. core의 runner가 그 case를 가지며, 그 Node step은 없앤다. 이유: 이동 뒤 Node 서버는 읽기 경로나 context 자리의 구현을 갖지 않으므로, 그 Node step은 어떤 서버도 호출하지 않는 member를 통해 core의 코드를 test하게 된다.

core의 runner(`packages/rust/tests/contracts.rs`): `a_document_holds_its_parts_rendered_alone`(`:973`)은 `contracts/app.json`의 `parts`를 실행한다. `read_data_keeps_only_the_read_paths`(`:629`)와 `the_read_paths_of_a_template`(`:1998`)은 `contracts/reads.json`의 `cases`를, `the_read_paths_of_the_routes`(`:2020`)는 그 `routes`를 실행한다. `the_context_hash_and_its_place`(`:860`)는 context의 자리를 실행한다. 확인하지 못함: 마지막 test가 `contracts/context.json`의 `withContext`의 모든 항목을 읽는지.

40개 case 각각이 실행되는 곳(`contracts/interfaces.json`의 `caseFiles`의 `runners`, 그리고 위의 test):

| section | case | 전 | 한 변경 뒤 |
| --- | --- | --- | --- |
| `app.json` `parts` | 3 | PHP, Node(브라우저 코드), Python, 브라우저, core | PHP, Node(`render_parts`, `render_document`), Python, 브라우저, core |
| `reads.json` `cases` | 27 | PHP, Node(브라우저 코드), Python, 브라우저, core | PHP, Python, 브라우저, core |
| `reads.json` `routes` | 3 | 브라우저, core | 브라우저, core |
| `context.json` `withContext` | 7 | PHP, Node(host 코드), Python, 브라우저, core | PHP, Python, 브라우저, core |

Node runner는 40개 중 전에 37개, 뒤에 3개를 실행한다. core는 전에도 뒤에도 40개를 실행한다. H35.32-1은 같은 방식으로 두 section의 PHP와 Python step을 없앤다. 끝나는 Node 파일: Node runner에 대해 `packages/ts/tests/steps/reads.ts`, `steps/reads-cases.ts`, `tests/parse-template.ts`(브라우저 step은 자기가 import하는 것을 유지한다), 그리고 `steps/context.ts:221-222`의 step `withContext`.

브라우저 패키지의 읽기 경로. `packages/client/src/reads.ts:26`, `:33`, `:71`의 `routeReads`, `templateReads`, `keepRead`는 test 밖에서 Node 서버(`app.ts:331`, `page.ts:92`, `:98`)와 빌드(`packages/cli/lib/program.mjs:16`, `:41`)가 호출하고, 실행 중의 브라우저 코드는 호출하지 않는다(`packages/client/src` 검색: `reads.ts`와 `index.ts:14`의 export뿐). H35.34와 한 변경 뒤에는 test 밖의 호출자가 0이며, 아무것도 실행하지 않는 HY-73의 두 번째 구현이 된다. 그것을 없애는 행:

- H35.32-9: `@polyspec/hyper-client`에서 `routeReads`, `templateReads`, `keepRead`를 없앤다(`packages/client/src/reads.ts`, `index.ts`의 export). `reads.json`의 브라우저 step과 그 section의 runners의 항목 `browser`도 함께 없앤다. H35.34와 한 변경 뒤에는 어떤 코드도 이들을 호출하지 않고 core의 runner가 HY-73의 case를 가지기 때문이다. 의존: H35.34와 한 변경. Red: 패키지가 세 이름 중 하나를 export하는 동안 실패하는 `tests/scripts`의 test. 검증: `make hyper-test-scripts`.

## 질문 7 — `now`

규칙. 응답의 `now`는 Unix epoch 이후의 정수 초 하나다. core의 page 입력과 member `render_document`, `render_parts`는 그것을 interface의 정수로 가지므로 host는 소수를 줄 수 없고, core는 그 응답의 모든 렌더에 그 값을 준다. 이유: 문서는 여러 렌더이며, template 언어의 날짜 함수는 정수 초를 받는다.

현재 코드와 증거.

- `PageInput.now`는 `f64`이고(`steps.rs:328`), `answer`는 그것을 문서의 `Env` 하나에 준다(`steps.rs:822`). `render_document`와 `render_parts`는 `now: f64`를 받는다(`steps.rs:266`, `:282`). 이 type이 정수로 바뀐다.
- 날짜 함수는 정수 초를 받고 소수를 `runtime_type`으로 실패시킨다(snapshot, `packages/rust/src/functions/date.rs:143-144`, `functions/helpers.rs:85-89`). 그래서 소수 `now`에서 `{= date(now(), …)}`는 실패한다.
- 두 engine의 기본값은 정수 초다: Rust core는 `d.as_secs()`(snapshot, `packages/rust/src/render/engine.rs:98-101`), JS engine은 `Math.floor(Date.now() / 1e3)`(snapshot, `packages/ts/render/chunk-6S74TFTF.mjs:2258`).

세 서버의 현재. PHP는 렌더마다 `microtime(true)`를(`Renderer.php:169`), Python은 렌더마다 `time.time()`을 준다(`_renderer.py:114`). 소수이며 문서 하나의 렌더 사이에 다르다. Node 서버와 브라우저는 시간대만 넘기므로(`packages/client/src/response.ts:165`, `:186`, `:212`) JS engine이 렌더마다 정수 초를 쓴다.

case. `now`를 관찰하는 것은 0개다. 검색: `contracts/`의 모든 파일에서 `now(`는 5건이며 `protocol.json`에 4건, `interfaces.json`에 1건이고 모두 글자 `performance.now()`다. case의 템플릿에는 0건, `examples/board/templates`에도 0건이다. 날짜 함수는 `examples/board/templates/board/rows.tpl:24`와 `board/show.tpl:6`에서 저장된 시각과 함께 호출되며 시간대만 읽는다. 그래서 PHP나 Python의 출력이 바뀌는 case는 0개다. 템플릿이 `date(now(), …)`를 호출하는 PHP나 Python 애플리케이션은 지금 실패하며 H35.32-1 뒤에 렌더된다.

바꾸는 것. core: `PageInput`과 두 member의 정수 type. host: 각 host가 요청마다 한 번 자기 시계의 정수 초를 준다. statement: HY-14.3. test: `now`를 입력으로 주는 core case. 문서의 제목, 두 영역, 레이아웃이 `now()`를 호출하며, 문서는 각 자리에 그 값을 담는다. 어떤 test도 시계를 읽지 않는다(HR-89).

브라우저. 브라우저는 `now`를 넘기지 않으므로 JS engine이 렌더마다 브라우저의 시계를 읽는다(`response.ts:165`, `:186`, `:212`). 응답의 JSON 값은 `timezone`만 가진 `env`를 담고(`packages/rust/src/page.rs`, `json_value`, 첫 member), `decodeResponse`는 `env.timezone`을 읽는다(`response.ts:59`). 그래서 `now()`를 호출하는 템플릿에서는 서버의 문서와 문서 JSON의 브라우저 렌더가 다르며, 지금 HY-13.4는 그런 템플릿에 성립하지 않는다. 선택지:

- 서버가 `env`에 `now`를 보낸다. 브라우저는 그것을 자기 렌더에 주고, 둘은 같은 바이트를 만든다. navigation은 그 영역 응답의 `now`로 렌더한다. 비용: 모든 JSON 응답의 body가 초마다 바뀐다. body에서 계산하는 HY-53의 weak tag(`packages/rust/src/etag.rs`, `page_tag`)가 초마다 바뀌며, tag가 `env.now`를 빼지 않는 한 304가 더 나오지 않는다. case의 12줄이 `"env"`를 담고(`contracts/app.json` 5, `contracts/context.json` 7), 기대하는 모든 JSON body가 바뀐다.
- 브라우저가 응답마다 한 번 시계를 읽어 그 값을 그 응답의 모든 렌더에 준다. 그러면 브라우저에서도 서버처럼 응답 하나가 `now` 하나를 가진다. 두 값은 다르므로 `now()`를 호출하는 템플릿의 바이트는 다르다. 비용: `packages/client/src/response.ts`의 변경이며 wire는 바뀌지 않는다.
- 변경 없음: 바이트가 다르고, 브라우저 응답 하나의 렌더가 초를 넘으며 달라질 수 있다.

사실은 두 번째 선택지를 가리킨다. 첫 번째는 `now()`를 호출하는 템플릿을 위해 모든 페이지의 HY-53의 304를 깨뜨리며, 이 저장소에는 그런 템플릿이 없다. 그러면 HY-13.4는 같은 환경에 대해 성립하고, 환경의 `now`는 렌더하는 쪽의 시계다. HY-14.3이 서버에 대해 그것을 적고, 브라우저의 행이 브라우저에 대해 적는다.

## 질문 8 — engine이 둘일 때 HY-13.4의 증거

규칙. 브라우저가 Rust core로 렌더할 때(H35.33)까지 HY-13.4는 세 가지에 기댄다: template release가 JS engine과 Rust core에 대해 실행하는 template 언어의 conformance case, `make parity`, 그리고 이 저장소가 받는 template의 npm 패키지, crate, PHP extension, wheel이 한 release라는 조건이다. 이유: 그때 모든 서버는 Rust core로, 브라우저는 JS engine으로 렌더하므로, 같은 바이트는 한 release의 두 engine의 같음과 조립의 같음이다.

현재 코드. `make parity`(`Makefile:530`)는 `scripts/check-parity.mts`를 실행한다. PHP 서버의 문서를 요청하고, 문서 JSON을 브라우저 코드로 렌더해 같은 바이트를 요구한다(`check-parity.mts:1-10`). `make server-parity`(`Makefile:533`)는 Node와 Python 서버의 응답을 PHP 응답과 비교한다(`check-parity.mts:12-16`).

그 조건은 지금 성립하지 않는다. `package.json:44`와 `composer.json:33`은 release 0.0.27을, `packages/rust/Cargo.toml:35`는 branch를 받는다. `tests/scripts/template-pins.test.mts`(`make hyper-test-scripts`)는 npm 패키지, Composer 패키지, wheel을 한 version에 대해 검사하며(`:4`, `:17-18`, `:66`), `Cargo.toml`은 읽지 않는다(검색: 그 파일의 `Cargo`, 0건). 첫 release의 tag 고정이 crate를 고정하고, 그 test가 crate를 얻는다.

한계. `make parity`는 `examples/board`의 템플릿을 다룬다. conformance case는 언어를 다루고 hyper의 조립은 다루지 않는다. 조립은 브라우저 step과 core가 실행하는 `parts` case가 다룬다(질문 6). 두 engine은 template 명세가 거부하는 입력과 `now()`(질문 7)에서 다르다.

case. HY-13.4를 적는 것은 0개이고, 바뀌는 것도 0개다.

## statement

retire되는 id는 그 rule의 목록 `retired`에 들어가고, 새 statement는 쓰이지도 retire되지도 않은 다음 번호를 받는다. 이 트리의 `contracts/protocol.json`의 statement와 목록 `retired`에서 계산한 번호: HY-54.23, HYC-24.9, HY-132.10, HY-48.17, HYC-12.10, HY-128.13, HY-73.34, HY-14.3, HY-44.10. HYC-24.7과 HYC-24.8은 쓰이고 있고, HY-128.6부터 HY-128.12까지와 HY-44.8은 retire되어 있다.

### retire되는 statement

HY-54.3, 현재: "It renders a document as the browser renders the document JSON value (HY-12, HY-31, HY-38), with the browser code and the template files of `hyper build` (HR-34), and embeds its data when the reply asks for it (HY-92)." 후속 없이 retire된다. 이것은 HY-54.2 "It differs from the PHP server only as follows" 아래에 있으며, 이동 뒤 Node 서버의 문서는 요청이 관찰하는 어떤 것에서도 다르지 않다.

HYC-24.2, 현재: "The `App` of every server takes the same map as its option `functions` (HY-106) when the application opens, and the Node server registers it through `createApplication` of the browser code, so the server and the browser register the same names (template FUN-47); a registration that fails (template FUN-44) fails the open."
- HYC-24.9 (en): "The `App` of every server takes a map from names to functions as its option `functions` (HY-106) when the application opens and registers each entry in its template engine; an application gives the server and the browser the same names (template FUN-47), and a registration that fails (template FUN-44) fails the open."
- HYC-24.9 (ko): "모든 서버의 `App`은 애플리케이션을 열 때 이름에서 함수로 가는 map을 option `functions`(HY-106)로 받아 각 entry를 자기 template engine에 등록한다. 애플리케이션은 서버와 브라우저에 같은 이름을 주며(template FUN-47), 등록이 실패하면(template FUN-44) 열기가 실패한다."
- HYC-24.10 (en): "A function of a server receives the list of its arguments and, as its second argument, the environment of the render, a value with `timezone` and `now`; a function of the browser receives that environment as the member `env` of its second argument while the browser renders with the JS engine."
- HYC-24.10 (ko): "서버의 함수는 인자 목록과, 두 번째 인자로 렌더의 환경 곧 `timezone`과 `now`를 가진 값을 받는다. 브라우저의 함수는 브라우저가 JS engine으로 렌더하는 동안 그 환경을 두 번째 인자의 member `env`로 받는다."

HY-132.8, 현재: "The Node server, which runs the checks of the browser code at open, raises a failure of them as the class of its binding of the same category with the same kind, status and message, so that its open fails with the `HyperValueError` of the binding of kind `invalid_application`, as the PHP and Python servers fail for the same input; an open that raises the class of the browser code, or an error without a kind, fails this rule." 한 변경에서 후속 없이 retire된다. HY-132.2가 모든 서버의 오류의 class를, HY-106.21이 실패하는 open의 kind를 build 파일의 `invalid_build`까지 적으므로, 후속은 그것을 반복한다. 조건: open은 브라우저 패키지의 어떤 코드보다 먼저 `Pages.open`을 호출하므로 core가 매니페스트를 판정하고(`steps.rs:156`), host가 routing을 위해 유지하는 브라우저 router는 core가 받아들인 매니페스트에서 만든다. 변경 전에 실행으로 확인할 것: `contracts/manifest.json`의 `checks` 중 `checkManifest`가 거부하는 모든 매니페스트를 core가 거부한다. 하나라도 그렇지 않으면 HY-132.8과 변환 `App.bindingError`(`app.ts:255-259`)는 질문 5의 행까지 남는다.

HY-48.11, 현재: "Node: `App.open` reads the manifest, the template index, the template files and the build id file by absolute paths, the last from its option `build`, the absolute path of `client/build.json` of the build output (HY-125); a missing file fails with the error that names its path."
- HY-48.17 (en): "Node: `App.open` reads the manifest by the absolute path of its option `manifest`; the program directory of its option `program`, an absolute path, holds `reads.json`, `build.json` and the directory `templates`, and `App.open` fails with a `HyperValueError` (HY-106) that names the absolute path of the first missing one."
- HY-48.17 (ko): "Node: `App.open`은 매니페스트를 option `manifest`의 절대 경로로 읽는다. 절대 경로인 option `program`의 프로그램 디렉터리는 `reads.json`, `build.json`, 디렉터리 `templates`를 담으며, `App.open`은 처음으로 없는 것의 절대 경로를 밝히는 `HyperValueError`(HY-106)로 실패한다."

HY-48.12, 현재: "Node: `App.open` fails when the template index is not a template index or does not hold a template of a route." 후속 없이 retire된다. 이동 뒤 어떤 서버도 template index를 읽지 않으며, `hyper build`가 쓴 프로그램은 매니페스트가 지정한 모든 템플릿을 담는다(HY-48.3). `Pages::open`에서의 이름 검사는 세 서버의 규칙이 된다. 그것은 이 이동의 일부가 아니며, PHP와 Python은 지금 그것을 갖지 않는다.

HYC-12.6, 현재: "The browser never renders `hyper/data.tpl`, because a client-rendered document embeds no data (HY-31); the Node server, which renders it, checks that the index holds it."
- HYC-12.10 (en): "The browser never renders `hyper/data.tpl`, because a client-rendered document embeds no data (HY-31)."
- HYC-12.10 (ko): "클라이언트 렌더 문서는 데이터를 내장하지 않으므로(HY-31) 브라우저는 `hyper/data.tpl`을 결코 렌더하지 않는다."

HYC-12.9, 현재: "The Node server, which renders every page, reads every template of the index when it opens." 후속 없이 retire된다. Node 서버는 index를 읽지 않으며, 서버가 템플릿을 parse하는 때는 빌드의 프로그램에서 관찰되지 않는다. 그 프로그램은 parse되지 않는 템플릿을 담지 않는다.

HY-128.4, 현재: "The Node server renders its documents with that same code (HY-54) from the context map, and puts the member `context` with `hash` and `value` into the value that it renders only for a document that embeds its data." 후속 없이 retire된다. HY-124.7, HY-125.11, HY-128.5가 모든 서버에 대해 같은 것을 적는다.

HY-73.23, 현재: "The build writes the read paths of every route to `reads.json` of the server program (HY-48), and the Node server computes them with the browser package when the application opens."
- HY-73.34 (en): "The build writes the read paths of every route to `reads.json` of the server program (HY-48)."
- HY-73.34 (ko): "빌드는 모든 라우트의 읽기 경로를 서버 프로그램의 `reads.json`(HY-48)에 쓴다."
- 서버가 애플리케이션을 열 때 그것을 읽는다는 것은 HY-73.30이다.

### 새 statement

- HY-14.3 (en): "The `now` of the environment of a response is one whole number of seconds since the Unix epoch, which the page input of the core holds, and every render of the response gives `now()` that value."
- HY-14.3 (ko): "응답의 환경의 `now`는 core의 page 입력이 담는 Unix epoch 이후의 정수 초 하나이며, 그 응답의 모든 렌더는 `now()`에 그 값을 준다."
- HY-44.10 (en): "The limit of 64 levels of lists and maps (VAL-20) counts from the map that a handler returns, which is level 1, for the context, the shared data and the data of each region alike."
- HY-44.10 (ko): "list와 map의 64단계 한계(VAL-20)는 handler가 돌려준 map을 1단계로 하여 세며, context, 공유 데이터, 각 영역의 데이터에 똑같이 적용한다."
- HY-44.11 (en): "A value outside the data model fails the request when its handler returns, before the server calls the next handler."
- HY-44.11 (ko): "데이터 모델 밖의 값은 그 handler가 돌아올 때, 서버가 다음 handler를 호출하기 전에 요청을 실패시킨다."

### id를 유지하는 statement

HY-132.7(브라우저 코드의 class)은 의미를 유지한다. 브라우저 코드는 parity 검사가 호출하는 `checkManifest`, `checkTemplateIndex`, `createApplication`을 유지한다(`check-parity.mts:68`). H35.32-9가 `routeReads`를 없애면 그 네 검사의 목록은 더 없는 함수를 적으며, 그때 이 statement를 셋을 나열하는 것으로 바꾼다. 그것은 H35.32-9에 속한다.

HY-48.1(서버는 "with the template engine of its runtime, from the outputs of the build" 렌더한다)은 의미를 유지한다. 이동은 Node 서버를 그 출력 목록에 맞게 만든다.

HY-13.4("the same bytes")는 의미를 유지한다. 그 증거와 `now()`에 대한 한계는 질문 7과 8에 있다.

HY-14.1("Server and browser render with the same environment")은 서버가 보내는 시간대(HY-14.2)에 대해 의미를 유지한다. `now`에 대해서는 지금도 이동 뒤에도 성립하지 않는다(질문 7).

HY-13.7은 PHP와 Python 서버가 공유 값을 읽는 횟수를 적는다: 문서는 두 번, 데이터를 내장하는 문서는 세 번, JSON 응답은 두 번. `contracts/app.json`의 다섯 case가 그 수를 고정한다: `a_document_reads_a_shared_value_twice_whatever_the_number_of_its_renders`(2), `a_document_json_reads_a_shared_value_twice`(2), `a_region_json_reads_a_shared_value_twice`(2), `a_document_of_a_route_with_a_route_region_reads_a_shared_value_twice`(2), `a_document_that_embeds_its_data_reads_a_shared_value_three_times`(3). 이들은 retire되는 문장 HY-54.3 아래에서 PHP와 Python으로 제한되어 있으므로, 한 변경에서 그 `only` 항목에 다른 문장이 필요하다. H35.32-1에서는 경계가 값을 변환할 때 한 번 읽으므로 수가 바뀌고, HY-13.7은 새 수를 적는 후속과 함께 retire된다. H35.32-1이 그 수를 잰다.

## 작업의 순서

H35.32-7과 H35.32-8은 한 변경이다. Node 서버에는 한 입력으로 열고 다른 engine으로 렌더하는 상태가 없다.

| 행 | 의존 | Red: 관찰한 동작이 실패하는 test |
| --- | --- | --- |
| H35.32-3 | 질문 1 | Node binding의 test(`tests/scripts/node-core.test.mts`): 액션이 있는 JSON 요청의 `PageRequest`가 `csrf`를 두 번째로 가린 값으로 둔 액션 입력을 받고, test는 답의 JSON text의 `shared.csrf`가 그 값임을 단언한다. 지금은 그 member가 무시되어 답이 첫 값을 담는다. |
| H35.32-4 | 질문 2 | core case: shared handler가 애플리케이션 객체를 돌려주면 `next`가 주는 다음 step은 route loader의 호출이 아니라 실패여야 한다. 지금 `next`는 loader를 요청하고 `answer`에서 실패한다. 두 번째 case: 64단계의 공유 map은 문서로 답하고 65단계는 `data_depth`로 실패한다. |
| H35.32-5 | 없음 | 만들어짐: `check_function_entry`, HYC-24.7, HYC-24.8. |
| H35.32-6 | 질문 6 | 만들어짐: `render_document`와 `render_parts`. 남은 것은 `now`의 정수 type(질문 7)이다: `now`를 `1.5`로 주는 Node binding의 test는 정수가 아닌 값에 대한 binding의 kind로 실패해야 한다. 지금은 문서가 렌더된다. |
| H35.32-7과 H35.32-8, 한 변경 | 질문 1부터 7. H35.32-3, H35.32-4. H31.4-2. H35.34. statement가 먼저 | JS engine이 어떻게 되든 성립하는 Red 셋. (1) template 데이터 모델의 message를 가진 `contracts/context.json`의 세 case는 Node 서버의 표가 message를 쓰는 동안 Node 서버에서 실패한다. (2) open `an_open_without_reads_json_…`, `…_build_json_…`, `…_templates_…`와 세 `a_reads_json_…`를 Node 서버에 실행하면 `App.open`이 index를 받는 동안 실패한다. (3) 두 번째 인자의 `timezone`을 돌려주는 `contracts/functions.json`의 새 function kind는 engine이 `{env: {…}}`를 주는 Node 서버에서 실패한다. |
| H35.32-9 | H35.34. 한 변경 | `@polyspec/hyper-client`가 `routeReads`, `templateReads`, `keepRead` 중 하나를 export하는 동안 `tests/scripts`의 test가 실패한다. |
| H35.32-1 | H35.32-3, H35.32-4. 질문 2, 4, 7 | PHP와 Python: 시점의 case(실패하는 공유 값 뒤의 loader가 호출되지 않는다)는 그들이 모든 로더 뒤에 검사하는 동안 실패한다. `contracts/context.json`의 세 message는 그들의 표가 그것을 쓰는 동안 실패한다. test가 `now`를 주고 템플릿에 `{= date(now(), 'Y')}`를 둔 case는 그들이 소수를 주는 동안 `runtime_type`으로 실패한다. PHP: case `a_json_serializable_object_in_shared_data_passes_…`(3)는 core를 통해서도 통과해야 한다. |
| 뒤의 행(질문 5) | session-store release. 한 변경 | 맞지 않는 form 토큰을 가진 POST의 Node HTTP test가 session store의 호출을 기록한다. `open_page`가 하는 호출의 순서(flash, 그다음 토큰)는 host가 다를 때에만 지금 host의 순서와 다르므로, Red는 그 순서를 고정하는 `contracts/session.json`의 case를 기록하는 store로 실행한 것이다. 확인하지 못함: 그런 case가 있는지. 그 행이 찾거나 더한다. |

PHP와 Python의 이동이 더하는 것. `JsonSerializable`은 HY-44.6을 통과하며, 지금은 `DataModel::plain`이 렌더 전에 그것을 그 값으로 바꾼다(`packages/php/src/Data/DataModel.php:43-56`, `Renderer.php:92-93`). `value_in`은 모든 객체를 native object로 두며(snapshot, `host.rs:133`) core는 그것을 거부한다. 변환은 PHP binding의 경계에 속한다. 그 경계는 member `json_serializable`을 가진 객체를 기술한다(Node 경계는 그것을 `false`로 둔다, `lib.rs`, `describe_object_value`). PHP 경계가 그런 객체를 그 값으로 바꾸는지는 H35.32-1을 시작하기 전에 위의 세 case로 확인한다. 이동은 또 `Renderer.php`와 `_renderer.py`, 렌더마다 읽는 시계, `FAILURES` 표, 질문 6의 두 section의 step을 끝낸다.

## 위험과 확인하지 못한 것

- 유지 값의 fallback. `render_document`는 문서에 유지 값이 있으면 어떤 실패 뒤에도 fallback을 실행한다(`render.rs:365`). 브라우저 코드는 없는 템플릿을 다시 던진다(`packages/client/src/response.ts:106`, `:115`). 브라우저가 그것을 불러와 다시 렌더하기 때문이다. 서버에서는 모든 source가 올라와 있으므로 없는 템플릿은 마지막 렌더(`render.rs:403`)를 같은 오류로 실패시키며, 요청은 둘 다 500으로 답한다.
- 템플릿은 첫 렌더에서 parse된다(`steps.rs:143-144`). 지금의 PHP와 Python도 그렇다. 빌드의 템플릿은 parse된다(HY-48.3).
- `decodeResponse`(`page.ts:136`)는 브라우저 router가 서버의 라우트를 선택하는지도 검사했다. 서버는 그 검사를 자신에게 더 실행하지 않는다.
- 브라우저 패키지는 질문 5의 행까지 Node 서버의 routing(`app.ts:573`), `stripBasePath`, 매니페스트 type을 유지한다. `keepRead`, `keptPaths`, `Context.withContext`, `Context.member`는 페이지에 대해 끝난다(`steps.rs:740`, `:756`, `:762`, `:778`, `:810`).
- 두 engine은 template 명세가 거부하는 입력에서 다르다. Node 서버는 그런 템플릿에서 답이 바뀌며, 한 변경의 changelog entry가 그 입력을 적는다.
- 확인하지 못한 것은 각각 쓰이는 곳에 적었다: runtime마다의 message 안 수의 글자, 지금 서버의 깊이 셈, 경계를 지나는 짝 없는 surrogate, `JsonSerializable`과 closure의 두 번째 인자에 대한 PHP 경계, `checkManifest`가 거부하는 모든 매니페스트를 core가 거부하는지, handler가 저장된 유지 값을 쓸 수 있는지, `the_context_hash_and_its_place`가 `withContext`의 모든 항목을 읽는지, 빌드가 받는 template crate의 revision.
