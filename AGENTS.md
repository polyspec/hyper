<!-- doc-id: agents -->
# Development

[한국어](AGENTS.ko.md).

The working principles of every polyspec repository, and the rules of work that every repository follows, are in
[PRINCIPLES.md](PRINCIPLES.md). This file states only the rules of this repository.

## Documents

- Own: A record describes only this repository. A changelog entry, a task, a wave background, a comment and a commit message state a defect as a fact about this repository: the input, the behaviour and the expected behaviour. They name no other product, no user of this repository, no reporter and no source of a decision, and a sentence that carries no such fact is deleted. An identifier is named after its role in this repository.
  Enforced by: none, whether a sentence names a source of a decision is a judgement that no tool makes.
- Own: One authoritative document per topic. The protocol contract is in `docs/spec/`. Implementation and verification status is in `docs/features.md`. Planned tasks, their verification commands and their completion are in `docs/plans/execution/checklist.md`. Current procedures are in `docs/operations/`. Actual changes and their verification results are in `CHANGELOG.md`.
  Enforced by: none, which document owns a topic is a judgement.
- Refines P4: Documents describe current behavior. When the direction changes, change the specification (`docs/spec/`) first and mark the parts that are not implemented.
  Enforced by: none, whether a document describes the current behavior is a judgement.
- Own: A behavior change, its documents, its feature status row in `docs/features.md` and its entry in `CHANGELOG.md` are one change.
  Enforced by: none, no tool sees whether the four are in one change.
- Own: `make docs-check` verifies, as `config/documents.json` declares, the document pairs, the markers `doc-id` (the same in both files) and `source-sha256` (in the Korean file, the sha256 of its English file), the links and the identical code blocks. Content accuracy is verified by reading the code and the tests.
  Enforced by: `make docs-check`

## Implementation

- Own: Do not use temporary scripts or folders. Every check is a Makefile target, a script under `scripts/`, or a committed test, and is idempotent.
  Enforced by: none, whether a script is temporary is a judgement.
- Own: A release result depends only on the tree, the template release that the manifests and their locks pin, and the commit of the tag `TEMPLATE_TAG` (`v0.0.12`) of the template repository, and on the php-ext release archive of that tag that `config/release-assets.json` pins by its sha256, which `make hyper-install` fetches and `make ext` builds. Every input from outside the repository is named in a tracked file and verified before use: a package by its exact version and the integrity or shasum of its lock, the template repository by its tag (`TEMPLATE_TAG` of the Makefile, the version of the entry `template-php` of `config/release-assets.json`, HR-80), and a build output by the hash of its inputs. A dependency is declared in `package.json` or `composer.json` and installed by npm or Composer from its lock (HR-70). Until version 0.1 a dependency on another polyspec repository is a GitHub tag of that repository or an asset of its GitHub Release, never a branch or a commit. No tracked file names a Git commit, of this repository or of another. Final verification records its tree and results under ignored `var/report/`; release archives keep their declared integrity pins. No check reads the working tree of another checkout as it happens to be.
  Enforced by: `make dependency-policy-check`, `make toolchain-check`
- Own: While polyspec versions are 0.0.x, a development checkout links the installed polyspec packages to their source as `docs/operations/local-links.md` of kit describes. Links are never committed.
  Enforced by: none, whether a link is kept out of commits is judged by review.
- Own: Composer source development selects tracked `composer.local.json` manifests for the root and board. Composer owns each ignored `composer.local.lock`, source links, installed records and autoload. `COMPOSER` remains the native manifest selector; `COMPOSER_BIN` names its executable. `make composer-development` resolves those graphs under the installation lock; `make composer-development-check` validates their locks and PHP requirements. Release manifests and locks remain separate.
  Enforced by: `make hyper-test-scripts`
- Own: Every tool whose release changes a result is pinned in a tracked file and checked before use (HR-81): `.php-version`, `packageManager`, `mise.toml` with `mise.lock`, and `config/toolchain.json`. A tool is pinned as exactly as its results require: PHP by its minor, the tools of mise by their exact releases, and make not at all. Tools are installed into the checkout (`var/tools`), never into the machine; a download is used only with its pinned digest, and no tool installs another tool on first use. A recipe or a script starts a tool of the checkout by its absolute path, because make looks up a recipe line without shell syntax on its own `PATH`.
  Enforced by: `make toolchain-check`, `make kit-check`
- Own: PHP development, test and release verification use PHP 8.4.27 as the baseline. Windows uses the 8.4.27-1 package rebuild; its runtime version remains 8.4.27. `.php-version` selects the 8.4 minor for native tool discovery. Record the actual runtime version with verification results; results from an older patch do not establish verification at this baseline.
  Enforced by: none, the baseline and recorded runtime are checked when reviewing verification evidence.

