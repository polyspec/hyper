// Parses the Accept header of a request by RFC 9110 section 12.5.1 and selects the media type of the request among the
// candidate types by the weights of its ranges (HY-116). Internal: the package index does not export it.

// One media range of an Accept value: its type and subtype in lower case, its parameters before q with their names in
// lower case, and its weight.
export interface AcceptRange {
  type: string;
  subtype: string;
  parameters: [string, string][];
  weight: number;
}

// An Accept value that does not follow the grammar, or that has a weight that is not a qvalue (HY-116).
export class InvalidAccept extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAccept';
  }
}

const TCHAR = /[!#$%&'*+\-.^_`|~0-9A-Za-z]/;
const QVALUE = /^(0(\.[0-9]{0,3})?|1(\.0{0,3})?)$/;

// Parses an Accept value, whose field lines are one value joined with `, ` (RFC 9110 section 5.3). An empty value is an
// empty list; a missing header is read by the caller as `*/*`.
export function parseAccept(value: string): AcceptRange[] {
  const scanner = new Scanner(value);
  const ranges: AcceptRange[] = [];
  scanner.ows();
  while (!scanner.end()) {
    // A list accepts empty elements (RFC 9110 section 5.6.1).
    if (scanner.at(',')) {
      scanner.skip();
      scanner.ows();
      continue;
    }
    ranges.push(mediaRange(scanner));
    scanner.ows();
    if (scanner.end()) break;
    scanner.expect(',');
    scanner.ows();
  }
  return ranges;
}

// Selects the candidate type of the highest weight, or null when no candidate has a weight above 0 (HY-116). Among equal
// weights the first candidate in the given order is selected, so the candidates list the tie order.
export function selectType(ranges: readonly AcceptRange[], types: readonly string[]): string | null {
  let selected: string | null = null;
  let best = 0;
  for (const type of types) {
    const weight = weightOf(ranges, type);
    if (weight > best) {
      best = weight;
      selected = type;
    }
  }
  return selected;
}

// Returns the weight that the most specific matching range gives a type `main/sub` without parameters: the range that
// names the type (whatever its parameters), then `main/*`, then `*/*`. Among ranges of that level the highest weight
// counts; a type that no range matches has weight 0 (HY-116).
function weightOf(ranges: readonly AcceptRange[], type: string): number {
  const slash = type.indexOf('/');
  const main = type.slice(0, slash);
  const sub = type.slice(slash + 1);
  let level = 0;
  let weight = 0;
  for (const range of ranges) {
    const matched = range.type === main && range.subtype === sub ? 3 : range.type === main && range.subtype === '*' ? 2 : range.type === '*' && range.subtype === '*' ? 1 : 0;
    if (matched === 0) continue;
    if (matched > level) {
      level = matched;
      weight = range.weight;
    } else if (matched === level && range.weight > weight) {
      weight = range.weight;
    }
  }
  return weight;
}

// Reads one media range with its parameters and its weight (RFC 9110 section 12.5.1). Parameters after q are accept
// extensions, which are read and not kept.
function mediaRange(scanner: Scanner): AcceptRange {
  const type = scanner.token().toLowerCase();
  scanner.expect('/');
  const subtype = scanner.token().toLowerCase();
  const parameters: [string, string][] = [];
  let weight = 1;
  let weighted = false;
  for (;;) {
    scanner.ows();
    if (!scanner.at(';')) break;
    scanner.skip();
    scanner.ows();
    const name = scanner.token().toLowerCase();
    if (weighted) {
      // An accept extension: a token with an optional value (RFC 9110 section 12.5.1).
      if (scanner.at('=')) {
        scanner.skip();
        parameterValue(scanner);
      }
    } else if (name === 'q') {
      scanner.expect('=');
      weight = qvalue(scanner);
      weighted = true;
    } else {
      scanner.expect('=');
      parameters.push([name, parameterValue(scanner)]);
    }
  }
  return { type, subtype, parameters, weight };
}

// Reads a parameter value, which is a token or a quoted-string (RFC 9110 section 5.6.6).
function parameterValue(scanner: Scanner): string {
  return scanner.at('"') ? scanner.quoted() : scanner.token();
}

// Reads a qvalue (RFC 9110 section 12.4.2), which is not quoted; a weight above 1 or with more than three decimals is refused.
function qvalue(scanner: Scanner): number {
  const text = scanner.token();
  if (!QVALUE.test(text)) scanner.fail(`the weight ${text} is not a qvalue`);
  return Number(text);
}

// Reads the characters of an Accept value from a position, and fails with InvalidAccept at the first character that the
// grammar does not allow.
class Scanner {
  private pos = 0;
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  end(): boolean {
    return this.pos >= this.text.length;
  }

  at(char: string): boolean {
    return this.text[this.pos] === char;
  }

  skip(): void {
    this.pos++;
  }

  expect(char: string): void {
    if (!this.at(char)) this.fail(`expected ${char}`);
    this.pos++;
  }

  // Skips optional whitespace (RFC 9110 section 5.6.3).
  ows(): void {
    while (this.at(' ') || this.at('\t')) this.pos++;
  }

  // Reads a token (RFC 9110 section 5.6.2).
  token(): string {
    const start = this.pos;
    while (!this.end() && TCHAR.test(this.text[this.pos] ?? '')) this.pos++;
    if (start === this.pos) this.fail('expected a token');
    return this.text.slice(start, this.pos);
  }

  // Reads a quoted-string (RFC 9110 section 5.6.4) and returns its value without the quotes and the quoted pairs.
  quoted(): string {
    this.expect('"');
    let value = '';
    for (;;) {
      if (this.end()) this.fail('an unterminated quoted-string');
      const char = this.text[this.pos] ?? '';
      this.pos++;
      if (char === '"') return value;
      if (char === '\\') {
        const next = this.text[this.pos] ?? '';
        if (this.end() || !isQuotedPairChar(next)) this.fail('an invalid quoted pair');
        this.pos++;
        value += next;
      } else {
        if (!isQdtext(char)) this.fail('an invalid character in a quoted-string');
        value += char;
      }
    }
  }

  fail(reason: string): never {
    throw new InvalidAccept(`hyper: the Accept value ${JSON.stringify(this.text)} is invalid at ${this.pos}: ${reason} (HY-116)`);
  }
}

// qdtext = HTAB / SP / %x21 / %x23-5B / %x5D-7E / obs-text (RFC 9110 section 5.6.4).
function isQdtext(char: string): boolean {
  const code = char.charCodeAt(0);
  return code === 0x09 || code === 0x20 || code === 0x21 || (code >= 0x23 && code <= 0x5b) || (code >= 0x5d && code <= 0x7e) || (code >= 0x80 && code <= 0xff);
}

// quoted-pair = "\" ( HTAB / SP / VCHAR / obs-text ) (RFC 9110 section 5.6.4).
function isQuotedPairChar(char: string): boolean {
  const code = char.charCodeAt(0);
  return code === 0x09 || code === 0x20 || (code >= 0x21 && code <= 0x7e) || (code >= 0x80 && code <= 0xff);
}
