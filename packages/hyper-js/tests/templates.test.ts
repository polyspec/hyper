import { describe, expect, it } from 'vitest';
import { parse } from '@polyspec/template';
import { templateReferences } from '../src/index.js';

describe('templateReferences (HY-34)', () => {
  it('returns include and block paths resolved against the template name, sorted and unique', () => {
    const source = '{+ part.tpl}{# /shared/card.tpl x:1}{# rows}{# ../top.tpl}{?# side}y{/}{@ i = list}{+ part.tpl}{/}';
    expect(templateReferences(parse(source, 'board/list.tpl'), 'board/list.tpl')).toEqual(['board/part.tpl', 'shared/card.tpl', 'top.tpl']);
  });

  it('returns nothing for a template without path references', () => {
    expect(templateReferences(parse('{# content}{= x}', 'layout.tpl'), 'layout.tpl')).toEqual([]);
  });
});