- Own: No result depends on a live service or on time (HR-89): no check makes a registry query whose result depends on time, such as a latest lookup, the resolution of a version range, or a query for outdated packages or new releases, and no check queries another live service. A download of a package that a lock pins by its exact version and integrity is installation and is allowed, as `npm ci` and `composer install` do. Installs follow their locks without an audit. A test orders events by events or an injected clock, never by racing timers, and a server of a run listens on a port that the system assigns and reports. Every recipe runs npm and Composer offline (`npm_config_offline` and `COMPOSER_DISABLE_NETWORK` of the Makefile). Only explicit installation targets, including `make composer-development`, the native source helpers, `make bootstrap`, `make install-tools`, `make install-packages`, `make hyper-install`, `make hyper-install-php`, `make hyper-install-browser` and `make hyper-install-virtiofs` download, through `$(ONLINE)`, and a missing download fails with the install target that makes it, never with the advice of a tool to retry online. A long operation, such as a server start, waits without a time limit and prints its progress.
  Enforced by: `make kit-check`, `make hyper-test-scripts`
- Own: Performance is measured and reported and never fails a check: a size or a time above its limit prints a `WARNING` line with the value and the limit, an annotation `::warning::` on GitHub and a warning in the CI summary, and the check passes (`make bundle-size`, `make bench`). A measuring script fails only for a usage error or a missing input.
  Enforced by: `make hyper-test-scripts`
- Own: Every GitHub workflow runs its jobs on `ubuntu-26.04-arm`, pins each action by its commit, sets no `timeout-minutes`, and runs every command of a step as one make target, never a script or a tool directly, so that the settings and the checks of the Makefile apply to it (HR-90).
  Enforced by: `make hyper-test-scripts`
- Own: An output that another process may read while it is written again is published without a missing or partly written file (HR-82): a file with one rename (`writeFileAtomic`), and a directory from a staging directory of the writing process, file by file (`scripts/publish.mts`). No recipe removes an output and then writes it. A resource that two processes may write at once, such as a package manager install or the full run, is held with a lock of `holder-lock` of `@polyspec/kit`. Every other resource of a run, such as a port, a database or a temporary directory, belongs to that run alone.
  Enforced by: none, which writes are atomic is judged by reading the code.
- Own: A check reads tool output in a form that the context of the run and an unpinned release do not change (HR-83): a make dry run through `dryRun` of `tests/scripts/make-dry-run.mts`, a machine-readable form where the tool has one, and other text only of a tool pinned by HR-81.
  Enforced by: none, which output form a check reads is judged by reading the code.
- Own: A check passes only when it checked something (HR-84): a test run with no test that ran, a selection or a list that selects nothing, and a node test file that awaits at its top level, each fail. A failure states where it is reported, what was expected, what happened, and the output that shows the cause. A timeout names the step, and the full run prints the last lines of each failed target.
  Enforced by: none, the runners of each ecosystem do not report an empty selection as a failure.
- Own: A test creates what it reads (HR-85): it copies the tracked files of a fixture into its own temporary directory. An input that another target writes, such as an install or a build, is named with `requireBuilt` and that target before the test reads it. A build output holds no absolute path of its checkout, and no build directory is shared between checkouts.
  Enforced by: `make hyper-test-scripts`
- Own: A run of several checks runs every check to its end and then fails, naming each failed check (HR-86): a recipe uses `$(call check,...)` and `$(checks_result)`, a make with several checking goals runs with `-k`, and a CI step after the first runs with `if: ${{ !cancelled() }}`. Only a step that reads the output of an earlier step stops at its failure.
  Enforced by: `make hyper-test-scripts`
- Own: No process or file of a run outlives it (HR-87): a run owns its servers and its temporary directory from their creation, and stops, awaits and removes them on its end, its failure, and SIGINT and SIGTERM. A test removes a directory only after the processes that use it have exited.
  Enforced by: none, a process that outlives its run is found by reading the code.
- Own: Every tracked path has owners in `config/owner-checks.json` (HR-88). A change that adds a path adds its owner rule, and a test that copies part of the repository copies what that part imports.
  Enforced by: `make owner-validate`
- Own: The shared tools are the npm package `@polyspec/kit`, which `package.json` pins by the URL of its release asset and `package-lock.json` by its integrity. A fresh checkout runs `make bootstrap`, which invokes native npm at the version of `packageManager` to install the lock, followed by `make install-tools TOOLS=npm` and `make install-packages`. The Makefile includes `node_modules/@polyspec/kit/scripts/kit/kit-bootstrap.mk` from the installed package; a native local package link is optional, and the files of `kit.copies` of the package, including `PRINCIPLES.md`, its twin, `.editorconfig` and `.claude/settings.json`, are regular copies that `make kit-sync` writes atomically from the installed package. Installed package source links remain local development state. A copy is changed only in kit. This repository differs from another only in `config/*.json` and in its own scripts. Never modify the Kit checkout to complete application work. Report a shared-tool defect or missing capability as a GitHub issue in polyspec/kit with reproduction, expected and actual behavior and application impact, and request its correction. Every local and CI runtime test uses the installed Kit runner; do not replace it, disable its guards, narrow required coverage or treat a bypassed result as release evidence. A supported Kit selection may be used while its separate defect is reported. Release publication requires successful required CI and native archive proof through Kit.
  Enforced by: `make kit-check`
