// The cookies and the cache control that the loaders and actions of one request give its response (HY-52), and the
// notes that they give the response hook (HY-60).
export class Reply {
  private readonly cookies: [string, string, number | null][] = [];
  private cacheControlText: string | null = null;
  private readonly noted = new Map<string, unknown>();

  // Records a value of the request for the response hook; a later note of the same name replaces the value and keeps
  // its position. The notes are not part of the response (HY-60).
  note(name: string, value: unknown): this {
    this.noted.set(name, value);
    return this;
  }

  // Returns the notes in the order of their first names.
  notes(): ReadonlyMap<string, unknown> {
    return new Map(this.noted);
  }

  // Adds a cookie; a name or value outside HY-52 fails.
  cookie(name: string, value: string, maxAge: number | null = null): this {
    if (!/^[a-z][a-z0-9_-]*$/.test(name) || name.startsWith('hy-')) throw new Error(`hyper: cookie name ${name} is not allowed`);
    if (!/^[A-Za-z0-9._~-]+$/.test(value)) throw new Error(`hyper: cookie value of ${name} has a character that is not allowed`);
    if (maxAge !== null && (!Number.isSafeInteger(maxAge) || maxAge < 0)) throw new Error(`hyper: cookie ${name} has a Max-Age that is not a non-negative integer`);
    this.cookies.push([name, value, maxAge]);
    return this;
  }

  // Removes a cookie with Max-Age=0.
  removeCookie(name: string): this {
    this.cookie(name, 'x');
    this.cookies[this.cookies.length - 1] = [name, '', 0];
    return this;
  }

  // Sets the Cache-Control of a page response with status 200.
  cacheControl(value: string): this {
    if (!/^[\x20-\x7e]+$/.test(value)) throw new Error('hyper: Cache-Control has a character that is not allowed');
    this.cacheControlText = value;
    return this;
  }

  cacheControlValue(): string | null {
    return this.cacheControlText;
  }

  cookieHeaders(secure: boolean): string[] {
    return this.cookies.map(([name, value, maxAge]) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}${maxAge === null ? '' : `; Max-Age=${maxAge}`}`);
  }
}
