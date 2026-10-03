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
- Template syntax and rendering rules belong to the template language. This repository uses them and does not change them.

## Decision and acceptance rules

- Define the invariant, acceptance condition and failure condition in `docs/spec/protocol.md` before changing an implementation. Tests cite the rule identifiers (`HY-n`).
- Never weaken, skip or remove an accepted condition to make a failing implementation pass. Fix the implementation.
- Server rendering and browser rendering of the same region must produce the same bytes. `make parity` is the evidence for that invariant.
- Use the latest stable dependency release that supports the declared runtime range. Record every exact pin with its reason and its removal condition in `docs/operations/dependencies.md`.

## Changes and history

- Write commit messages, comments, documents and translations in direct language: name the action, state the subject and the object, explain a cause in one sentence, and do not use figurative or colloquial wording. Provide the same information in English and Korean.

## Required checks

- Run the tests of every changed package and `make docs-check` before a commit.
- Run `make check` before marking a feature implemented in `docs/features.md`.
- Run the verification command of a task on the committed tree before checking the task in `docs/plans/execution-checklist.md`.
