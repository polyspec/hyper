// The cookies, the cache control, the page status and the embedding of the data that the loaders and actions of one
// request give its response (HY-52, HY-69, HY-92), and the notes that they give the response hook (HY-60).
export class Reply {
  private readonly cookies: [string, string, number | null][] = [];
  private cacheControlText: string | null = null;
  private pageStatus: number | null = null;
  private renewal = false;
  private embed = false;
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

  // Sets the Cache-Control of a page response with status 200. A page carries the session token of its visitor, so the
  // value keeps it out of shared caches: it has `private` or `no-store` and neither `public` nor `s-maxage` (HY-52).
  cacheControl(value: string): this {
    if (!/^[\x20-\x7e]+$/.test(value)) throw new Error('hyper: Cache-Control has a character that is not allowed');
    const directives = value.split(',').map((part) => part.split('=')[0]!.trim().toLowerCase());
    if (!directives.some((name) => name === 'private' || name === 'no-store') || directives.some((name) => name === 'public' || name === 's-maxage')) {
      throw new Error(`hyper: Cache-Control ${value} lets a shared cache store the page; it needs private or no-store and neither public nor s-maxage`);
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
  takeRenewal(): boolean {
    const renewal = this.renewal;
    this.renewal = false;
    return renewal;
  }

  cacheControlValue(): string | null {
    return this.cacheControlText;
  }

  // Gives a page response that has status 200 otherwise the status 403, for a page that shows other data in place of
  // the data that the request may not see; another status fails (HY-69).
  status(status: number): this {
    if (status !== 403) throw new Error(`hyper: page status ${status} of a reply is not 403`);
    this.pageStatus = status;
    return this;
  }

  statusValue(): number | null {
    return this.pageStatus;
  }

  // Makes the HTML document of the response embed its data (HY-31, HY-92).
  embedData(): this {
    this.embed = true;
    return this;
  }

  // Returns whether the HTML document of the response embeds its data (HY-92).
  embedsData(): boolean {
    return this.embed;
  }

  cookieHeaders(secure: boolean): string[] {
    return this.cookies.map(([name, value, maxAge]) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}${maxAge === null ? '' : `; Max-Age=${maxAge}`}`);
  }
}
