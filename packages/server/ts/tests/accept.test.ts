// The Accept parser and the selection of the media type beyond the cases of contracts/representations.json (HY-116, RFC 9110 section 12.5.1).
import { describe, expect, it } from 'vitest';
import { InvalidAccept, parseAccept, selectType } from '../src/accept.js';

const PAGE = 'text/html';
const DATA = 'application/vnd.hyper+json';
const TYPES = [PAGE, DATA];

// Parses an Accept value that holds only the two types of the page and the data (HY-116).
function select(value: string): string | null {
  return selectType(parseAccept(value), TYPES);
}

describe('parseAccept', () => {
  it('reads an empty value as an empty list', () => {
    expect(parseAccept('')).toEqual([]);
    expect(parseAccept(' \t ')).toEqual([]);
  });

  it('reads the any range with weight 1', () => {
    expect(parseAccept('*/*')).toEqual([{ type: '*', subtype: '*', parameters: [], weight: 1 }]);
  });

  it('reads the ranges in order with their parameters before q and their weights', () => {
    expect(parseAccept('text/html;q=0.5, application/vnd.example.post+json;version=1;q=0.9')).toEqual([
      { type: 'text', subtype: 'html', parameters: [], weight: 0.5 },
      { type: 'application', subtype: 'vnd.example.post+json', parameters: [['version', '1']], weight: 0.9 },
    ]);
  });

  it('gives a range without q the weight 1', () => {
    expect(parseAccept('text/*')).toEqual([{ type: 'text', subtype: '*', parameters: [], weight: 1 }]);
  });

  it('reads the parameters of a range before q, so that the weight is not a parameter', () => {
    expect(parseAccept('text/html;level=1;q=0')).toEqual([{ type: 'text', subtype: 'html', parameters: [['level', '1']], weight: 0 }]);
  });

  it('reads an accept extension after q and does not read it as a parameter', () => {
    expect(parseAccept('application/vnd.example.post+json;q=0.5;version=2')).toEqual([
      { type: 'application', subtype: 'vnd.example.post+json', parameters: [], weight: 0.5 },
    ]);
  });

  it('reads an accept extension without a value after q', () => {
    expect(parseAccept('text/html;q=0.5;flag')).toEqual([{ type: 'text', subtype: 'html', parameters: [], weight: 0.5 }]);
  });

  it('compares types, subtypes, parameter names and q without regard to case', () => {
    expect(parseAccept('TEXT/HTML;Q=0.5')).toEqual([{ type: 'text', subtype: 'html', parameters: [], weight: 0.5 }]);
    expect(parseAccept('Application/Vnd.Example.Post+JSON; VERSION="2"')).toEqual([
      { type: 'application', subtype: 'vnd.example.post+json', parameters: [['version', '2']], weight: 1 },
    ]);
  });

  it('keeps the value of a parameter as written, and unquotes a quoted value', () => {
    expect(parseAccept('application/vnd.example.post+json;version="2";note="a \\"b\\""')).toEqual([
      { type: 'application', subtype: 'vnd.example.post+json', parameters: [['version', '2'], ['note', 'a "b"']], weight: 1 },
    ]);
  });

  it('accepts the qvalues 0, 0.5, 1 and their forms of up to three decimals', () => {
    expect(parseAccept('text/html;q=0').map((range) => range.weight)).toEqual([0]);
    expect(parseAccept('text/html;q=0.123').map((range) => range.weight)).toEqual([0.123]);
    expect(parseAccept('text/html;q=1.000').map((range) => range.weight)).toEqual([1]);
    expect(parseAccept('text/html;q=1.').map((range) => range.weight)).toEqual([1]);
  });

  it('skips empty list elements, as RFC 9110 section 5.6.1 allows', () => {
    expect(parseAccept(', text/html ,, application/json,')).toEqual([
      { type: 'text', subtype: 'html', parameters: [], weight: 1 },
      { type: 'application', subtype: 'json', parameters: [], weight: 1 },
    ]);
  });

  it('refuses a weight that is not a qvalue', () => {
    expect(() => parseAccept('text/html;q=x')).toThrow(InvalidAccept);
    expect(() => parseAccept('text/html;q=1.5')).toThrow(InvalidAccept);
    expect(() => parseAccept('text/html;q=1.0000')).toThrow(InvalidAccept);
    expect(() => parseAccept('text/html;q=0.5x')).toThrow(InvalidAccept);
    expect(() => parseAccept('text/html;q="0.5"')).toThrow(InvalidAccept);
    expect(() => parseAccept('text/html;q')).toThrow(InvalidAccept);
  });

  it('refuses a value that does not follow the grammar', () => {
    expect(() => parseAccept('text')).toThrow(InvalidAccept);
    expect(() => parseAccept('text /html')).toThrow(InvalidAccept);
    expect(() => parseAccept('text/html;')).toThrow(InvalidAccept);
    expect(() => parseAccept('text/html;level')).toThrow(InvalidAccept);
    expect(() => parseAccept('text/html;level=')).toThrow(InvalidAccept);
    expect(() => parseAccept('text/html;level="open')).toThrow(InvalidAccept);
    expect(() => parseAccept('text/html y')).toThrow(InvalidAccept);
  });
});

