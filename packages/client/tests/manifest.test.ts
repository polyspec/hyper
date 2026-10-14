import { describe, expect, it } from 'vitest';
import { checkManifest, type Manifest } from '../src/manifest.js';

const valid = (): Manifest => ({
  layout: 'layout.tpl',
  title: 'title.tpl',
  regions: [{ name: 'content', page: true }],
  routes: [{ name: 'home', path: '/', title: 'Home', template: 'home.tpl', regions: [{ name: 'rows', template: 'rows.tpl' }] }],
});

// HY-1, HY-2, HY-30: the checks that the PHP manifest reader also applies.
describe('checkManifest', () => {
  it('accepts a complete manifest', () => {
    expect(checkManifest(valid())).toEqual(valid());
  });

  it('rejects a manifest without a layout or title template', () => {
    expect(() => checkManifest({ ...valid(), layout: undefined } as unknown as Manifest)).toThrow('layout or title');
    expect(() => checkManifest({ ...valid(), title: 1 } as unknown as Manifest)).toThrow('layout or title');
  });

  it('rejects a route without a name, title or template', () => {
    const route = valid().routes[0]!;
    expect(() => checkManifest({ ...valid(), routes: [{ ...route, name: '' }] })).toThrow('route name');
    expect(() => checkManifest({ ...valid(), routes: [{ ...route, title: undefined } as unknown as typeof route] })).toThrow('title or template');
    expect(() => checkManifest({ ...valid(), routes: [{ ...route, template: undefined } as unknown as typeof route] })).toThrow('title or template');
  });

  it('rejects a route region without a template', () => {
    const route = valid().routes[0]!;
    expect(() => checkManifest({ ...valid(), routes: [{ ...route, regions: [{ name: 'rows' } as unknown as { name: string; template: string }] }] })).toThrow('route region rows');
  });

  it('rejects kept paths on a manifest region, because only route regions keep values (HY-37)', () => {
    expect(() => checkManifest({ ...valid(), regions: [{ name: 'side', template: 'side.tpl', keep: { a: 'server' } }, { name: 'content', page: true }] })).toThrow('manifest region side cannot keep values');
    expect(() => checkManifest({ ...valid(), regions: [{ name: 'content', page: true, keep: { a: 'server' } }] })).toThrow('manifest region content cannot keep values');
    const route = valid().routes[0]!;
    expect(checkManifest({ ...valid(), routes: [{ ...route, regions: [{ name: 'rows', template: 'rows.tpl', keep: { a: 'server' } }] }] }).routes[0]!.regions![0]!.keep).toEqual({ a: 'server' });
  });
});
