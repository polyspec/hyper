# 개발

[English](AGENTS.md).

## 문서

- 모든 문서는 같은 정보를 가진 `.ko.md` 파일을 가진다. 같은 변경에서 둘 다 수정한다.
- 주제마다 정본 문서를 하나 둔다.
  - 프로토콜 계약: `docs/spec/`
  - 구현과 검증 상태: `docs/features.md`
  - 계획한 작업, 검증 명령, 완료 여부: `docs/plans/execution-checklist.md`. 모든 변경은 그 안의 작업 하나에 속하고, 작업은 시작하기 전에 추가한다.
  - 현재 절차: `docs/operations/`
  - 실제 변경과 검증 결과: `CHANGELOG.md`
- 문서는 현재 동작을 서술한다. 방향이 바뀌면 명세부터 수정하고 구현되지 않은 부분을 표시한다.
- 동작 변경, 관련 문서, 기능 상태 행, 변경 기록은 하나의 변경이다.
- `make docs-check`는 문서 쌍, 링크, 동일한 코드 블록을 검사한다. 내용의 정확성은 코드와 테스트를 읽어 확인한다.

## 구현

- 하위 호환성을 유지하지 않는다. 호환 계층, 폴백, 마이그레이션을 추가하는 대신 오래된 경로를 제거한다.
- 현재 요구사항을 완전히 충족하는 가장 단순한 구현을 사용한다. 불확실한 미래를 위한 추상화, 설정, 간접 계층을 추가하지 않는다.
- 관심사를 모듈로 분리한다. 책임이 둘 이상인 파일은 분리한다.
- 임시 스크립트나 임시 폴더를 사용하지 않는다. 모든 검사는 Makefile 타깃, `scripts/` 아래 스크립트, 커밋된 테스트 중 하나이며 멱등하다.
- 결과는 tree에만 의존한다. 저장소 밖의 모든 입력은 추적 파일에 밝히고 사용 전에 확인한다. 다른 저장소는 branch로(`config/template.json`, HY-80), build 출력은 그 입력의 hash로 확인한다. 불일치는 기대값과 실제값을 밝히며 실패한다. 어떤 검사도 다른 checkout의 working tree를 그때의 상태 그대로 읽지 않는다.
- build하거나 검사하는 모든 도구는 추적 파일에 pin한 정확한 release이며 사용 전에 확인한다(HY-81). `.node-version`, `packageManager`, `config/toolchain.json`, template 복사본의 `rust-toolchain.toml`이다. 도구는 모든 checkout과 session이 공유하는 machine이 아니라 checkout(`var/tools`)에 설치한다. download는 pin한 digest가 맞을 때만 사용하고, 어떤 도구도 처음 사용할 때 다른 도구를 설치하지 않는다. recipe나 script는 checkout의 도구를 절대 경로로 시작한다. make는 shell 문법이 없는 recipe 줄을 자기 `PATH`에서 찾기 때문이다.
- 어떤 결과도 live service나 시간에 의존하지 않는다(HY-89). 어떤 검사도 registry나 다른 live service에 질의하지 않고, 설치는 audit 없이 lock을 따르며, test는 event나 주입한 clock으로 event의 순서를 정하고 timer를 경쟁시키지 않으며, run의 서버는 system이 정하고 보고하는 port에서 listen한다. 서버 시작 같은 긴 작업은 시간 제한 없이 기다리며 진행을 출력한다.
- 다른 process가 다시 쓰이는 동안 읽을 수 있는 출력은 없는 파일이나 일부만 쓰인 파일 없이 publish한다(HY-82). 파일은 rename 한 번으로(`writeFileAtomic`), 디렉터리는 쓰는 process의 staging 디렉터리에서 파일 단위로(`scripts/publish.mjs`) publish한다. 어떤 recipe도 출력을 지운 뒤 쓰지 않는다. package manager 설치나 full run처럼 두 process가 동시에 쓸 수 있는 자원은 `scripts/holder-lock.mjs`의 lock으로 잡고, port, database, 임시 디렉터리 같은 run의 다른 모든 자원은 그 run만의 것이다.
- 검사는 run 맥락과 pin하지 않은 release가 바꾸지 않는 형태로 tool 출력을 읽는다(HY-83). make dry run은 `tests/scripts/make-dry-run.mjs`의 `dryRun`으로, tool에 machine이 읽는 형태가 있으면 그것을, 다른 text는 HY-81이 pin한 tool의 것만 읽는다.
- 검사는 무언가를 검사했을 때만 통과한다(HY-84). 실행된 test가 없는 test run, 아무것도 고르지 않는 선택이나 목록, top level에서 await하는 node test 파일은 실패한다. 실패는 보고되는 곳에서 기대한 것, 일어난 것, 원인을 보이는 출력을 밝힌다. timeout은 step을 밝히고, full run은 실패한 각 target의 마지막 줄들을 출력한다.
- test는 자기가 읽는 것을 만든다(HY-85). fixture의 추적 파일은 자기 임시 디렉터리에 복사하고, 설치나 build처럼 다른 target이 쓰는 입력은 test가 읽기 전에 `requireBuilt`로 그 target과 함께 밝힌다. build 출력은 자기 checkout의 절대 경로를 담지 않고, cargo target 디렉터리 같은 어떤 build 디렉터리도 checkout 사이에 공유하지 않는다.
- 여러 검사의 run은 모든 검사를 끝까지 실행한 뒤 실패하고, 실패한 검사를 각각 밝힌다(HY-86). recipe는 `$(call check,...)`와 `$(checks_result)`를 쓰고, 검사하는 여러 goal의 make는 `-k`로 실행하며, 첫 CI step 뒤의 step은 `if: ${{ !cancelled() }}`로 실행한다. 앞 step의 출력을 읽는 step만 그 실패에서 멈춘다.
- run의 어떤 process나 파일도 run보다 오래 남지 않는다(HY-87). run은 서버와 임시 디렉터리를 만들 때부터 가지며 끝, 실패, SIGINT, SIGTERM에서 멈추고 기다리고 지운다. test는 디렉터리를 쓰는 process가 끝난 뒤에만 그 디렉터리를 지운다.
- 추적하는 모든 경로는 `scripts/owner-checks.json`에 owner를 가진다(HY-88). 경로를 더하는 변경은 그 owner 규칙을 더하고, 저장소의 일부를 복사하는 test는 그 일부가 가져오는 것도 복사한다.
- 각 패키지 안에서 코드와 테스트를 별도 디렉터리에 둔다.
- 결함은 재현하는 실패 테스트를 추가하고, 코드를 수정하고, 테스트를 유지하는 절차로 처리한다.
- 저장소 상대경로를 사용한다. 외부 입력 경로는 명시적으로 받는다.
- symbolic link를 사용하지 않는다. package manager는 이 저장소의 package를 포함한 모든 의존성을 사본으로 설치하고 bin link를 만들지 않으며, 이 저장소나 template 복사본의 package의 바뀐 사본은 파일 단위로 publish한다(`scripts/publish.mjs`, HY-82). recipe는 도구를 그 package의 파일로 실행한다(HY-79).
- 템플릿 문법과 렌더 규칙은 template 언어에 속한다. 이 저장소는 그 규칙을 사용하며 바꾸지 않는다.

