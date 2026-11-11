// The selection of the media type in the application: the refusals of HY-116 and the steps of HY-62, and the headers of
// the responses (HY-15, HY-116, HY-117). The expected values come from the rules and from contracts/client.json.
import { describe, expect, it } from 'vitest';
import { client, Fixture } from './support.js';

const PAGE_VARY = 'Accept, HX-Request, HX-Current-URL';

describe('media type selection (HY-116)', () => {
  it('answers a document with the JSON media type, which has no charset parameter (HY-15)', async () => {
    const response = await new Fixture().get('/', { Accept: 'application/vnd.hyper+json' });
    expect(response.status).toBe(200);
    expect(response.headers['Content-Type']).toBe('application/vnd.hyper+json');
    expect(response.headers.Vary).toBe(PAGE_VARY);
    expect(JSON.parse(response.body)).toHaveProperty('regions');
  });

  it('does not select JSON for application/json, which hyper does not define', async () => {
    const response = await new Fixture().get('/', { Accept: 'application/json' });
    expect(response.status).toBe(406);
    expect(response.body).toBe('text/html\napplication/vnd.hyper+json\n');
  });

  it('answers a request that matches no type with 406, the served types and Vary: Accept', async () => {
    const response = await new Fixture().get('/', { Accept: 'application/xml' });
    expect(response.status).toBe(406);
    expect(response.headers['Content-Type']).toBe('text/plain; charset=utf-8');
    expect(response.headers.Vary).toBe('Accept');
    expect(response.body).toBe('text/html\napplication/vnd.hyper+json\n');
  });

  it('answers an empty Accept with the 406 that lists the served types', async () => {
    const response = await new Fixture().get('/', { Accept: '' });
    expect(response.status).toBe(406);
    expect(response.body).toBe('text/html\napplication/vnd.hyper+json\n');
  });

  it('answers an invalid Accept with 400 Bad Request and Vary: Accept', async () => {
    for (const accept of ['text/html;q=x', 'text/html;q=1.5']) {
      const response = await new Fixture().get('/', { Accept: accept });
      expect(response.status).toBe(400);
      expect(response.body).toBe('Bad Request');
      expect(response.headers['Content-Type']).toBe('text/plain; charset=utf-8');
      expect(response.headers.Vary).toBe('Accept');
    }
  });

  it('routes a path before it selects, so a path without a route is 404 for an invalid Accept', async () => {
    const response = await new Fixture().get('/nowhere/at/all', { Accept: 'text/html;q=x' });
    expect(response.status).toBe(404);
    expect(response.headers.Vary).toBeUndefined();
  });

  it('runs no loader for a 406 of the selection', async () => {
    const fixture = new Fixture();
    await fixture.get('/', { Accept: 'application/xml' });
    expect(fixture.counter.count).toBe(0);
  });
});

describe('client rendering media type selection (HY-62)', () => {
  it('answers a document request under the data base path with 406 Not Acceptable when the selection picks the page', async () => {
    const response = await new Fixture().handle({ target: '/_props/list', headers: { Host: 'client.test' } }, { clientRendering: client() });
    expect(response.status).toBe(406);
    expect(response.body).toBe('Not Acceptable');
    expect(response.headers.Vary).toBe('Accept');
  });

  it('lists only the JSON type under the data base path for an unacceptable request', async () => {
    const response = await new Fixture().handle({ target: '/_props/list', headers: { Host: 'client.test', Accept: 'application/xml' } }, { clientRendering: client() });
    expect(response.status).toBe(406);
    expect(response.body).toBe('application/vnd.hyper+json\n');
    expect(response.headers.Vary).toBe('Accept');
  });

  it('refuses a method other than GET under the data base path with 405 after the selection of a JSON request', async () => {
    const response = await new Fixture().handle({ method: 'DELETE', target: '/_props/', headers: { Host: 'client.test', Accept: 'application/vnd.hyper+json' } }, { clientRendering: client() });
    expect(response.status).toBe(405);
    expect(response.body).toBe('Method Not Allowed');
    expect(response.headers.Vary).toBeUndefined();
  });

  it('answers a request outside the data base path that selects JSON with 406 Not Acceptable', async () => {
    const response = await new Fixture().handle({ target: '/list', headers: { Host: 'client.test', Accept: 'application/vnd.hyper+json' } }, { clientRendering: client() });
    expect(response.status).toBe(406);
    expect(response.body).toBe('Not Acceptable');
    expect(response.headers.Vary).toBe('Accept');
  });

  it('lists only text/html outside the data base path for an unacceptable request', async () => {
    const response = await new Fixture().handle({ target: '/list', headers: { Host: 'client.test', Accept: 'application/xml' } }, { clientRendering: client() });
    expect(response.status).toBe(406);
    expect(response.body).toBe('text/html\n');
    expect(response.headers.Vary).toBe('Accept');
  });

  it('answers the shell with the Vary of HY-117 for a request that selects text/html', async () => {
    const response = await new Fixture().handle({ target: '/list', headers: { Host: 'client.test', Accept: 'text/html' } }, { clientRendering: client() });
    expect(response.status).toBe(200);
    expect(response.headers.Vary).toBe(PAGE_VARY);
  });
});
