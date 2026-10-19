<!-- doc-id: checklist-kit-standard -->
<!-- source-sha256: 6d51cbb38e424c38c01897f584c5ebe3982f35aef83e6a7f3825d00d0b7d6372 -->
# kit 표준 체크리스트

| ID | Task | Deliverables | Verification | State |
|---|---|---|---|---|
| H25.1 | 이 저장소는 kit 표준 0.0.54를 따른다 | kit 0.0.54의 복사본, AGENTS.md와 그 한국어 짝, config/*.json, Makefile, workflow, plan과 changelog | `make kit-check` | [o] |
| H25.2 | PHP 렌더러 테스트가 각 모드에서 생략 없이 끝까지 실행되고, Python 서버가 blind except 없이 ruff를 통과한다 | RendererTest.php의 native와 generated group, 다른 group을 제외하는 `hyper-test-php`의 PHPUnit 실행, Python 원본의 ruff 지적 8건 | `make hyper-test-php`, `make hyper-test-python`, `make lint-python` | [ ] |
