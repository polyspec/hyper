// The response of a representation handler (HY-122): a status, a body that is a value of the data model or null for no
// body, and headers. The server checks the response (HY-122) before it sends it.
export class Representation {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;

  constructor(status: number, body: unknown = null, headers: Record<string, string> = {}) {
    this.status = status;
    this.body = body;
    this.headers = { ...headers };
  }
}
