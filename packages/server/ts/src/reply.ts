// The cookies, the cache control, the page status and the embedding of the data that the loaders and actions of one
// request give its response (HY-52, HY-69, HY-92), and the notes that they give the response hook (HY-60).
// The tokens of the Referrer-Policy specification that a reply may set (HY-103).
const REFERRER_POLICIES: readonly string[] = [
  'no-referrer', 'no-referrer-when-downgrade', 'origin', 'origin-when-cross-origin',
  'same-origin', 'strict-origin', 'strict-origin-when-cross-origin', 'unsafe-url',
];

export class Reply {
  private readonly cookies: [string, string, number | null][] = [];
  private cacheControlText: string | null = null;
  private referrerPolicyText: string | null = null;
  private pageStatus: number | null = null;
  private renewal = false;
  private embed = false;
  private readonly noted = new Map<string, unknown>();

  // Records a value of the request for the response hook; a later note of the same name replaces the value and keeps
  // its position. The notes are not part of the response (HY-60).
  note(name: string, value: unknown): this {
    // HY-60.14: a JavaScript caller may pass a name that is not a string.
    if (typeof name !== 'string') throw new TypeError('a note name is not a string (HY-60)');
    this.noted.set(name, value);
    return this;
  }

  // Returns the notes in the order of their first names.
  notes(): ReadonlyMap<string, unknown> {
    return new Map(this.noted);
  }

  // Adds a cookie; a name, value or Max-Age of another type (HY-52.11) or outside HY-52 (HY-52.12) fails. The types are
  // checked before the values, in the order of the parameters.
  cookie(name: string, value: string, maxAge: number | null = null): this {
    if (typeof name !== 'string') throw new TypeError('a cookie name is not a string (HY-52)');
    if (typeof value !== 'string') throw new TypeError('a cookie value is not a string (HY-52)');
    const age = maxAge === null ? null : Reply.integer(maxAge);
    if (maxAge !== null && age === null) throw new TypeError('a Max-Age is not an integer within ±(2^53 − 1) (HY-52)');
    if (!/^[a-z][a-z0-9_-]*$/.test(name) || name.startsWith('hy-')) throw new RangeError(`cookie name ${name} is not allowed (HY-52)`);
    if (!/^[A-Za-z0-9._~-]+$/.test(value)) throw new RangeError(`cookie value of ${name} has a character that is not allowed (HY-52)`);
    if (age !== null && age < 0) throw new RangeError(`cookie ${name} has a negative Max-Age (HY-52)`);
    this.cookies.push([name, value, age]);
    return this;
  }

  // Removes a cookie with Max-Age=0.
  removeCookie(name: string): this {
    this.cookie(name, 'x');
    this.cookies[this.cookies.length - 1] = [name, '', 0];
    return this;
  }

  // Sets the Cache-Control of a page response with status 200. A page carries the session token of its visitor, so the
  // value keeps it out of shared caches: it has `private` or `no-store` and neither `public` nor `s-maxage` (HY-52).
  cacheControl(value: string): this {
    if (typeof value !== 'string') throw new TypeError('a Cache-Control is not a string (HY-52)');
    if (!/^[\x20-\x7e]+$/.test(value)) throw new RangeError('Cache-Control has a character that is not allowed (HY-52)');
    const directives = value.split(',').map((part) => (part.includes('=') ? part.slice(0, part.indexOf('=')) : part).trim().toLowerCase());
    if (!directives.some((name) => name === 'private' || name === 'no-store') || directives.some((name) => name === 'public' || name === 's-maxage')) {
      throw new RangeError(`Cache-Control ${value} lets a shared cache store the page; it needs private or no-store and neither public nor s-maxage (HY-52)`);
    }
    this.cacheControlText = value;
    return this;
  }

  // Renews the session after the action of the request returns (HY-72).
  renewSession(): this {
    this.renewal = true;
    return this;
  }

  // Returns whether a renewal was requested since the last call, and clears the request.
  /** @internal */
  takeRenewal(): boolean {
    const renewal = this.renewal;
    this.renewal = false;
    return renewal;
  }

  /** @internal */
  cacheControlValue(): string | null {
    return this.cacheControlText;
  }

  // Sets the Referrer-Policy of the page and JSON answers of the request, whatever their status; a value that is not a
  // token of the Referrer-Policy specification fails (HY-103).
  referrerPolicy(value: string): this {
    if (typeof value !== 'string') throw new TypeError('a Referrer-Policy is not a string (HY-103)');
    if (!REFERRER_POLICIES.includes(value)) throw new RangeError(`Referrer-Policy ${value} is not a token of the Referrer-Policy specification (HY-103)`);
    this.referrerPolicyText = value;
    return this;
  }

  /** @internal */
  referrerPolicyValue(): string | null {
    return this.referrerPolicyText;
  }

  /** @internal */
  referrerPolicyHeaders(): Record<string, string> {
    return this.referrerPolicyText === null ? {} : { 'Referrer-Policy': this.referrerPolicyText };
  }

  // Gives a page response that has status 200 otherwise the status 403, for a page that shows other data in place of
  // the data that the request may not see; another status fails (HY-69).
  status(status: number): this {
    const code = Reply.integer(status);
    if (code === null) throw new TypeError('a page status of a reply is not an integer within ±(2^53 − 1) (HY-69)');
    if (code !== 403) throw new RangeError(`page status ${code} of a reply is not 403 (HY-69)`);
    this.pageStatus = code;
    return this;
  }

  /** @internal */
  statusValue(): number | null {
    return this.pageStatus;
  }

  // Makes the HTML document of the response embed its data (HY-31, HY-92).
  embedData(): this {
    this.embed = true;
    return this;
  }

  // Returns whether the HTML document of the response embeds its data (HY-92).
  /** @internal */
  embedsData(): boolean {
    return this.embed;
  }

  // Returns an integer of the data model as a number, or null for another value: a number or a bigint within
  // ±(2^53 − 1) without a fraction, as PHP and Python take an integer or a float with an integer value (HY-44).
  private static integer(value: unknown): number | null {
    if (typeof value === 'bigint') return value >= -9007199254740991n && value <= 9007199254740991n ? Number(value) : null;
    // `+ 0` makes -0 the integer 0, which PHP and Python have.
    return typeof value === 'number' && Number.isSafeInteger(value) ? value + 0 : null;
  }

  /** @internal */
  cookieHeaders(secure: boolean): string[] {
    return this.cookies.map(([name, value, maxAge]) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}${maxAge === null ? '' : `; Max-Age=${maxAge}`}`);
  }
}
