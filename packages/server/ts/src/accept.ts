// The Accept field of a request: its parser (RFC 9110, section 12.5.1) and the selection of a media type by the weights
// of its ranges (HY-116). An instance reads one value from its start to its end.
import { InvalidAccept } from './invalid-accept.js';
import { MediaRange } from './media-range.js';

// The weight of a range without q, and of q=1, in thousandths (RFC 9110, section 12.4.2).
const ANY = 1000;

// The characters of a token (RFC 9110, section 5.6.2).
const TCHAR = "!#$%&'*+-.^_`|~0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** @internal */
export class Accept {
  // The position of the next character to read.
  private pos = 0;
  private readonly text: string;

  private constructor(text: string) {
    this.text = text;
  }

  // Parses an Accept field value into its ranges, in order. A null value is a request without Accept, which reads as the
  // range that matches every type (RFC 9110, section 12.5.1; HY-116). An empty value is an empty list, and an empty list
  // element is ignored (RFC 9110, section 5.6.1). The names of the types, subtypes and parameters are in lower case. The
  // parameters are those before `q`, and the weight is the qvalue in thousandths (RFC 9110, section 12.4.2). What follows
  // `q` is an accept extension, which is checked and not read. Throws InvalidAccept for a value that the grammar does not
  // allow, or a weight that is not a qvalue.
  static parse(value: string | null): MediaRange[] {
    if (value === null) return [new MediaRange('*', '*', [], ANY)];
    const reader = new Accept(value);
    const ranges: MediaRange[] = [];
    reader.skipOws();
    while (!reader.end()) {
      if (reader.at(',')) {
        reader.pos++;
        reader.skipOws();
        continue;
      }
      ranges.push(reader.range());
      reader.skipOws();
      if (!reader.end()) {
        reader.expect(',');
        reader.skipOws();
      }
    }
    return ranges;
  }

  // Returns the media type of the request among the given types, or null when no type has a weight above 0 (HY-116). A
  // type takes the weight of its most specific matching range, and among the ranges of that specificity the one of the
  // highest weight. The first type of the list wins a tie. Throws InvalidAccept as `parse` does.
  static select(value: string | null, types: readonly string[]): string | null {
    const ranges = Accept.parse(value);
    let selected: string | null = null;
    let best = 0;
    for (const type of types) {
      const weight = Accept.typeWeight(ranges, type);
      if (weight > best) {
        selected = type;
        best = weight;
      }
    }
    return selected;
  }

  // Returns the weight in thousandths that the ranges give a type: the weight of the most specific range that matches it,
  // or 0 when no range matches. A range that names the type matches it whatever its parameters (HY-116).
  private static typeWeight(ranges: readonly MediaRange[], type: string): number {
    const slash = type.indexOf('/');
    const name = type.slice(0, slash);
    const subtype = type.slice(slash + 1);
    let specificity = 0;
    let weight = 0;
    for (const range of ranges) {
      const match = range.type === '*' ? 1 : range.type === name && range.subtype === '*' ? 2 : range.type === name && range.subtype === subtype ? 3 : 0;
      if (match === 0) continue;
      if (match > specificity || (match === specificity && range.weight > weight)) {
        specificity = match;
        weight = range.weight;
      }
    }
    return weight;
  }

  // Reads one media range: `type "/" subtype`, then its parameters and its weight (RFC 9110, section 12.5.1).
  private range(): MediaRange {
    const type = this.token().toLowerCase();
    this.expect('/');
    const subtype = this.token().toLowerCase();
    if (type === '*' && subtype !== '*') throw this.invalid('a wildcard type has a subtype');
    const parameters: [string, string][] = [];
    let weight = ANY;
    let weighted = false;
    for (;;) {
      this.skipOws();
      if (!this.at(';')) break;
      this.pos++;
      this.skipOws();
      const name = this.token().toLowerCase();
      if (weighted) {
        // An accept extension after the weight: `token [ "=" ( token / quoted-string ) ]`, read and not kept.
        if (this.at('=')) {
          this.pos++;
          this.parameterValue();
        }
        continue;
      }
      this.expect('=');
      if (name === 'q') {
        weight = this.qvalue();
        weighted = true;
        continue;
      }
      parameters.push([name, this.parameterValue()]);
    }
    return new MediaRange(type, subtype, parameters, weight);
  }

