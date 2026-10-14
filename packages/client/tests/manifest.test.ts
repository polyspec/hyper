import { describe, expect, it } from 'vitest';
import { checkManifest, type Manifest, type RouteDeclaration } from '../src/manifest.js';

const home = (): RouteDeclaration => ({ name: 'home', path: '/', title: 'Home', template: 'home.tpl', regions: [{ name: 'rows', template: 'rows.tpl' }] });

const valid = (): Manifest => ({
  layout: 'layout.tpl',
  title: 'title.tpl',
  regions: [{ name: 'content', page: true }],
  routes: [home()],
});

// HY-1, HY-2, HY-30: the checks that the PHP manifest reader also applies.
describe('checkManifest', () => {
  it('accepts a complete manifest', () => {
    expect(checkManifest(valid())).toEqual(valid());
  });

  it('rejects a manifest without a layout or title template', () => {
    expect(() => checkManifest({ ...valid(), layout: undefined })).toThrow('layout or title');
    expect(() => checkManifest({ ...valid(), title: 1 })).toThrow('layout or title');
  });

  it('rejects a route without a name, title or template', () => {
    const route = home();
    expect(() => checkManifest({ ...valid(), routes: [{ ...route, name: '' }] })).toThrow('route name');
    expect(() => checkManifest({ ...valid(), routes: [{ ...route, title: undefined }] })).toThrow('title or template');
    expect(() => checkManifest({ ...valid(), routes: [{ ...route, template: undefined }] })).toThrow('title or template');
  });

  it('rejects a manifest that is not an object or whose regions or routes are not lists', () => {
    expect(() => checkManifest(null)).toThrow('layout or title');
    expect(() => checkManifest({ ...valid(), regions: {} })).toThrow('regions of the manifest are not a list');
    expect(() => checkManifest({ ...valid(), routes: 'home' })).toThrow('routes of the manifest are not a list');
    expect(() => checkManifest({ ...valid(), routes: [{ ...home(), path: 1 }] })).toThrow('route home has no path');
  });

  it('rejects a route region without a template', () => {
    const route = home();
    expect(() => checkManifest({ ...valid(), routes: [{ ...route, regions: [{ name: 'rows' }] }] })).toThrow('route region rows');
  });

  it('rejects kept paths on a manifest region, because only route regions keep values (HY-37)', () => {
    expect(() => checkManifest({ ...valid(), regions: [{ name: 'side', template: 'side.tpl', keep: { a: 'server' } }, { name: 'content', page: true }] })).toThrow('manifest region side cannot keep values');
    expect(() => checkManifest({ ...valid(), regions: [{ name: 'content', page: true, keep: { a: 'server' } }] })).toThrow('manifest region content cannot keep values');
    const route = home();
    expect(checkManifest({ ...valid(), routes: [{ ...route, regions: [{ name: 'rows', template: 'rows.tpl', keep: { a: 'server' } }] }] }).routes[0]?.regions?.[0]?.keep).toEqual({ a: 'server' });
  });
});
