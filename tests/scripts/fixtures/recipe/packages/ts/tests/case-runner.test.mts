import { test } from 'node:test';
import { steps as csrfSteps } from './steps/csrf.ts';
import { steps as mediaTypeSteps } from './steps/media-type.ts';

function prefixed(file: string, steps: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(steps).map(([section, step]) => [`${file} ${section}`, step]));
}

export const STEPS = {
  ...prefixed('csrf.json', csrfSteps),
  ...prefixed('media-type.json', mediaTypeSteps),
};

test('cases', () => {});
test('build', () => {});
