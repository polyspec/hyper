<!-- doc-id: checklist-kit-standard -->
<!-- source-sha256: 6d51cbb38e424c38c01897f584c5ebe3982f35aef83e6a7f3825d00d0b7d6372 -->
# kit 표준 체크리스트

| ID | Task | Deliverables | Verification | State |
|---|---|---|---|---|
| H25.1 | 이 저장소는 kit 표준 0.0.54를 따른다 | kit 0.0.54의 복사본, AGENTS.md와 그 한국어 짝, config/*.json, Makefile, workflow, plan과 changelog | `make kit-check` | [o] |
| H25.2 | PHP 렌더러 테스트가 각 모드에서 생략 없이 끝까지 실행되고, Python 서버가 blind except 없이 ruff를 통과한다 | RendererTest.php의 native와 generated group, 다른 group을 제외하는 `hyper-test-php`의 PHPUnit 실행, Python 원본의 ruff 지적 8건 | `make hyper-test-php`, `make hyper-test-python`, `make lint-python` | [ ] |
| H25.3 | hyper 언어 parity를 config/parity.json에 선언하고 공유 벡터의 각 case를 id로 부른다 | config/parity.json; id on each case of contracts/*.json; conformance tests of TypeScript, Python and the browser package named by id; Python tests of Fields.has and FileSessions.collect | `make parity-declarations-check`; `make parity-check UNITS="fields-urlencoded json-encode csrf-verify routes keep"`; `var/tools/bin/node node_modules/vitest/vitest.mjs run --dir packages/server/ts packages/server/ts/tests/fields.test.ts` | [!] 원인: parity 선언 검사가 아직 실패한다: PHP, Python, Node 서버 test 파일 다수에 unit이 없고, Python client 적합성에는 template 패키지가 필요하며, R13은 모든 spec 요구사항이 unit에 인용되기를 요구한다; 재시도: 모든 test 파일에 unit이 생기고 모든 요구사항이 인용되며 Python client 바인딩용 template 패키지가 설치될 때 재개한다 |
