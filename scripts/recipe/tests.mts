// Tests of the recipe check (HYR-7): each runner is a test of its language, each native test is named with a reason in the
// test tree of its scope, names are literals, and every reader test is named by the spec.
import { LANGS, RUNNERS, type Runner } from './types.mts';
import type { Ctx } from './context.mts';
import { testKey } from './names.mts';

export function checkTests(ctx: Ctx): void {
  const { spec, sources, add } = ctx;
  const units = spec.concerns.flatMap((c) => c.units);
  const readerTests = new Set(LANGS.flatMap((l) => sources[l].tests.map((t) => `${t.file}::${t.name}`)));
  const named = new Set<string>();
  for (const r of RUNNERS) {
    named.add(spec.runners[r].runner);
    if (!readerTests.has(spec.runners[r].runner)) add('RUNNER_MISSING', `${r} runner ${spec.runners[r].runner} is not a test`);
  }
  // HYR-7: a native test is named with a reason, and lies in the test tree of the one language that its scope names.
  const nativeTest = (ref: string, label: string, scope: Runner[] | undefined): void => {
    const key = testKey(ref);
    named.add(key);
    if (ref.slice(key.length + 2).trim() === '') add('NATIVE_REASON', `${label} names native test ${key} without a reason`);
    if (scope !== undefined && scope.length !== 1) add('NATIVE_SCOPE', `${label} names native test ${key} but its only does not name exactly one language`);
    const lang = LANGS.find((l) => l === (scope?.length === 1 ? scope[0] : undefined));
    const tests = lang === undefined ? [...readerTests] : sources[lang].tests.map((t) => `${t.file}::${t.name}`);
    if (!tests.includes(key)) add('NATIVE_TEST_MISSING', `${label} names native test ${key}, which is not a test`);
  };
  for (const c of spec.concerns) {
    if (!Array.isArray(c.cases)) for (const ref of c.cases.tests) nativeTest(ref, `concern ${c.id}`, undefined);
  }
  for (const u of units) {
    for (const ref of u.tests ?? []) nativeTest(ref, `unit ${u.id}`, u.only?.languages);
    for (const m of u.members) for (const ref of m.tests ?? []) nativeTest(ref, `member ${m.id}`, m.only?.languages);
  }
  for (const lang of LANGS) for (const d of sources[lang].dynamicTests) add('TEST_NAME_DYNAMIC', `${lang} ${d.file}:${d.line} names a test by something other than a literal (HYR-7)`);
  for (const key of readerTests) {
    if (!named.has(key)) add('TEST_UNNAMED', `${key} is a test that the spec does not name`);
  }
}
