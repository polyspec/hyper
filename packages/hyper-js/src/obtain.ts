import { parseJson, type Value } from '@polyspec/template/render';

// A failed document request of HY-93, with the status that marks the region of the call or the body (HY-47).
export class ObtainError extends Error {
  readonly status: string;

  constructor(message: string, status: string) {
    super(message);
    this.name = 'ObtainError';
    this.status = status;
  }
}

// Sends the document request of a URL (HY-15, HY-93) and returns the JSON value of a response with status 200 and the
// URL of the response after redirects. Another response, a network failure or a body that is not JSON fails with the
// status of the response, or `0` without one.
export async function requestDocument(request: typeof fetch, url: string): Promise<{ value: Value; url: string }> {
  let response: Response;
  try {
    response = await request(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
  } catch (error) {
    throw new ObtainError(`hyper: the document request for ${url} failed: ${String(error)}`, '0');
  }
  const type = response.headers.get('content-type') ?? '';
  if (response.status !== 200 || !type.startsWith('application/json')) {
    throw new ObtainError(`hyper: the document request for ${url} received status ${response.status} with ${JSON.stringify(type)}, expected status 200 with application/json`, String(response.status));
  }
  const text = await response.text();
  try {
    return { value: parseJson(text), url: response.url || url };
  } catch (error) {
    throw new ObtainError(`hyper: the document JSON of ${url} is not JSON: ${String(error)}`, '0');
  }
}
