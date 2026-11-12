// The selection of the media type in the application beyond the cases of contracts/representations.json and
// contracts/client.json: the media type of the JSON of hyper (HY-15, HY-117) and the loaders of a refused selection
// (HY-116).
import { describe, expect, it } from 'vitest';
import { Fixture } from './support.js';

const PAGE_VARY = 'Accept, HX-Request, HX-Current-URL';

describe('media type selection (HY-116)', () => {
  it('answers a document with the JSON media type, which has no charset parameter (HY-15)', async () => {
    const response = await new Fixture().get('/', { Accept: 'application/vnd.hyper+json' });
    expect(response.status).toBe(200);
    expect(response.headers['Content-Type']).toBe('application/vnd.hyper+json');
    expect(response.headers.Vary).toBe(PAGE_VARY);
    expect(JSON.parse(response.body)).toHaveProperty('regions');
  });

  it('runs no loader for a 406 of the selection', async () => {
    const fixture = new Fixture();
    await fixture.get('/', { Accept: 'application/xml' });
    expect(fixture.counter.count).toBe(0);
  });
});

