# 개발

[English](development.md).

## 도구

- pin한 도구(HY-81): `.node-version`의 Node.js, `pdo_sqlite`가 있는 `config/toolchain.json` minor의 PHP, GNU Make 3.81 이상, 네이티브 확장을 위한 그 PHP의 phpize, php-config와 C compiler. `make install`은 `packageManager`의 npm과 `config/toolchain.json`의 Composer를 `var/tools`에 설치한다(`make tools`). `make toolchain-check`는 pin과 다른 모든 도구를 밝힌다.
- `../template`(`TEMPLATE_REPOSITORY`)에 있고 tag `v0.0.1`(`TEMPLATE_TAG`, HY-80)과 그 tag의 commit의 TypeScript 패키지 build를 가진 template 저장소. 그 tag의 checkout에서 template 저장소의 `make build-ts`가 그 build를 만든다. tag가 없으면 `make template-tag`가 실패하고, build가 다르면 복사는 기대값과 실제값인 입력 hash를 밝히며 실패한다. 이 저장소는 그곳에서 아무것도 build하지 않는다. `make template`이 그것을 `var/products/template`에 복사하고(HY-78), 브라우저 코드는 그 복사본의 TypeScript 패키지를 가져온다.
- network: `make tools`, `make install`, `make install-browser`만 download한다. 다른 모든 recipe는 npm, Composer를 offline으로 실행하므로(`npm_config_offline`, `COMPOSER_DISABLE_NETWORK`) 없는 download는 바로 실패하고 그것을 만드는 설치 target을 밝힌다(HY-89).
- Playwright용 Chromium: `make install-browser`. pin한 Playwright의 Chromium과, Linux에서는 그 system library를 설치한다.

## 타깃