describe('selectType', () => {
  it('selects the page for a request without Accept, which is read as */*', () => {
    expect(selectType(parseAccept('*/*'), TYPES)).toBe(PAGE);
  });

  it('selects no type for an empty Accept', () => {
    expect(select('')).toBeNull();
  });

  it('selects the type of the highest weight', () => {
    expect(select('text/html;q=0.5, application/vnd.hyper+json;q=0.9')).toBe(DATA);
    expect(select('text/html;q=0.2, text/*;q=0.9, application/vnd.hyper+json;q=0.5')).toBe(DATA);
  });

  it('gives a type the weight of its most specific matching range', () => {
    expect(select('text/html;q=0.2, text/*;q=0.9')).toBe(PAGE);
    expect(select('text/*;q=0.9, text/html;q=0.2, application/vnd.hyper+json;q=0.3')).toBe(DATA);
  });

  it('takes the highest weight among ranges of the most specific level that match a type', () => {
    expect(select('text/html;level=1;q=0, text/html;q=0.8')).toBe(PAGE);
    expect(select('text/html;q=0.8, text/html;level=1;q=0.1, application/vnd.hyper+json;q=0.5')).toBe(PAGE);
  });

  it('makes a type not acceptable with weight 0 even when */* matches it', () => {
    expect(select('text/html;q=0, */*')).toBe(DATA);
  });

  it('leaves no acceptable type when weight 0 and a wildcard range match the types', () => {
    expect(select('application/vnd.hyper+json;q=0, application/*;q=0.5')).toBeNull();
  });

  it('gives the data type the weight of application/* and the page no weight from it', () => {
    expect(select('application/*')).toBe(DATA);
  });

  it('selects the first type in the order of the candidates among equal weights, whatever the order of Accept', () => {
    expect(select('application/vnd.hyper+json, text/html')).toBe(PAGE);
    expect(select('text/html, application/vnd.hyper+json')).toBe(PAGE);
    expect(select('*/*')).toBe(PAGE);
  });

  it('gives no type to application/json, which hyper does not define', () => {
    expect(select('application/json')).toBeNull();
    expect(select('application/json, application/vnd.hyper+json;q=0.1')).toBe(DATA);
  });

  it('matches a range that names the type whatever its other parameters', () => {
    expect(select('application/xml')).toBeNull();
    expect(select('text/html;charset=utf-8')).toBe(PAGE);
  });

  it('matches the types without regard to case', () => {
    expect(select('TEXT/HTML;Q=0.4, Application/Vnd.Hyper+JSON;q=0.3')).toBe(PAGE);
  });
});