- Own: Keep code and tests in separate directories inside each package.
  Enforced by: `make layout-check`
- Own: Use repository-relative paths for the paths that this repository creates and for the paths it names in a tracked file. A path is resolved declaratively, by a name in a tracked file, or by discovery under a discovery rule that a document or a script states. Require explicit paths for external inputs.
  Enforced by: none, whether a path is declared or discovered is judged by reading the code.
- Own: No recipe or script creates a symbolic link. npm and Composer install with their own defaults, and their links are accepted: the npm packages of this repository are npm workspaces, which npm links, and a recipe starts a tool through the bin link of npm by its absolute path. Composer links the PHP package of this repository to its source directory, and each polyspec package below a `vendor` is such a link (HR-79).
  Enforced by: none, a symbolic link made by a recipe is found by reading the code.
- Own: Template syntax and rendering rules belong to the template language. This repository uses them and does not change them.
  Enforced by: none, a change to the template language is found by review.

## Decision and acceptance rules

- Refines P3: Define the invariant, the acceptance condition and the failure condition in `docs/spec/protocol.md` before changing an implementation. Tests cite the rule identifiers (`HY-n`).
  Enforced by: none, whether a test cites a rule identifier is judged by review.
- Own: Server rendering and browser rendering of the same region produce the same bytes. `make parity` is the evidence for that invariant.
  Enforced by: `make parity`
- Refines S4: Use the latest stable dependency release that supports the declared runtime range. Record every exact pin with its reason and its removal condition in `docs/operations/dependencies.md`.
  Enforced by: `make dependency-policy-check`

## Changes and history

- Own: Write documents and translations in direct language: name the action, state the subject and the object, explain a cause in one sentence, and avoid figurative or colloquial wording.
  Enforced by: none, the directness of a sentence is judged by review.
- Own: Every change adds its entry under `## Unreleased` at the top of `CHANGELOG.md` and `CHANGELOG.ko.md`.
  Enforced by: none, no tool checks that a change has its entry.

## Required checks

- Own: Before a commit, run `make docs-check`. Do not run `make owner-check`, `make check` or an end-to-end check, such as Apple `container`, a browser, parity or a server of a run, locally before a commit or a push: CI runs them after the push.
  Enforced by: `make docs-check`, `make check` (its guard refuses a run before the work of the checklist is done)
- Refines P26: Before marking a task `[o]` in `docs/plans/execution/checklist.md`, run the verification command of the task on the committed tree. The Verification column names the command that owns the task, not `make check`. Rows that are already `[o]` keep their command.
  Enforced by: `make docs-check`
- Own: No local `make check` is required before a commit or push. After checklist development finishes, a requested local final suite runs exactly once, never per fix or per task. `make check` uses the native kit report runner with `FINAL_RUN=1`, which refuses active `[~]` items and a dirty or uncommitted tree. The once-only procedure is a working rule, not a runner guard. Preserve its report and rerun only failed owners after repairs (`docs/operations/development.md`). A feature is marked implemented only after its full target run passes in CI or the local final suite.
  Enforced by: `make check`
- Own: For the push of `main` and every manual run (`workflow_dispatch`), GitHub runs the full suite in the jobs of `.github/workflows/ci.yml`, one per CI group, every target to its end. Each job writes the job summary and uploads the report `var/ci/<name>/` with the status, the time, the first failure lines and the full log of each target (HR-91). This is where the full suite and the end-to-end checks run. Fix every failure that it names before the next push. Known limit: the CI runner is Linux, so `make virtiofs-check`, the target of the full suite on Darwin only (`DARWIN_TARGETS`, HR-68), runs only when someone runs a local `make check` on a Mac.
  Enforced by: `make ci-passed`
- Own: A push happens only when no task of `docs/plans/execution/checklist.md` is `[~]`, and it runs no test, neither in a pushed commit nor in the working tree. The tracked pre-push hook `.githooks/pre-push`, which `make hooks` writes, runs `make push-gate-hook`, the push gate of `@polyspec/kit`. That gate refuses such a push and names each active ID with its task. Every `make` run sets `core.hooksPath` to `.githooks`. `make hooks-check` fails while it is not set or the hook differs. `make push-gate-commit COMMIT=<sha>` runs the same gate on a commit for a push that skipped the hook, and the CI group `docs` runs it (`docs/operations/development.md`).
  Enforced by: `make push-gate-hook`, `make hooks-check`
