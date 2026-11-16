import { describe, expect, it } from 'vitest';
import { checkManifest, checkTemplateIndex, createApplication, HyperValueError, routeReads, type Manifest } from '../src/index.js';

const manifest = (path: string): Manifest => ({
  layout: 'layout.tpl',
  title: 'title.tpl',
  regions: [{ name: 'content', page: true }],
  routes: [{ name: 'home', path, title: 'Home', template: 'home.tpl' }],
});

function failure(open: () => unknown): unknown {
  try {
    open();
  } catch (error) {
    return error;
  }
  throw new Error('the check did not fail');
}

function expectInvalidApplication(error: unknown, message: string): void {
  expect(error).toBeInstanceOf(HyperValueError);
  expect(error).toBeInstanceOf(RangeError);
  expect(error).toMatchObject({ kind: 'invalid_application', status: null, message });
}

// HY-132.7, HY-106.21, HY-132.4: a failure of a check at open is a HyperValueError of kind invalid_application, and its
// message has no prefix of a runtime.
describe('the checks at open', () => {
  it('checkManifest fails with kind invalid_application', () => {
    expectInvalidApplication(failure(() => checkManifest({})), 'the manifest has no layout or title template');
  });

  it('checkTemplateIndex fails with kind invalid_application', () => {
    expectInvalidApplication(failure(() => checkTemplateIndex([])), 'the template index is not an object of templates');
  });

  it('createApplication fails with kind invalid_application', () => {
    expectInvalidApplication(failure(() => createApplication(manifest('home'), {}, () => Promise.reject(new Error('no fetch')))), 'route path "home" does not start with /');
  });

  it('routeReads fails with kind invalid_application', () => {
    const noPage: Manifest = { ...manifest('/'), regions: [] };
    expectInvalidApplication(failure(() => routeReads(noPage, () => { throw new Error('no template'); }, (_from, path) => path)), 'the manifest must declare exactly one page region');
  });
});
