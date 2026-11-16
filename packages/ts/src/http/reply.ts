// The cookies, the cache control, the page status and the embedding of the data that the loaders and actions of one
// request give its response (HY-52, HY-69, HY-92), and the notes that they give the response hook (HY-60).
// The core states the rule of each value (HY-132.2); this class checks the JavaScript type of an argument.
import { ArgumentCountError } from '../app/argument-count-error.js';
import { rules } from '../app/core-rules.js';

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
    ArgumentCountError.between(arguments.length, 2, 2);
    // HY-60.28: a JavaScript caller may pass a name that is not a string.
    if (typeof name !== 'string') throw rules().typeError('a note name is not a string (HY-60)', 'invalid_argument_type');
    this.noted.set(name, value);
    return this;
  }

  // Returns the notes as pairs of a name and its value, in the order of their first names (HY-60.29).
  notes(): [string, unknown][] {
    ArgumentCountError.between(arguments.length, 0, 0);
    return [...this.noted];
  }

  // Adds a cookie; a name, value or Max-Age of another type (HY-52.11) or outside HY-52 (HY-52.12) fails. The types are
  // checked before the values, in the order of the parameters.
  cookie(name: string, value: string, maxAge: number | null = null): this {
    ArgumentCountError.between(arguments.length, 2, 3);
    if (typeof name !== 'string') throw rules().typeError('a cookie name is not a string (HY-52)', 'invalid_argument_type');
    if (typeof value !== 'string') throw rules().typeError('a cookie value is not a string (HY-52)', 'invalid_argument_type');
    const age = maxAge === null ? null : Reply.integer(maxAge);
    if (maxAge !== null && age === null) throw rules().valueError('a Max-Age is not an integer within ±(2^53 − 1) (HY-52)', 'invalid_number');
    if (!/^[a-z][a-z0-9_-]*$/.test(name) || name.startsWith('hy-')) throw rules().valueError(`cookie name ${name} is not allowed (HY-52)`, 'cookie_name_not_allowed');
    if (!/^[A-Za-z0-9._~-]+$/.test(value)) throw rules().valueError(`cookie value of ${name} has a character that is not allowed (HY-52)`, 'cookie_value_not_allowed');
    if (age !== null && age < 0) throw rules().valueError(`cookie ${name} has a negative Max-Age (HY-52)`, 'negative_max_age');
    this.cookies.push([name, value, age]);
    return this;
  }

  // Removes a cookie with Max-Age=0.
  removeCookie(name: string): this {
    ArgumentCountError.between(arguments.length, 1, 1);
    this.cookie(name, 'x');
    this.cookies[this.cookies.length - 1] = [name, '', 0];
    return this;
  }

  // Sets the Cache-Control of a page response with status 200. A page carries the session token of its visitor, so the
  // value keeps it out of shared caches: it has `private` or `no-store` and neither `public` nor `s-maxage` (HY-52).
  cacheControl(value: string): this {
    ArgumentCountError.between(arguments.length, 1, 1);
    if (typeof value !== 'string') throw rules().typeError('a Cache-Control is not a string (HY-52)', 'invalid_argument_type');
    this.cacheControlText = rules().replyCacheControl(value);
    return this;
  }

  // Renews the session after the action of the request returns (HY-72).
  renewSession(): this {
    ArgumentCountError.between(arguments.length, 0, 0);
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
    ArgumentCountError.between(arguments.length, 1, 1);
    if (typeof value !== 'string') throw rules().typeError('a Referrer-Policy is not a string (HY-103)', 'invalid_argument_type');
    this.referrerPolicyText = rules().replyReferrerPolicy(value);
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
    ArgumentCountError.between(arguments.length, 1, 1);
    const code = Reply.integer(status);
    if (code === null) throw rules().valueError('a page status of a reply is not an integer within ±(2^53 − 1) (HY-69)', 'invalid_number');
    this.pageStatus = rules().replyStatus(code);
    return this;
  }

  /** @internal */
  statusValue(): number | null {
    return this.pageStatus;
  }

  // Makes the HTML document of the response embed its data (HY-31, HY-92).
  embedData(): this {
    ArgumentCountError.between(arguments.length, 0, 0);
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
    return this.cookies.map(([name, value, maxAge]) => `${name}=${value}${maxAge === null ? '' : `; Max-Age=${maxAge}`}; Path=/${secure ? '; Secure' : ''}; HttpOnly; SameSite=Lax`);
  }
}