  // Reads a qvalue and returns it in thousandths: `0[.000-999]` or `1[.000]` (RFC 9110, section 12.4.2).
  private qvalue(): number {
    const text = this.token();
    if (!/^(0(\.[0-9]{0,3})?|1(\.0{0,3})?)$/.test(text)) throw this.invalid(`the weight ${text} is not a qvalue`);
    const [whole = '0', fraction = ''] = text.split('.');
    return Number(whole) * ANY + Number(fraction.padEnd(3, '0'));
  }

  // Reads a parameter value, a token or a quoted string, and returns it unquoted (RFC 9110, section 5.6.6).
  private parameterValue(): string {
    return this.at('"') ? this.quoted() : this.token();
  }

  // Reads a quoted string and returns its text without the quotes and the quoted pairs (RFC 9110, section 5.6.4).
  private quoted(): string {
    this.expect('"');
    let text = '';
    for (;;) {
      if (this.end()) throw this.invalid('an unterminated quoted string');
      const char = this.text.charAt(this.pos);
      this.pos++;
      if (char === '"') return text;
      if (char === '\\') {
        if (this.end() || !Accept.quotedPairCharacter(this.text.charCodeAt(this.pos))) throw this.invalid('an invalid quoted pair');
        text += this.text.charAt(this.pos);
        this.pos++;
        continue;
      }
      if (!Accept.qdtextCharacter(char.charCodeAt(0))) throw this.invalid('an invalid character in a quoted string');
      text += char;
    }
  }

  // Whether a character is a qdtext: HTAB, SP, %x21, %x23-5B, %x5D-7E or obs-text (RFC 9110, section 5.6.4).
  private static qdtextCharacter(code: number): boolean {
    return code === 0x09 || code === 0x20 || code === 0x21 || (code >= 0x23 && code <= 0x5b) || (code >= 0x5d && code <= 0x7e) || (code >= 0x80 && code <= 0xff);
  }

  // Whether a character may follow the backslash of a quoted pair: HTAB, SP, VCHAR or obs-text (RFC 9110, 5.6.4).
  private static quotedPairCharacter(code: number): boolean {
    return code === 0x09 || code === 0x20 || (code >= 0x21 && code <= 0x7e) || (code >= 0x80 && code <= 0xff);
  }

  // Reads a token (RFC 9110, section 5.6.2).
  private token(): string {
    const start = this.pos;
    while (!this.end() && TCHAR.includes(this.text.charAt(this.pos))) this.pos++;
    if (start === this.pos) throw this.invalid('expected a token');
    return this.text.slice(start, this.pos);
  }

  // Skips the optional white space (RFC 9110, section 5.6.3).
  private skipOws(): void {
    while (this.at(' ') || this.at('\t')) this.pos++;
  }

  // Reads the character `char`, which must come next.
  private expect(char: string): void {
    if (!this.at(char)) throw this.invalid(`expected ${char}`);
    this.pos++;
  }

  // Whether the next character is `char`.
  private at(char: string): boolean {
    return this.pos < this.text.length && this.text.charAt(this.pos) === char;
  }

  // Whether the whole value has been read.
  private end(): boolean {
    return this.pos >= this.text.length;
  }

  // The error of a value that the grammar does not allow, at the current position.
  private invalid(reason: string): InvalidAccept {
    return new InvalidAccept(`hyper: the Accept value ${JSON.stringify(this.text)} is invalid at ${this.pos}: ${reason} (HY-116)`);
  }
}
