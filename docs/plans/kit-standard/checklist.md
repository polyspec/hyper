<!-- doc-id: checklist-kit-standard -->
# Kit standard checklist

| ID | Task | Deliverables | Verification | State |
|---|---|---|---|---|
| H25.1 | The repository follows the kit standard 0.0.54 | The copies of kit at 0.0.54, AGENTS.md and its Korean twin, config/*.json, the Makefile, the workflows, the plans and the changelogs | `make kit-check` | [o] |
| H25.2 | The PHP renderer tests run in full in each mode, and the Python server passes ruff with no blind except | RendererTest.php with a native and a generated group, the PHPUnit runs of hyper-test-php that exclude the other group, the eight ruff findings of the Python sources | `make hyper-test-php`, `make hyper-test-python`, `make lint-python` | [ ] |