## 결정과 수용 규칙

- 구현을 바꾸기 전에 불변 조건, 수용 조건, 실패 조건을 `docs/spec/protocol.md`에 정의한다. 테스트는 규칙 식별자(`HY-n`)를 인용한다.
- 실패하는 구현을 통과시키려고 수용된 조건을 약화, 생략, 제거하지 않는다. 구현을 수정한다.
- 같은 영역의 서버 렌더와 브라우저 렌더는 같은 바이트를 출력해야 한다. 이 불변 조건의 근거는 `make parity`다.
- 선언한 런타임 범위를 지원하는 최신 안정 의존성 버전을 사용한다. 정확한 버전 고정은 모두 그 이유와 해제 조건을 `docs/operations/dependencies.md`에 기록한다.

## 변경과 기록

- 커밋 메시지, 주석, 문서, 번역은 직접적인 언어로 쓴다.
  - 동작 이름을 사용한다.
  - 주체와 대상을 명시한다.
  - 원인은 한 문장으로 설명한다.
  - 비유와 구어체를 사용하지 않는다.
  - 영어와 한국어에 같은 정보를 제공한다.
- 커밋 메시지는 영어로 `type(scope): Subject (#task)`, 빈 줄, 그리고 무엇을 왜 바꿨는지 적고 72자에서 줄을 바꾸는 본문으로 쓴다. type은 `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore` 중 하나다. 제목은 50자 이내이고, 대문자로 시작하며, 명령문이고, 마침표로 끝나지 않는다.
- `main`에서 바로 작업해도 된다. agent를 쓰거나 상황에 따라 branch나 worktree를 쓰면 이름은 `{type}/{shortname}-{task id}`와 `{project}-{shortname}-{task id}`이고, `main`에 합친 즉시 지운다.
- `main`에 합칠 수 없는 test code는 커밋 전에 지우거나, 남길 가치가 있으면 cherry-pick한다. 바로 지울 수 없으면 checklist 하위 항목에 지우는 조건과 함께 기록한다.

## 필수 검사

