// The stylesheet links of a source head applied to the head of the page (HY-64).
import { describe, expect, it } from 'vitest';
import { planStylesheets, stylesheetKey } from '../src/stylesheets.js';

const base = 'http://site.test/board/7';

describe('stylesheetKey (HY-64)', () => {
  it('resolves the href of a stylesheet link against the page URL', () => {
    expect(stylesheetKey('stylesheet', '/assets/app.css', base)).toBe('http://site.test/assets/app.css');
    expect(stylesheetKey('stylesheet', 'reader.css', base)).toBe('http://site.test/board/reader.css');
    expect(stylesheetKey('stylesheet', 'http://site.test/assets/app.css', base)).toBe('http://site.test/assets/app.css');
  });

  it('finds the token stylesheet in any ASCII case among other tokens', () => {
    expect(stylesheetKey('StyleSheet', '/a.css', base)).toBe('http://site.test/a.css');
    expect(stylesheetKey('preload\tstylesheet', '/a.css', base)).toBe('http://site.test/a.css');
  });

  it('is null for a link without href or without the token stylesheet', () => {
    expect(stylesheetKey('stylesheet', null, base)).toBeNull();
    expect(stylesheetKey(null, '/a.css', base)).toBeNull();
    expect(stylesheetKey('icon', '/a.css', base)).toBeNull();
    expect(stylesheetKey('stylesheets', '/a.css', base)).toBeNull();
  });
});

describe('planStylesheets (HY-64)', () => {
  it('keeps every present link that the source has and inserts the missing ones in order', () => {
    expect(planStylesheets(['app', 'board'], ['app', 'board', 'reader'])).toEqual([
      { source: 0, kept: 0 },
      { source: 1, kept: 1 },
      { source: 2, kept: null },
    ]);
  });

  it('inserts every link of the source into a page without links', () => {
    expect(planStylesheets([], ['app', 'reader'])).toEqual([{ source: 0, kept: null }, { source: 1, kept: null }]);
  });

  it('keeps no link that the source does not have', () => {
    expect(planStylesheets(['app', 'reader'], ['app'])).toEqual([{ source: 0, kept: 0 }]);
  });

  it('inserts a new link for a present link that stands out of the source order', () => {
    expect(planStylesheets(['reader', 'app'], ['app', 'reader'])).toEqual([{ source: 0, kept: 1 }, { source: 1, kept: null }]);
  });

  it('counts a key of the source only at its first link', () => {
    expect(planStylesheets(['app'], ['app', 'reader', 'app'])).toEqual([{ source: 0, kept: 0 }, { source: 1, kept: null }]);
  });

  it('keeps the first present link of a key after the last kept link', () => {
    expect(planStylesheets(['app', 'app', 'reader'], ['app', 'reader'])).toEqual([{ source: 0, kept: 0 }, { source: 1, kept: 2 }]);
  });
});
