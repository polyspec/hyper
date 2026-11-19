// The token of a page that an action renders after it renews the session (HY-72.3), through the Node binding of the
// core. The test drives the built addon of `native/generated`, not a stand-in: the page input holds the masked value
// of the token of before the action, the input of the action step holds the masked value of the new token, and the
// shared data of the answer holds the new one.
import { describe, expect, it } from 'vitest';
import { addon, pages as routePages, type Step } from './core-addon.ts';

const pages = (): object => routePages('<p>token={= csrf}</p>\n', new Map([['content', true]]));

// The answer of a POST of the route `home` whose action returns the page; `renewed` is the member `csrf` of the
// input of the action step, or absent for an action that did not renew the session.
function answerOf(kind: 'html' | 'region_json', renewed: string | undefined): Step['answer'] {
  const page = new addon.PageRequest(pages(), { route: 'home', params: new Map(), kind, action: true, csrf: 'before', changed: [], now: 0 });
  expect(page.next({ input: 'start' }).call?.call).toBe('action');
  const outcome = { outcome: 'page', status: 200, data: new Map() };
  const action = renewed === undefined ? { input: 'action', outcome } : { input: 'action', outcome, csrf: renewed };
  expect(page.next(action).call?.call).toBe('shared');
  expect(page.next({ input: 'no_handler' }).call?.call).toBe('route_loader');
  expect(page.next({ input: 'no_handler' }).call?.call).toBe('reply');
  return page.next({ input: 'reply', embeds: false, stored: new Map() }).answer;
}

describe('the token of a page after its action (HY-72.3)', () => {
  it('a JSON response holds the masked value that the action step gives', () => {
    const answer = answerOf('region_json', 'after');
    expect(JSON.parse(answer?.text ?? '{}')).toMatchObject({ shared: { csrf: 'after' } });
  });

  it('a document holds the masked value that the action step gives', () => {
    expect(answerOf('html', 'after')?.html).toContain('<p>token=after</p>');
  });

  it('an action step without the member keeps the masked value of the page input', () => {
    const answer = answerOf('region_json', undefined);
    expect(JSON.parse(answer?.text ?? '{}')).toMatchObject({ shared: { csrf: 'before' } });
    expect(answerOf('html', undefined)?.html).toContain('<p>token=before</p>');
  });
});
