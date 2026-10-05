# Development

[한국어](AGENTS.ko.md).

## Documents

- Every document has a `.ko.md` file with the same information. Edit both in the same change.
- One authoritative document per topic. The protocol contract is in `docs/spec/`. Implementation and verification status is in `docs/features.md`. Planned tasks, their verification commands and their completion are in `docs/plans/execution-checklist.md`; every change belongs to a task there, and a task is added before its work starts. Current procedures are in `docs/operations/`. Actual changes and their verification results are in `CHANGELOG.md`.
- Documents describe current behavior. When the direction changes, change the specification first and mark parts that are not implemented.
- A behavior change, its documents, its feature status row and its changelog entry are one change.
- `make docs-check` verifies document pairs, links and identical code blocks. Content accuracy is verified by reading the code and the tests.

## Implementation

- Do not keep backward compatibility. Remove old paths instead of adding compatibility layers, fallbacks or migrations.
- Use the simplest implementation that fully meets the current requirements. Do not add abstractions, configuration or indirection for uncertain future needs.
- Separate concerns into modules. Split a file that has more than one responsibility.
- Do not use temporary scripts or folders. Every check is a Makefile target, a script under `scripts/`, or a committed test, and is idempotent.
- Keep code and tests in separate directories inside each package.
- Handle a defect by adding a failing test that reproduces it, fixing the code, and keeping the test.
- Use repository-relative paths. Require explicit paths for external inputs.
- Do not use symbolic links. Package managers install every dependency, also a package of this repository, as a copy, and no bin link; a recipe starts a tool with the file of its package (HY-79).
- Template syntax and rendering rules belong to the template language. This repository uses them and does not change them.

## Decision and acceptance rules

- Define the invariant, acceptance condition and failure condition in `docs/spec/protocol.md` before changing an implementation. Tests cite the rule identifiers (`HY-n`).
- Never weaken, skip or remove an accepted condition to make a failing implementation pass. Fix the implementation.
- Server rendering and browser rendering of the same region must produce the same bytes. `make parity` is the evidence for that invariant.
- Use the latest stable dependency release that supports the declared runtime range. Record every exact pin with its reason and its removal condition in `docs/operations/dependencies.md`.

## Changes and history

- Write commit messages, comments, documents and translations in direct language: name the action, state the subject and the object, explain a cause in one sentence, and do not use figurative or colloquial wording. Provide the same information in English and Korean.
- A commit message is written in English as `type(scope): Subject (#task)`, a blank line, then a body that states what changed and why, wrapped at 72 characters. The type is one of `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`. The subject has at most 50 characters, starts with a capital letter, is imperative and ends without a period.
- Work may be done on `main` directly. A branch or worktree, used for an agent or when the situation needs one, is named `{type}/{shortname}-{task id}` and `{project}-{shortname}-{task id}`, and is removed as soon as it is merged into `main`.
- Test code that cannot be merged into `main` is removed before the commit, or cherry-picked when it is worth keeping. When it cannot be removed at once, a checklist sub-item records it with its removal condition.

## Required checks

- Before a commit, run the Red and Green tests that own the change and `make docs-check`. Do not run broader checks for each fix.
- Before marking a task `[o]` in `docs/plans/execution-checklist.md`, run the verification command of the task on the committed tree. The Verification column names the command that owns the task, not `make check`; rows that are already `[o]` keep their command.
- Run `make check` exactly once, when every active task is done, and never for each fix or each task. The guard `scripts/full-run.mjs` enforces this before any step: `make check` is refused while a task is `[~]`, while tracked changes are uncommitted, and when `var/full-run.json` records a full run of the current tree; `make rerun-failed` reruns only the targets of the current tree that did not pass (`docs/operations/development.md`). Mark a feature implemented in `docs/features.md` only after that run passes.

## Checklist

- This repository has one checklist, `docs/plans/execution-checklist.md`. Split a task into sub-items or add tasks to it; do not create another checklist. Every repository keeps its own checklist.
- A task has one of four states: `[ ]` waiting, `[~]` in progress, `[o]` done, `[!] cause: <cause>; retry: <condition>` bypassed. `make docs-check` accepts no other state.
- `[!]` is used only when the next task cannot proceed without bypassing this one. When the retry condition holds, resume the task without waiting for approval. `[!]` is not done. An audit covers only the `[!]` tasks with their causes and retry conditions and does not repeat unrelated full test runs.
- A new problem gets a new task. A problem related to a task that is `[o]` gets a sub-item with the next derived ID (`H5.2-1`, `H5.2-2`) that goes through `[~]` and `[o]`; the `[o]` task keeps its state.
- Independent tasks may run in parallel, but finishing a task in progress comes before starting a new one: the number of `[o]` tasks grows, not the number of `[~]` tasks.
- Uncommitted changes never span more than one task. When a task becomes `[o]`, its changelog entry and its commit are made in the same unit of work.
- A received instruction is classified first: a task of the checklist, a rule of this file, a note of the agent memory, or an answer only. The agent memory holds only what the requester and the agent need between sessions; what the project must keep goes into the repository (documents, comments, commit messages). Unless the instruction states that it is urgent, record it as a task with its priority and continue the task in progress. Rules belong in this file without duplication, never in the checklist or the changelog.
- Korean documents write technical terms in English and only the surrounding text in Korean.
