import { describe, expect, it } from 'vitest';
import { checkTemplateIndex } from '../src/index.js';

// HY-34: the template index names the URL of each template.
describe('checkTemplateIndex', () => {
  it('returns the URL of each template by its name', () => {
    expect(checkTemplateIndex({ 'home.tpl': { url: '/t/home.json' }, 'rows.tpl': { url: '/t/rows.json' } })).toEqual({ 'home.tpl': { url: '/t/home.json' }, 'rows.tpl': { url: '/t/rows.json' } });
  });

  it('rejects a value that is not an object, naming its source', () => {
    expect(() => checkTemplateIndex([], 'build/templates.index.json')).toThrow('hyper: build/templates.index.json is not an object of templates');
    expect(() => checkTemplateIndex(null)).toThrow('hyper: the template index is not an object of templates');
  });

  it('rejects a template without a string URL', () => {
    expect(() => checkTemplateIndex({ 'home.tpl': {} })).toThrow('hyper: template home.tpl has no URL in the template index');
    expect(() => checkTemplateIndex({ 'home.tpl': { url: 1 } }, 'index.json')).toThrow('template home.tpl has no URL in index.json');
  });
});
