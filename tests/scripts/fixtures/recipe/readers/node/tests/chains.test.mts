import { describe, it, test } from 'node:test';
describe('suite', () => {
  it.each`
    a    | b
    ${1} | ${2}
  `('adds $a', () => {});
  test.skip('skipped', () => {});
  const runner = { test: (name: string, fn: () => void) => fn() };
  runner.test('via receiver', () => {});
});
