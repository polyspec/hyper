// The failure that a case step compares as `raises` (HY-132.2): only an error of hyper, whose classes include one named
// Hyper<Category>Error; any other error is an error of the step and fails the case as it was thrown.
import { expect, it } from 'vitest';
import { failureOf } from './case-rules.js';

class HyperValueError extends RangeError {
  readonly kind = 'data_depth';
}

it('reports an error of hyper as raises', () => {
  expect(
    failureOf(() => {
      throw new HyperValueError('too deep');
    }),
  ).toEqual({ result: null, raises: { kind: 'data_depth', status: null, category: 'value', message: 'too deep' } });
});

it('throws an error of the step again', () => {
  expect(() =>
    failureOf(() => {
      throw new TypeError('a step error');
    }),
  ).toThrow('a step error');
});