| 타깃 | 동작 |
|---|---|
| `make tools` | `packageManager`의 npm과 `config/toolchain.json`의 Composer를 `var/tools`에 설치하고 `var/tools/bin`의 명령을 쓰며, 각 download를 pin한 digest로 확인한다(HY-81) |
| `make toolchain-check` | Node.js, npm, Composer, PHP minor가 pin과 다르면 실패하고 각각의 기대값과 실제값을 밝힌다(HY-81) |
| `make install` | template 저장소의 선언한 복사본과 `packages/hyper-php`의 사본을 쓰고, npm과 Composer 의존성을 bin link 없는 사본으로 설치한다(HY-79) |
| `make hyper-php-copy` | `packages/hyper-php`의 추적 파일 사본 `var/products/hyper-php`를 쓰고 board의 Composer 사본에 publish한다(HY-79, HY-82). `make server`가 먼저 실행한다 |
| `make template` | `scripts/copy-template.mjs`로 template tag `TEMPLATE_TAG`의 commit의 선언한 복사본 `var/products/template`을 쓰고(복사본이 그 commit을 담고 있으면 아무것도 쓰지 않는다), 그 복사본에서 TypeScript template 패키지의 npm 사본과 PHP template 패키지의 Composer 사본을 파일 단위로 publish한다(HY-78, HY-80, HY-82). publish는 `var/products/template/copy.json`이 `var/products/template/installed.stamp`보다 새로울 때만 한다. 테스트, 에셋, 서버 빌드가 먼저 실행한다 |
| `make template-tag` | template 저장소 `TEMPLATE_REPOSITORY`에 tag `TEMPLATE_TAG`가 없으면 기대한 tag와 저장소가 가진 tag를 밝히며 실패한다. `make template`이 복사 전에 실행한다(HY-80) |
| `make template-check` | TypeScript template 패키지의 npm 사본이나 PHP template 패키지의 Composer 사본이 선언한 복사본과 다르면 실패한다 |
| `make ext` | template 저장소의 선언한 복사본의 C 소스에서 그 build script, phpize, `PATH`의 php-config로 네이티브 템플릿 확장을 `build/ext/polyspec_template.so`에 빌드하며, 소스나 PHP build가 바뀐 때만 다시 빌드한다(HY-48, HY-78) |
| `make packages` | `@polyspec/hyper`와 `@polyspec/hyper-server`의 JavaScript module과 type 선언을 각 package가 선언한 build(`scripts/tsc.mjs`를 실행하는 `npm run build`)로 각자의 `dist` 디렉터리에 build하고 build와 각 npm 사본을 파일 단위로 publish한다(HY-79, HY-82). Node 서버 test, board 에셋 build, `make package-check`, `make test-scripts`는 package를 exports로 가져오므로 이것을 먼저 실행한다(HY-61). build script는 `data-template.json`, `checkManifest`, `templateReferences`를 script 옆 `packages/hyper-js`의 소스에서 읽으므로 `dist`가 필요 없고 어느 작업 디렉터리에서도 실행된다 |
| `make package-check` | 두 package를 그 `package-lock.json`에서 `npm ci --offline --install-links`로 `tests/package-install`에 offline 설치하고(HY-89), 그 test를 `erasableSyntaxOnly`로 선언에 대해 type 검사한 뒤 `node`로 실행한다(HY-61) |
| `make server` | 게시판 서버 프로그램을 `examples/board/build/server`에 빌드한다(아래 참조) |
| `make server-fixtures` | PHP 테스트 픽스처의 서버 프로그램을 빌드한다 |
| `make node-fixtures` | `scripts/build-templates.mjs`와 template 저장소의 선언한 복사본으로 Node 서버 test에 쓸 PHP test fixture의 템플릿 파일을 빌드한다(HY-70, HY-78) |
| `make node-server` | board Node 서버를 타입 검사하고 `examples/board/build/node/server.mjs`로 bundle한다(아래 참조) |
| `make assets` | 게시판 클라이언트 번들과 CSR 셸을 빌드한다(아래 참조) |
| `make test-js` | 라우터 적합성 사례를 포함한 브라우저 코드 테스트와 타입 검사를 실행한다 |
| `make test-node` | Node 서버 test를 실행한다. 같은 fixture로 PHP 서버 test의 사례, `conformance/json.json`의 JSON 사례, session, HTTP 서버, 타입 검사를 실행한다 |
| `make test-php` | 라우터 적합성 사례를 포함한 서버 패키지 테스트를 generated 프로그램으로 한 번, 네이티브 확장으로 한 번 실행한다 |
| `make lint` | PHP 형식을 검사한다 |
| `make analyse-php` | `packages/hyper-php/phpstan.neon`으로 `packages/hyper-php`의 소스와 테스트에 레벨 `max`의 PHPStan을 실행한다. 기준선(baseline)과 무시하는 오류는 없다. PHPStan은 네이티브 template 확장의 시그니처를 `var/products/template/packages/template-php-ext/src/polyspec_template.stub.php`에서 읽고(HY-78), 캐시를 `build/phpstan`에 쓴다. 그 캐시가 없는 실행은 worker에서 기본 PHP 한도 128M보다 큰 132 MB를 쓰므로 `--memory-limit=256M`으로 실행한다 |
| `make templates-check` | 레이아웃 템플릿만 `hx-` 속성을 가지는지(HC-6), 레이아웃이 `{# title}`과 `{# data}`를 한 번씩 배치하는지, 레이아웃과 각 라우트 템플릿의 모든 영역이 블록 인자 없이 `id`가 영역 이름인 요소 바로 안에 한 번씩 배치되는지(HY-3, HY-30) 검사한다 |
| `make test-scripts` | 검사 스크립트의 테스트를 실행한다. 예: 잘못된 픽스처 애플리케이션으로 영역 배치 검사를 시험한다 |
| `make virtiofs-check` | 출력이 virtiofs bind mount에 있는 Apple `container`에서 server build와 출력 복사를 실행한다(HY-68). Darwin에서만 `make check`의 target이며(`DARWIN_TARGETS`), `container`가 없으면 실패한다 |
| `make parity` | PHP 문서와, 문서 JSON과 영역 JSON의 브라우저 렌더 결과를 비교한다. generated 프로그램으로 한 번, 네이티브 확장으로 한 번 실행한다 |
| `make server-parity` | parity 단계를 PHP 서버와 board Node 서버에 실행해 모든 응답의 상태, header, body를 비교하고, `make parity`의 브라우저 비교도 수행한다(HY-55) |
| `make bundle-size` | SSR 스크립트, CSR 셸, 가장 큰 템플릿의 크기를 `config/bundle-size.json`의 gzip 상한과 함께 출력한다. 상한을 넘는 크기는 `WARNING` 줄을, GitHub에서는 annotation `::warning::`과 CI 요약의 warning도 내고, target은 통과한다 |
| `make e2e` | SSR, CSR, JavaScript 없는 흐름, 비교 흐름을 Chromium에서 실행한다(실행의 서버와 database에서, `scripts/run-e2e.mjs`) |
| `make owner-check` | 모든 추적 경로에 owner가 있는지 확인한 뒤 `scripts/owner-checks.json`이 선언한 바뀐 경로의 owner를 실행한다. `PATHS`는 경로를 밝히고 `BASE`는 그 revision 이후의 변경을 가져온다(HY-88) |
| `make docs-check` | `make hooks-check`를 실행한 뒤 문서 쌍, 링크, 코드 블록을 검사한다 |
| `make hooks` | `core.hooksPath`를 `.githooks`로 설정하고 `make hooks-check`를 실행한다([Push](#push) 참조) |
| `make hooks-check` | `core.hooksPath`가 `.githooks`가 아니거나 `.githooks/pre-push`가 없거나 실행할 수 없으면 실패한다 |
| `make push-gate-commit` | commit `COMMIT`에 진행 중인 checklist 작업이 있거나 그 commit이 `.githooks/pre-push`를 mode 100755로 추적하지 않으면 실패한다. GitHub의 job `push-gate`가 이를 실행한다([Push](#push) 참고) |
| `make github-ruleset` | `.github/ruleset.json`의 merge 설정을 바꾸고 그 이름의 GitHub ruleset을 다른 곳만 만들거나 갱신한 뒤 다시 비교한다([main 공개](#main-공개) 참고) |
| `make github-ruleset-check` | merge 설정이나 live GitHub ruleset이 `.github/ruleset.json`과 다르면 field마다 live 값과 선언 값을 밝히며 실패한다. 아무것도 바꾸지 않는다 |
| `make ci-pins` | `config/toolchain.json`의 PHP minor를 출력하고 step output으로 workflow에 준다([CI](#ci) 참고) |
| `make ci-check` | CI group `GROUP`의 target을 끝까지 실행하고 보고서 `var/ci/<group>/`을 쓴다. GitHub Actions에서만 실행한다([CI](#ci) 참고) |
| `make ci-summary` | CI group `GROUP`의 요약을 보고서와 job summary에 쓴다([CI](#ci) 참고) |
| `make install-browser` | pin한 Playwright의 Chromium과, Linux에서는 그 system library를 설치한다. `$(ONLINE)`을 거친 download다(HY-89) |
| `make serve-demo` | lock `/tmp/hyper-serve-demo.lock`을 잡은 채 고정 port 8080 ~ 8082에서 SSR, CSR, 비교 페이지를 실행한다. 두 번째 demo는 holder를 밝히며 실패한다([배포](deployment.ko.md) 참조) |
| `make serve-demo-unlock` | process가 끝난 demo의 lock을 지운다. demo가 실행 중이면 실패한다 |
| `make bench-server-smoke` | PHP 측정기를 측정마다 한 번씩 실행한다. 측정기를 깨는 변경이 실패하도록 `make check`에 들어 있다 |
| `make bench` | 서버와 브라우저 성능을 보고하는 `make bench-server`와 `make bench-browser`를 실행한다([성능 측정](benchmark.ko.md) 참조). `make check`에는 포함하지 않는다 |
| `make check` | 위의 모든 검사를 전체 실행의 guard를 거쳐 실행한다(아래 참조) |
| `make rerun-failed` | 현재 tree에서 통과하지 못한 `make check`의 target만 다시 실행한다(아래 참조) |

## 전체 실행

전체 suite는 push 뒤에 GitHub에서 실행하며([CI](#ci) 참고), 커밋이나 push 전에 local 전체 실행은 필요하지 않다. Darwin에서만 full suite에 속하는 `make virtiofs-check`는 local `make check`에서만 실행되므로, HY-68의 virtiofs case는 누군가 Mac에서 `make check`를 실행할 때만 실행된다.

`make check`는 `docs/plans/execution-checklist.md`의 작업 중 `[~]`인 것이 없을 때, 커밋된 tree와 template tag `TEMPLATE_TAG`의 commit마다 한 번 실행된다(HY-80). 어떤 단계보다 먼저 `scripts/full-run.mjs`를 시작하며, 이 guard는 판단을 이유와 함께 출력하고(`[full-run] run: ...` 또는 `[full-run] refuse: ...`) 다음의 경우 status 1로 거부한다.

- checklist의 작업 행이 `[~]`일 때. 거부 메시지는 활성 ID를 작업과 함께 나열한다.
- 추적 파일에 커밋되지 않은 변경이 있을 때(`git status --porcelain --untracked-files=no`). 전체 실행은 커밋된 tree를 검증하기 때문이다.
- `var/full-run.json`이 현재 tree(`git rev-parse HEAD^{tree}`)와 guard가 Makefile의 `TEMPLATE_REPOSITORY`와 `TEMPLATE_TAG`에서 읽는 template tag의 commit의 전체 실행을 기록하고 있을 때. 거부 메시지는 그 실행을 tree, template commit, 시작 시각, 결과와 함께 밝힌다.
- pre-push hook이 설치되지 않았을 때(`make hooks-check`). 거부 메시지는 `make hooks`를 밝힌다.
- `incomplete` record의 process가 아직 실행 중일 때.

guard는 `CHECK_TARGETS`의 각 target을 `make <target>`으로 끝까지 실행하며, target이 실패한 뒤에도 계속하고, `[full-run] start <target> (<n>/<total>)`와 `[full-run] <target> passed|failed in <seconds> s`를 출력한다. 어떤 target에도 시간 제한이 없다. 각 target의 앞뒤에 `var/full-run.json`을 쓴다. 이 record는 tree, template commit, process, 시작과 끝 시각, 결과(마지막 target이 끝날 때까지 `incomplete`, 그다음 `passed` 또는 `failed`), 실패한 target, 그리고 각 target의 상태(`pending`, `running`, `passed`, `failed`), 시각, 경과 millisecond, 실패한 target이면 마지막 출력 20줄(`lastLines`)을 담는다. guard는 그 줄들도 결과 전에 실패한 target과 함께 출력한다(HY-84). 따라서 멈춘 실행은 실행 중이던 target과 함께 `incomplete`로 기록되어 남는다. `var/`는 Git이 무시하므로 checkout과 worktree마다 자기 record를 가진다. tree를 바꾸는 commit이나 다른 commit에 있는 template tag는 `[~]` 작업이 없을 때 새 전체 실행을 허용한다.

`make rerun-failed`는 현재 tree와 template commit에서 통과하지 못한 target, 즉 실패한 target과 `incomplete` 실행이 끝내지 못한 target만 다시 실행한다. 진행 중인 작업, 커밋되지 않은 변경, 실행 중인 process에 대해서는 `make check`와 같이 거부되고, record가 없을 때, record가 다른 tree나 template commit의 것일 때, 그 tree의 전체 실행이 통과했을 때도 거부된다. 각 재실행을 record의 `reruns`에 쓰고, 모든 target이 통과하면 그 tree의 결과는 `passed`가 된다.

새 checkout에는 record가 없으므로, 그곳에서 `make check`는 `[~]` 작업이 없고 tree가 깨끗하면 실행된다.

## Push

push는 push하는 commit에도 working tree에도 checklist의 `[~]` 작업이 없을 때만 한다. 추적하는 pre-push hook `.githooks/pre-push`가 `node scripts/push-gate.mjs hook`을 실행한다. 이 script는 입력에서 push의 ref를 읽고, push하는 모든 commit의 checklist(`git show <sha>:docs/plans/execution-checklist.md`)와 working tree의 checklist를 `scripts/full-run.mjs`의 `activeItems`로 parse하며, status 1로 push를 거부한다. 거부 메시지는 활성 ID를 작업과 함께, 그리고 그것을 가진 ref와 commit 또는 working tree를 밝히고, 규칙을 적고, 각 작업을 완료하거나 원인과 재시도 조건과 함께 `[!]`로 표시하라고 안내한다. checklist가 없는 commit을 push하거나 checklist를 parse할 수 없을 때도 push를 거부한다.

Git은 clone에서 hook을 설치하지 않는다. 그래서 모든 `make` 실행이 `core.hooksPath`가 다른 값이면 `.githooks`로 설정하고, `make hooks`는 이를 명시적으로 설정한다. 커밋 전에 `make docs-check`가 실행하는 `make hooks-check`와 전체 실행의 guard는 `core.hooksPath`가 `.githooks`가 아니거나 hook이 없거나 실행할 수 없으면 실패한다.

workflow `.github/workflows/push-gate.yml`은 모든 push를 검사한다. 그 job `push-gate`는 merge queue의 branch `gh-readonly-queue/**`를 뺀 모든 branch에 push된 commit, 모든 pull request의 head commit, 모든 merge group에 `node scripts/push-gate.mjs commit <sha>`를 실행하는 `make push-gate-commit COMMIT=<sha>`를 실행하므로, hook을 거치지 않았거나 hook이 없는 checkout에서 온 push도 그곳에서 실패한다. 진행 중인 작업이 있을 때, checklist가 없는 commit일 때, `.githooks/pre-push`를 mode 100755로 추적하지 않는 commit일 때 실패하며, 실패의 각 줄을 annotation으로 출력하고 job summary에 쓴다. 이어서 job은 문서 쌍, link, code block, checklist 규칙인 `make docs-check`를 실행하며, 이 검사는 network를 읽지 않으므로, 이를 어기는 commit은 ruleset `main`이 요구하는 check에서 실패한다([main 공개](#main-공개) 참고).

## main 공개

모든 변경은 pull request와 merge queue를 거쳐 `main`에 닿으며(HY-94), 이 저장소의 어떤 명령도 `main`을 push하지 않는다. branch는 GitHub의 표준 명령이나 GitHub UI로 공개한다.

```sh
git push origin HEAD:refs/heads/<branch>
gh pr create --base main --head <branch> --fill
gh pr merge <branch> --auto --rebase
```

`.github/ruleset.json`의 GitHub ruleset `main`은 enforcement `active`로 `refs/heads/main`에 적용되고 bypass actor가 없으므로 관리자에게도 적용된다. 그 rule은 다음과 같다.

- `pull_request`: 변경은 pull request로 들어온다. 승인은 필요 없고 모든 merge method를 허용한다. merge queue는 자기 method로 merge하고, `gh pr merge --auto`는 스스로 고른 method로 auto-merge를 요청하므로, `rebase`만 허용하는 rule은 pull request를 queue 밖에 둔다.
- `merge_queue`: merge queue는 method `REBASE`로 merge하므로 pull request의 각 commit이 그대로 `main`의 commit이 된다. grouping strategy는 `ALLGREEN`이고, 한 번에 최대 5개 항목을 build하고 merge하며, 더 많은 항목을 기다리지 않는다. `check_response_timeout_minutes`는 GitHub의 최댓값인 360이므로 긴 suite가 이것으로 끊기지 않는다.
- `required_linear_history`, `non_fast_forward`, `deletion`: `main`에 merge commit, force-push, 삭제가 없다.
- `required_status_checks`: 정확히 GitHub Actions app(integration 15368)의 check `push-gate`와 `ci-passed`. 곧 `make push-gate-commit`과 `make docs-check`를 실행하는 `.github/workflows/push-gate.yml`의 job과 `.github/workflows/ci.yml`의 마지막 job이다. `ci-passed`는 `ci.yml`의 다른 모든 job을 need로 가지고, 그중 하나가 실패하거나 skip되거나 취소되어도 그 모든 job 뒤에 실행되며(`if: ${{ always() }}`), need로 가진 모든 job의 결과를 출력하고 하나라도 `success`가 아니면 실패하는 `make ci-passed RESULTS='${{ toJSON(needs) }}'`를 실행한다(`scripts/ci-run.mjs passed`). `ci.yml`에 추가한 job은 `needs`에 넣으므로 필수 check가 그 job을 포함한다. `tests/scripts/ci-workflow.test.mjs`는 `ci-passed`가 없거나, 마지막 job이 아니거나, `if: ${{ always() }}`가 없거나, 다른 모든 job을 need로 가지지 않거나, 다른 runner에서 실행되거나, 다른 step을 실행하면 실패한다.

직접 `git push origin <commit>:main`을 하면 `GH013: Repository rule violations found`로 거부된다. `gh pr merge --auto`는 pull request에서 필수 check가 통과하면 pull request를 merge queue에 넣는다. queue는 이를 `main` 위에 branch `gh-readonly-queue/main/pr-<number>-<sha>`의 merge group으로 rebase하고, 두 workflow가 그 commit에서 실행하며(`merge_group`), check가 통과하면 `main`을 정확히 그 commit으로 옮긴다. 실패한 check는 pull request를 queue에서 빼고 `main`은 움직이지 않는다. push gate는 queue의 branch로의 push에서는 실행하지 않는다. 그 merge group run이 이미 검사하기 때문이다. merge group의 `ci.yml` run은 취소되지 않는다. group마다 자기 ref가 있고 `cancel-in-progress`는 pull request에만 적용되기 때문이다. merge된 pull request의 branch는 삭제된다(`delete_branch_on_merge`). rebase는 merge된 commit에 새 hash를 주므로 `git pull --rebase`가 queue가 merge한 local commit을 버린다.

`make github-ruleset`은 선언의 저장소 설정(`allow_rebase_merge`, `allow_auto_merge`, `delete_branch_on_merge`)을 바꾸고 선언한 이름의 ruleset을 다른 곳만 만들거나 갱신한 뒤 다시 비교한다. `make github-ruleset-check`는 아무것도 바꾸지 않으며, 설정이 다르거나 live ruleset이 없거나 선언과 다르면 field마다 live 값과 선언 값을 밝히며 실패한다. 둘 다 make 변수 `GH`(설정하지 않으면 `gh`)의 GitHub CLI를 실행하며, 그 CLI에는 저장소의 administration 권한이 필요하다. 전체 suite의 어떤 target도 이들을 실행하지 않는다. `tests/scripts/github-ruleset.test.mjs`는 가짜 `gh`로 script를 실행한다.

## Tag 릴리스

릴리스는 `main`의 commit에 붙인 tag `vX.Y.Z`이다(HY-95, 절차는 `AGENTS.md`). tag의 push는 `.github/workflows/release.yml`을 실행하며, 그 step은 다음 순서로 `scripts/release.mjs`를 실행하고 첫 실패에서 멈춘다.

```sh
make release-verify
make release-versions
make release-assets
make release-publish
```

`make release-verify`는 tag된 commit이 `origin/main`에 있고 그 commit의 최신 check run `push-gate`와 `ci-passed`(`gh api repos/<repository>/commits/<sha>/check-runs`)가 결론 `success`로 완료되었는지 확인한다. `make release-versions`는 버전을 선언하는 모든 manifest에 X.Y.Z가 있고 `CHANGELOG.md`에 section `## X.Y.Z`가 있는지 확인하며, 다른 파일마다 그 버전과 tag의 버전을 적는다. `make release-assets`는 패키지를 빌드하고(`make packages`) `polyspec-hyper-X.Y.Z.tgz`, `polyspec-hyper-server-X.Y.Z.tgz`, `polyspec-hyper-X.Y.Z.zip`을 `var/release/assets`에 쓴다. `make release-publish`는 section을 notes로 하고 archive를 붙여 GitHub Release를 만든다. job은 `ci.yml`의 job `check`처럼 Node.js, PHP, `TEMPLATE_TAG`의 template 저장소, `make install`을 준비하며, tag는 환경 변수 `TAG`로 step에 전달된다. `tests/scripts/release.test.mjs`는 어떤 tag도 릴리스하지 않는 manifest인 `tests/package-install/package.json`과 `examples/board/composer.json`을 나열하고, 릴리스되지도 나열되지도 않은 tracked manifest가 있으면 실패한다.

## CI

workflow `.github/workflows/ci.yml`은 모든 pull request, merge queue의 모든 merge group, 모든 수동 실행(`workflow_dispatch`)에 대해 전체 suite를 실행한다(HY-91, [main 공개](#main-공개) 참고). runner가 적으므로 pull request의 새 push는 아직 진행 중인 앞선 push의 run을 멈추고, merge group의 run은 취소하지 않는다. 그 job `check`는 Makefile의 CI group마다 항목 하나를 `fail-fast: false`로 가진다.

| Group | Target | 준비 |
|---|---|---|
| `docs` | `docs-check` | Node.js |
| `php` | `template-check`, `bench-server-smoke`, `lint`, `analyse-php`, `test-php` | Node.js, PHP, template build, `make install` |
| `node` | `templates-check`, `test-scripts`, `test-js`, `test-node`, `package-check` | Node.js, PHP, template build, `make install` |
| `board` | `parity`, `server-parity`, `bundle-size`, `e2e` | Node.js, PHP, template build, `make install`, `make install-browser` |

각 step은 make target 하나를 실행하고(HY-90), 첫 step 뒤의 모든 step은 실패한 step 뒤에도 실행한다. `make ci-pins`는 `config/toolchain.json`의 PHP minor를 workflow에 주고, workflow는 그 minor의 PHP를 준비하고 template 저장소를 Makefile의 tag `TEMPLATE_TAG`로 `../template`에 checkout하며, 그곳에서 `make install build-ts`가 TypeScript 패키지를 build한다. `make ci-check GROUP=<group>`은 group의 모든 target을 자기 `make -k <target>`으로 끝까지 실행하고 `[ci] start <target>`과 `[ci] <target> passed|failed in <seconds> s`를 출력한다. checkout은 `make check`로 전체 suite를 실행하므로 GitHub Actions 밖에서는 거부한다. `make ci-summary GROUP=<group>`은 job summary를 쓴다. job은 artifact `ci-<group>-<run id>-<attempt>`로 디렉터리 `var/ci/<group>/`을 upload한다.

- `summary.md`: tree, Node.js, npm, patch를 포함한 PHP, Composer, make의 실행 중인 release, 각 setup step의 결과, target의 상태, 시간, 첫 실패 줄의 표, 그리고 실패한 각 target의 첫 실패 줄;
- `record.json`: 같은 내용의 data이며 각 target 앞뒤에 쓰므로, 멈춘 runner는 실행 중이던 target을 남긴다;
- `logs/<target>.log`: 각 target의 명령, 전체 출력, make가 끝난 방식.

## Test 실행

`scripts/run-tests.mjs <node|vitest|phpunit> [--timeout <seconds>] [--cwd <directory>] [--extension <file>] [--] [<arguments>]`는 test 도구를 실행하고, `make test-js`, `make test-node`, `make test-php`, `make test-scripts`, `make package-check`는 이것으로 test를 실행한다. 모든 test는 시작할 때 한 줄, 실행 중에는 5초마다 한 줄, 끝나면 결과와 경과 시간을 담은 한 줄을 출력하고, 실행은 개수와 경과 시간을 담은 줄로 끝난다. 모든 test는 자기 timeout을 가지며, `--timeout`이 다른 값을 주지 않으면 30초다. vitest와 `node --test`는 timeout에서 그 test를 실패시키고, `--teamcity`로 test마다 보고하는 PHPUnit은 runner가 PHPUnit을 멈추고 그 test를 이름으로 실패시킨다. `--extension`은 PHPUnit에 PHP extension을 불러온다. `tests/scripts/run-tests.test.mjs`가 runner와 `scripts/test-progress/`의 reporter를 시험한다.

변경을 소유한 test만 실행하려면 그 파일이나 filter를 넘긴다. 예: `node scripts/run-tests.mjs vitest --cwd packages/hyper-js tests/router.test.ts`, `node scripts/run-tests.mjs phpunit --cwd packages/hyper-php -- --filter RouterTest`.

## 한 실행의 서버

`make parity`와 `make server-parity`는 `scripts/board-servers.mjs`로 자기 서버를 띄운다. 모든 서버는 system이 배정하는 port에서 listen하고, 검사는 서버가 출력에 알리는 주소로 요청을 보낸다(PHP의 `Development Server (http://127.0.0.1:<port>) started`, board Node 서버의 `board on http://127.0.0.1:<port>`, `scripts/serve-edge.mjs`의 `edge http://127.0.0.1:<port>`). 따라서 다른 checkout이나 session의 실행이 도는 동안에도 요청은 같은 실행의 서버에 닿는다. 서버를 띄우는 일은 시간 제한이 없는 단계다. 시작, `[<name>]`을 붙인 서버의 모든 출력 줄, 경과 시간이 붙은 주소를 출력하고, 서버가 먼저 종료하면 실패한다. 한 실행의 database와 session 디렉터리는 임시 디렉터리에 있으며, `scripts/check-parity.mjs`는 그 디렉터리를 `run directory: <path>`로 출력하고 지운다.

`make e2e`도 같은 방식으로 `scripts/run-e2e.mjs`를 실행한다. 이 script는 board 예제를 두 rendering 방식(API origin, edge, SSR origin)으로 실행 디렉터리의 빈 database 위에 띄우고, `tests/e2e/origins.ts`가 요구하는 `HYPER_E2E_SSR`과 `HYPER_E2E_CSR`에 주소를 담아 `playwright test`를 실행한다. 인자는 Playwright에 넘긴다. 예: `node scripts/run-e2e.mjs -g 'stylesheet'`. Playwright는 서버를 직접 띄우지 않는다. `make bench-browser`도 같은 방식으로 서버와 데이터베이스를 띄운다.

## 서버 빌드

`scripts/build-server.mjs --manifest <app.json> --templates <directory> --output <directory> --template-dir <template repository> --php-namespace <namespace>`는 서버 프로그램을 만든다(HY-48).

1. `templates/`: 애플리케이션의 모든 템플릿과 예약 템플릿 `hyper/data.tpl`. 네이티브 확장이 이 파일을 읽는다.
2. `program.php`: 같은 템플릿을 template 저장소의 컴파일러로, 주어진 PHP 네임스페이스(게시판은 `Polyspec\Hyper\Examples\Board\Program`)에 컴파일한 generated PHP 프로그램. `program.json`은 그 네임스페이스를 기록하며, 렌더러가 이 파일을 읽는다. 서버가 각 영역을 단독으로 렌더하므로, 모든 템플릿은 대상으로 렌더되고 모든 정의는 HTML이다.

PHP가 `polyspec_template`을 불러왔으면 네이티브 확장으로, 그렇지 않으면 `program.php`로 렌더한다. 두 출력은 같은 원본에서 만들어지므로, 서버는 확장을 불러오는지 여부만으로 엔진을 바꿀 수 있다.

## Node 서버

`make node-server`는 `examples/board/node/main.ts`를 esbuild로 `examples/board/build/node/server.mjs`에 bundle한다. board Node 서버는 `examples/board/public/index.php`와 같은 애플리케이션을 게시글 저장에 `node:sqlite`를 써서 제공하고, `examples/board/public`의 파일도 제공한다.

```sh
make node-server
BOARD_DB=$PWD/examples/board/var/node.db BOARD_SESSIONS=$PWD/examples/board/var/sessions BOARD_PORT=8084 node examples/board/build/node/server.mjs
```

`BOARD_PORT=0`이면 system이 port를 배정하고, 서버는 listen하는 port를 담아 `board on http://127.0.0.1:<port>`를 출력한다. `BOARD_SESSIONS`는 절대 경로의 session 디렉터리이고, `BOARD_BASE_PATH`, `BOARD_HTTPS`, `BOARD_FRAME_ANCESTORS`는 PHP에서와 같은 뜻이다. 두 서버의 `BOARD_TIME`은 새 게시글의 생성 시각을 Unix 초로 고정하므로, `make server-parity`는 같은 게시글을 비교한다. Node 서버는 `make assets`의 템플릿 파일로 렌더한다(HY-54).

## 에셋 빌드

`scripts/build-assets.mjs --app <디렉터리> --api <기본 경로> --template-dir <template 저장소> --output <디렉터리>`는 그 template 저장소의 template package로 다음을 쓴다(HY-70). `public/assets/` 아래에는 이름에 내용의 해시가 들어간 파일을 더하기만 하고 지우지 않으며, 해시가 없는 출력은 `--output`의 디렉터리에 둔다(HY-34). `make assets`는 `examples/board/build`를 넘긴다.

1. `public/assets/templates/<name>.<hash>.json`: `templates/` 아래 템플릿마다 AST 파일 하나, 그리고 예약 템플릿 `hyper/data.tpl`의 파일 하나(HY-34).
2. `<output>/templates.index.json`: 각 템플릿 이름과 그 파일 URL(HY-34). 클라이언트는 이를 `@polyspec/hyper/templates-index`로 import한다.
3. `public/assets/hyper-<hash>.js`, `public/assets/hyper-chunk-<hash>.js`, `<output>/manifest.json`(HY-76).
   - 클라이언트 진입 파일. htmx, hyper 브라우저 코드, template 렌더 런타임, `app/app.json`, 색인이 들어 있고 템플릿은 없다.
   - 진입 파일이 `import()`로만 불러오는 코드마다 조각 파일 하나. 브라우저는 그 코드가 처음 실행될 때 조각을 불러온다.
   - 진입 파일의 URL을 `hyper`로 담은 매니페스트. 서버가 레이아웃에 넘긴다.
   - 빌드는 애플리케이션이 이름을 정하는 파일을 쓰지 않는다. 애플리케이션은 자기 스타일시트를 직접 두고 링크한다.
4. `--tailwind <source>=<output>`이 있으면 output stylesheet. source를 Tailwind CSS의 theme과, `templates/`와 `client/` 아래 file이 쓰는 utility class로 compile하고, source의 rule은 layer `components`에 두며 layer `base`의 rule은 두지 않는다(HY-77).
5. `<output>/csr/`: CSR 배포물.
   - `index.html`은 `<meta name="hyper-api">`와 인라인한 진입 파일을 담고 스타일시트는 담지 않는다. 브라우저가 렌더한 레이아웃의 스타일시트 링크를 적용하기 때문이다(HY-64, HY-76).
   - `assets/templates/`는 이 build의 템플릿 파일을 담는다.
   - `assets/`는 이 build의 조각 파일을 담는다. 배포물은 `--static`이 밝히는 `public/` 아래 파일을 같은 경로에 담는다. 애플리케이션은 렌더한 layout이 link하는 스타일시트를 밝히며, `make assets`는 board 예제의 `public/assets/app.css`와 `public/assets/reader.css`를 밝힌다. 배포물은 파일 단위로, `index.html`을 마지막으로 publish한다(HY-82).
   - 진입 파일에 `</script`가 들어 있으면 빌드는 실패한다. 빌드는 인라인한 진입 파일의 해시를 담은 Content Security Policy를 출력한다.

빌드는 이전 결과를 교체하므로, 반복해서 빌드해도 결과마다 파일이 하나만 남는다. 빌드 결과는 커밋하지 않는다.

## PHP, Node.js, 브라우저가 같게 동작한다는 증거

| 동작 | 근거 |
|---|---|
| 유지 값 | `conformance/keep.json`을 `make test-php`와 `make test-js`가 실행한다(HY-38). |
| JSON 텍스트 | `conformance/json.json`을 `make test-php`와 `make test-node`가 실행한다. Node 서버는 PHP `json_encode`의 바이트를 쓰고 유지 값을 PHP `json_decode`처럼 읽는다(HY-54). |
| 라우팅 | `conformance/routes.json`을 `make test-php`와 `make test-js`가 실행한다. 렌더할 때 브라우저는 자기 라우트가 서버가 보고한 라우트와 같은지도 확인한다(HY-20). |
| Node 서버 | `make server-parity`는 parity 단계의 모든 요청을 각자 데이터베이스와 session을 가진 PHP 서버와 board Node 서버에 보내고, session 식별자, 응답마다 가린 CSRF token, `ETag` 값을 placeholder로 바꾼 뒤 상태, header, body가 같은지 확인한다(HY-55). |
| 문서 렌더 | `make parity`는 비교 단계마다 같은 세션에서 HTML 문서, 문서 JSON, 영역 JSON을 요청한다. 라우트 영역, 내장 데이터, `server`와 `cookie` 유지 값(HY-30, HY-31, HY-38)을 포함한 문서 JSON의 브라우저 렌더 결과는 응답마다 다른 가린 CSRF 토큰(HY-24)을 각 응답에서 `<csrf>`로 바꾼 뒤 PHP 문서와 바이트 단위로 같아야 하고, 영역 JSON의 모든 부분이 그 문서에 나타나야 한다. 검사는 단계가 시작할 때 한 줄을, 끝나면 결과와 경과 밀리초를 출력한다. 10초 안에 응답이 없는 요청은 그 단계의 이름으로 실패하고 검사를 끝낸다. |
| 브라우저에서의 동작 | `make e2e`는 SSR과 CSR에서 같은 흐름을 실행한다. 이동, 액션, 데이터 요청 없는 `hy-set` 변경, 새로고침과 새 탭에서의 유지 종류 네 가지, 라우트에 필요한 템플릿만 불러오기, 페이지를 보이기 전에 불러오고 다른 페이지가 link하지 않으면 제거하는 layout의 stylesheet link(HY-64), SSR body와 CSR body가 같은지 확인하는 비교 페이지를 포함한다. |

## 측정한 크기

2026-10-05에 `make bundle-size`로 측정했다(htmx 4.0.0, esbuild 0.28.2, 게시판 템플릿 10개와 `hyper/data.tpl`).

| 출력 | 원본 바이트 | gzip 바이트 | brotli 바이트 | gzip 상한 |
|---|---:|---:|---:|---:|
| SSR 스크립트 `hyper-<hash>.js` | 99,580 | 33,080 | 29,549 | 33,500 |
| CSR 셸 `build/csr/index.html` | 99,819 | 33,224 | 29,551 | 33,600 |
| 가장 큰 템플릿 파일(`board/rows.tpl`) | 5,583 | 1,334 | 1,084 | 4,096 |
| 템플릿 파일 11개 합계 | | 5,818 | | |

`config/bundle-size.json`의 SSR 스크립트와 CSR 셸 상한은 측정한 gzip 크기에 약 1%를 더하고 100바이트 단위로 올린 값이다. 상한을 넘는 크기는 실패가 아니라 warning이다(AGENTS). 출력이 상한보다 커지는 변경은 같은 변경 안에서 상한을 고치고 그 증가가 필요한 이유를 적는다. 출력이 작아지는 변경은 같은 규칙으로 상한을 낮춘다.

브라우저는 렌더가 닿는 템플릿만 불러오고(HY-35), 템플릿 파일은 해시가 붙은 이름으로 캐시된다.
- 템플릿 AST는 노드마다 소스 위치를 기록하므로 압축 후 크기가 소스의 약 2배다.
- `config/bundle-size.json`은 템플릿 파일 하나를 4,096 gzip 바이트로 제한한다. 이보다 커지는 템플릿은 블록으로 나눈다.
