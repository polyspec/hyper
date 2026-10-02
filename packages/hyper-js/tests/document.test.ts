// The html element of a client-rendered document (HY-63).
import { describe, expect, it } from 'vitest';
import { replaceAttributes, type AttributeElement } from '../src/index.js';

// An element that keeps its attributes in order, as a browser element does.
class Element implements AttributeElement {
  private readonly list: { name: string; value: string }[];

  constructor(attributes: [string, string][]) {
    this.list = attributes.map(([name, value]) => ({ name, value }));
  }

  get attributes(): { name: string; value: string }[] {
    return [...this.list];
  }

  setAttribute(name: string, value: string): void {
    const found = this.list.find((attribute) => attribute.name === name);
    if (found === undefined) this.list.push({ name, value });
    else found.value = value;
  }

  removeAttribute(name: string): void {
    const index = this.list.findIndex((attribute) => attribute.name === name);
    if (index >= 0) this.list.splice(index, 1);
  }
}

describe('replaceAttributes (HY-63)', () => {
  it('gives the html element the language of the rendered document', () => {
    const page = new Element([['lang', 'ko']]);
    replaceAttributes(page, new Element([['lang', 'en'], ['dir', 'ltr']]));
    expect(page.attributes).toEqual([{ name: 'lang', value: 'en' }, { name: 'dir', value: 'ltr' }]);
  });

  it('removes an attribute that the rendered html element does not have', () => {
    const page = new Element([['lang', 'ko'], ['class', 'shell']]);
    replaceAttributes(page, new Element([['class', 'page']]));
    expect(page.attributes).toEqual([{ name: 'class', value: 'page' }]);
  });

  it('sets the language on a shell without attributes', () => {
    const page = new Element([]);
    replaceAttributes(page, new Element([['lang', 'en']]));
    expect(page.attributes).toEqual([{ name: 'lang', value: 'en' }]);
  });
});
