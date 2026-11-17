// What a value outside the data model gives when a step of a page receives it through the Node binding of the core
// (HY-44.12). The test drives the built addon of `native/generated`, not a stand-in. Two places refuse a value. The
// binding converts each value of the map of a step when `PageRequest.next` receives it and refuses a value that has no
// form in the data model; its message has the form `kind: text` (HY-44.12), the text of an error of the template
// language that names no template and no place. The check of the core refuses a converted value; its message has the
// form `kind: text`. Each row states the class, the kind and the whole message of the error that the caller receives.
import { describe, expect, it } from 'vitest';
import { addon, pages as routePages, type Step } from './core-addon.ts';

const pages = (): object => routePages('<p>{= title}</p>\n', new Map());

// The request of a region JSON response of the route `home`, at the step that asks for the shared data.
function atShared(): { next(input: object): Step } {
  const input = { route: 'home', params: new Map(), kind: 'region_json', action: false, csrf: 'token', changed: [], now: 0 };
  const page = new addon.PageRequest(pages(), input);
  const first = page.next({ input: 'start' });
  expect(first.call?.call).toBe('shared');
  return page;
}

// What `next` gives for the shared data: the class, the kind and the message of its error, or the name of its next call.
function sharedGives(shared: unknown): unknown {
  const page = atShared();
  let step: Step;
  try {
    step = page.next({ input: 'shared', shared });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return `${error.constructor.name} ${String(Reflect.get(error, 'kind'))} | ${error.message}`;
  }
  return step.call?.call ?? step.answer?.answer;
}

// Compares what `next` gives; a failure states the whole text that it gave, which the reporter would cut.
function expectGives(shared: unknown, expected: string): void {
  const given = sharedGives(shared);
  expect(given, `the step gave: ${String(given)}`).toBe(expected);
}

// A value whose lists nest `levels` deep.
function lists(levels: number): unknown {
  let value: unknown = 1;
  for (let level = 0; level < levels; level += 1) value = [value];
  return value;
}

class Money {
  readonly amount = 1;
}

describe('a value of the shared data through the Node binding of the core (HY-44.12)', () => {
  it.each([
    ['a number outside the safe range', 2 ** 53, 'HyperValueError data_number_range | data_number_range: number 9007199254740992 is outside the safe range'],
    ['a bigint outside the safe range', 2n ** 53n + 1n, 'HyperValueError data_number_range | data_number_range: number 9007199254740993 is outside the safe range'],
    ['a number that is not a number', Number.NaN, 'HyperValueError data_number_not_finite | data_number_not_finite: number is not finite'],
    ['an infinite number', Number.POSITIVE_INFINITY, 'HyperValueError data_number_not_finite | data_number_not_finite: number is not finite'],
    ['a Date', new Date(0), 'HyperTypeError data_unsupported_type | data_unsupported_type: a date is not a template value'],
    ['a function', () => 1, 'HyperTypeError data_unsupported_type | data_unsupported_type: a function is not a template value'],
    ['a string with a lone surrogate', '\uD800', 'HyperValueError data_invalid_utf8 | data_invalid_utf8: a string is not valid Unicode text: invalid utf-16: lone surrogate found'],
    ['lists 65 levels deep', lists(65), 'HyperValueError data_depth | data_depth: lists and maps nest deeper than 64 levels'],
  ])('the conversion of the binding refuses %s', (_label, value, expected) => {
    expectGives(new Map([['value', value]]), expected);
  });

  // The conversion counts the levels of each value of the map alone, so it passes 64 lists; the check of the core counts
  // the map of the shared data and the map that holds it as well (HY-44.11), so 63 lists are 65 levels.
  it.each([
    ['lists 64 levels deep', lists(64), 'HyperValueError data_depth | data_depth: lists and maps nest deeper than 64 levels'],
    ['lists 63 levels deep', lists(63), 'HyperValueError data_depth | data_depth: lists and maps nest deeper than 64 levels'],
    ['an application object', new Money(), 'HyperTypeError data_unsupported_type | data_unsupported_type: a native object has no JSON form'],
  ])('the check of the core refuses %s', (_label, value, expected) => {
    expectGives(new Map([['value', value]]), expected);
  });

  it('a plain object in place of the Map of the shared data fails with a kind of the binding', () => {
    expectGives({ value: 1 }, 'HyperTypeError invalid_argument_type | shared is not an instance of a Map whose keys are strings');
  });

  it.each([
    ['a plain object inside the map', { title: 'a' }],
    ['a Map inside the map', new Map([['title', 'a']])],
    ['a bigint within the safe range', 2n ** 53n - 1n],
    ['lists 62 levels deep', lists(62)],
  ])('%s is converted, and the request goes on', (_label, value) => {
    expectGives(new Map([['value', value]]), 'route_loader');
  });
});
