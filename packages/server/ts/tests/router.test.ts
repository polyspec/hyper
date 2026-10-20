// The route paths that a router refuses, beyond the cases of contracts/routes.json and contracts/rest.json (HY-4, HY-49).
import { expect, it } from 'vitest';
import { Router } from '@polyspec/hyper-client';
import { list, routeContract, text } from './support.js';

it('rejects every invalid route path (HY-4)', () => {
  for (const contract of ['routes.json', 'rest.json']) {
    for (const path of list(routeContract(contract).fixture.invalidPaths).map(text)) {
      expect(() => new Router([{ name: 'invalid', path }]), path).toThrow();
    }
  }
});