- 커밋 전에는 변경의 Red test와 Green test, 바뀐 모든 경로의 owner를 실행하는 `make owner-check`(`scripts/owner-checks.json`, HY-88), 그리고 `make docs-check`를 실행한다. 수정마다 더 넓은 검사를 실행하지 않는다.
- `docs/plans/execution-checklist.md`에서 작업을 `[o]`로 바꾸기 전에 커밋한 tree에서 그 작업의 verification command를 실행한다. Verification column에는 `make check`가 아니라 그 작업을 소유한 명령을 적는다. 이미 `[o]`인 행은 자기 명령을 그대로 둔다.
- `make check`는 활성 작업이 모두 끝났을 때 정확히 한 번 실행하고, 수정마다 또는 작업마다 실행하지 않는다. guard `scripts/full-run.mjs`가 어떤 단계보다 먼저 이를 강제한다. 작업이 `[~]`이거나, 추적 파일의 변경이 커밋되지 않았거나, `var/full-run.json`이 현재 tree의 전체 실행을 기록하고 있으면 `make check`는 거부된다. `make rerun-failed`는 현재 tree에서 통과하지 못한 target만 다시 실행한다(`docs/operations/development.md`). `docs/features.md`에서 기능을 implemented로 표시하는 것은 그 실행이 통과한 뒤에만 한다.
- push는 push하는 commit에도 working tree에도 `docs/plans/execution-checklist.md`의 `[~]` 작업이 없을 때만 한다. 추적하는 pre-push hook `.githooks/pre-push`가 `node scripts/push-gate.mjs hook`을 실행하고, 이 script는 그런 push를 거부하며 활성 ID를 작업과 함께 밝힌다. 모든 `make` 실행이 `core.hooksPath`를 `.githooks`로 설정한다. `make hooks`는 이를 명시적으로 설정하고, `make docs-check`가 실행하는 `make hooks-check`와 전체 실행의 guard는 그것이 설정되지 않았으면 실패한다. GitHub에서는 `.github/workflows/push-gate.yml`의 job `push-gate`가 모든 push와 pull request에서 `node scripts/push-gate.mjs commit <sha>`를 실행하고, push가 hook을 거치지 않았어도 그런 commit에 대해 실패한다(`docs/operations/development.ko.md`).

## Checklist

- 이 저장소의 checklist는 `docs/plans/execution-checklist.md` 하나다. 작업을 하위 항목으로 나누거나 작업을 추가하고, 다른 checklist를 만들지 않는다. 저장소마다 자기 checklist를 따로 운영한다.
- 작업 상태는 네 가지다. `[ ]` 대기, `[~]` 진행 중, `[o]` 완료, `[!] cause: <원인>; retry: <조건>` 일시 우회. `make docs-check`는 다른 상태를 받지 않는다.
- 작업 상태 표시는, Markdown task list가 쓰는 대괄호 안의 x나 대문자 X도, checklist에서 작업 행 마지막 칸 첫머리의 상태로만 쓴다. checklist에는 범례가 없고 문장은 상태를 말로 적는다. `make docs-check`는 다른 표시에 대해 실패하고 그 file, 줄, 열을 적는다.
- checklist에는 제목과 작업 table만 두며, `make docs-check`는 다른 줄에 대해 file, 줄, 열을 적고 실패한다. 각 웨이브는 웨이브 이름이 `docs/plans/waves.ko.md`의 section `wave-<n>`을 link하는 `## 웨이브 <n> — <제목>` 제목과 그 뒤의 ID, 작업, Verification, 상태 열을 가진 table이다. 작업 ID 형식은 `H<웨이브>.<번호>`이며 작업 행은 ID로 시작한다. `docs/plans/waves.md`가 웨이브마다 의존과 배경을 적고, 웨이브는 의존한다고 적은 웨이브가 완료되면 시작한다.
- 작업은 명세를 먼저 바꾸고, 규칙 식별자를 인용하는 실패하는 테스트를 추가한 다음, 구현을 바꾼다.
- `[!]`는 이 작업을 우회하지 않으면 다음 작업을 진행할 수 없을 때만 쓴다. 재시도 조건이 성립하면 승인을 기다리지 않고 재개한다. `[!]`는 완료가 아니다. 감사는 `[!]` 작업과 그 원인·재시도 조건만 다루고, 관련 없는 full test를 반복하지 않는다.
- 새 문제는 새 작업으로 올린다. `[o]` 작업과 관련된 문제는 그 작업의 ID를 이어 붙인 하위 항목(`H5.2-1`, `H5.2-2`)으로 올려 `[~]`와 `[o]`를 거치게 하고, `[o]` 작업의 상태는 그대로 둔다.
- 독립 작업은 병렬로 진행해도 되지만, 새 작업을 시작하는 것보다 진행 중인 작업을 끝내는 것이 먼저다. `[~]`가 아니라 `[o]`가 계속 늘어나야 한다.
- 커밋하지 않은 변경은 작업 하나를 넘지 않는다. 작업이 `[o]`가 되면 같은 작업 단위에서 changelog 항목과 커밋을 남긴다.
- 지시를 받으면 먼저 checklist의 작업인지, 이 파일의 규칙인지, agent memory에 둘 일인지, 답변만 할 일인지 분류한다. agent memory에는 요청자와 agent가 session 사이에 알아야 하는 것만 두고, project가 남겨야 하는 것은 저장소(문서, 주석, 커밋 메시지)에 둔다. 지시가 급하다고 명시하지 않는 한, 우선순위와 함께 작업으로 기록하고 진행 중인 작업을 계속한다. 규칙은 이 파일에 중복 없이 두고, checklist나 changelog에는 넣지 않는다.
- 한글 문서는 기술 용어를 영어 그대로 쓰고 문맥만 한글로 쓴다.