- Own: Until version 0.1 a change is checked by the unit tests that own it, and `main` is pushed once, when every task of the checklist is `[o]` (HR-94). There is no pull request, no merge queue and no GitHub ruleset, and the push is `git push origin main`. The push of `main` runs `.github/workflows/ci.yml`, whose last job `ci-passed` passes only when every other job of the workflow passed. The CI run of that push is the evidence of the commit, and a release tag is set only after `ci-passed` succeeded for the tagged commit (`docs/operations/development.md`).
  Enforced by: `make ci-passed`

- Own: Each application CI group declares the tools and locked package environments it executes, installs them in its own job through shared tool selection and native package managers, and builds its own inputs. A parity group prepares every compared implementation independently and consumes no other language job’s installed environment or build output. The final job only judges the required job results.
  Enforced by: `make hyper-test-scripts`

## Release

- Own: Until version 0.1 `main` is pushed once, when every task is done, and the CI run of that push is the evidence of its commits. A release is a tag of a commit of `main` whose CI run concluded `ci-passed` success (HR-95). Only the maintainer creates, moves or pushes a tag.
  Enforced by: `make release-verify`
- Own: The version-bump commit `chore(release): Release X.Y.Z (#<task>)` sets the version X.Y.Z in `package.json`, `packages/client/package.json`, `packages/server/ts/package.json`, `packages/build/package.json`, `packages/server/php/composer.json` and `packages/server/python/pyproject.toml`. It sets the requirement of `@polyspec/hyper-client` in `packages/server/ts/package.json` and `packages/build/package.json`, and the requirement of `polyspec/hyper-server` in the private root `composer.json` and `examples/board/composer.json`, with its lock. It also sets the consumer projects of `tests/release-install`, whose manifests and locks `make release-consumer-lock TAG=vX.Y.Z` writes after `make release-assets TAG=vX.Y.Z`. It renames `## Unreleased` of both changelogs to `## X.Y.Z`, with a new empty `## Unreleased` above it. The private test package `tests/package-install` keeps its own version, because it publishes nothing (`config/release.json`, `notReleased`), and the bump commit writes its lock again, so that the lock records the versions of the local packages.
  Enforced by: `make release-versions`
- Own: The maintainer tags the commit of `main` `vX.Y.Z` after its CI run concluded `ci-passed` success, and pushes the tag. The push runs `.github/workflows/release.yml`, which requires the tagged commit on `main` with the check `ci-passed` passed, the version in every manifest and the section `## X.Y.Z` in `CHANGELOG.md` and `CHANGELOG.ko.md`. It builds the package archives, named `<package>-<language>-<version>.<ext>`, and creates the GitHub Release (`docs/operations/development.md`).
  Enforced by: `make release-verify`, `make release-versions`

## Generated files

Generated files are never tracked in Git. This covers dependency installs (`node_modules/`, `vendor/`, virtual environments), build output (`dist/`, `target/`, `*.tsbuildinfo`), caches (`.cache/`, `__pycache__/`, `.pytest_cache/`), test run artifacts (`test-results/`, `playwright-report/`, PHPUnit caches) and tool downloads (`var/`). The only exceptions are files the repository deliberately needs, and only these are tracked: lock files (`package-lock.json`, `composer.lock`, `Cargo.lock`, uv locks, `mise.lock`), committed generated documents that this file names, and test fixtures. Each `.gitignore` covers these paths. A new generator adds its ignore entry in the same commit.
  Enforced by: `make staged-generated-hook`

## Checklist

- Refines P24: This repository has one checklist, `docs/plans/execution/checklist.md`. Split a task into sub-items or add tasks to it; do not create another checklist.
  Enforced by: `make docs-check`
- Own: A task ID has the form `H<wave>.<number>`, and a task row starts with it. `docs/plans/execution/plan.md` holds the dependencies and the background of each wave. A wave starts when the waves that it names as dependencies are done.
  Enforced by: `make docs-check`
- Refines P25: A task that is bypassed with `[!]` in `docs/plans/execution/checklist.md` is used only when the next task cannot proceed without bypassing it. When its retry condition holds, the task resumes without waiting for approval. An audit covers only the bypassed tasks with their causes and retry conditions, and does not repeat unrelated full test runs.
  Enforced by: none, whether the next task can proceed is a judgement.
- Own: A received instruction is classified first: a task of the checklist, a rule of this file, a note of the agent memory, or an answer only. The agent memory holds only what the requester and the agent need between sessions. What the project must keep goes into the repository (documents, comments, commit messages). Unless the instruction states that it is urgent, record it as a task with its priority and continue the task in progress. Rules belong in this file without duplication, never in the checklist or the changelog.
  Enforced by: none, the classification of an instruction is a judgement.
