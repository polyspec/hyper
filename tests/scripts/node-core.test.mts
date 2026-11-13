// The rules of the core behind the names of the units of the Node server (packages/ts/src/core/rules.ts, HY-132.2),
// against a stand-in of the module of the Node binding: the stand-in records each call and returns the value that the
// test gives it, so the tests need no native module. They state which member of the binding each unit calls, with
// which arguments, and what the unit returns; the rules themselves are tested in the core.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coreRules, type CoreBinding, type CoreRules, type PageInput, type Plain } from '../../packages/ts/src/core/rules.ts';

type Call = [string, unknown[]];

// A stand-in of the binding module: every function member records its call and returns `results[name]`, or throws it
// when it is an Error; the classes record their construction and the calls of their methods.
function standIn(results: Record<string, unknown>): { core: CoreBinding; calls: Call[] } {
  const calls: Call[] = [];
  const member = (name: string) => (...args: unknown[]): unknown => {
    calls.push([name, args]);
    const result = results[name];
    if (result instanceof Error) throw result;
    return result;
  };
  const names = [
    'csrfMask', 'csrfVerify', 'browser', 'storedToken', 'isApplicationPath', 'redirectLocation', 'cacheControl', 'keepsOutOfSharedCaches',
    'referrerPolicy', 'sessionName', 'keepName', 'sessionCookie', 'pageTag', 'representationTag', 'pageStatus', 'replyStatus', 'pageVary',
    'contextHash', 'currentPath', 'checkShellPath', 'shellText', 'buildId', 'checkBuildId', 'buildFileText', 'readBuild', 'templateProblems',
    'routeReads', 'templateReads', 'reservedDataTemplate', 'validContextHeader', 'routeRequest', 'computePageHeaders', 'frameHeaders',
    'keptValue', 'openPage', 'answerKeepRequest',
  ];
  class Pages {
    constructor(...args: unknown[]) {
      calls.push(['new Pages', args]);
    }

    register(...args: unknown[]): void {
      calls.push(['Pages.register', args]);
    }
  }
  class PageRequest {
    constructor(...args: unknown[]) {
      calls.push(['new PageRequest', args]);
    }

    next(...args: unknown[]): unknown {
      calls.push(['PageRequest.next', args]);
      return results['PageRequest.next'];
    }
  }
  const module: Record<string, unknown> = { Pages, PageRequest };
  for (const name of names) module[name] = member(name);
  return { core: module as unknown as CoreBinding, calls };
}

function rulesOf(results: Record<string, unknown>): { rules: CoreRules; calls: Call[] } {
  const { core, calls } = standIn(results);
  return { rules: coreRules(core), calls };
}

const TOKEN = 'a'.repeat(64);
const MASK = 'b'.repeat(64);
const PAGES = { pages: true };
const STORE = { store: true };

// The exact units: the name of the unit of the server, the member of the binding, the arguments of the call, the
// arguments that the member must receive and the value that the member returns, which the unit returns as it is.
const EXACT: [string, keyof CoreBinding, (rules: CoreRules) => unknown, unknown[], unknown][] = [
  ['Csrf.mask (HY-24.2)', 'csrfMask', (rules) => rules.Csrf.mask(TOKEN, MASK), [TOKEN, MASK], 'masked'],
  ['Csrf.verify (HY-24.4)', 'csrfVerify', (rules) => rules.Csrf.verify(TOKEN, 'value'), [TOKEN, 'value'], true],
  ['Csrf.browserOf (HY-24.10)', 'browser', (rules) => rules.Csrf.browserOf('masked'), ['masked'], 'digest'],
  ['Csrf.browserOf of a request without a session (HY-24.12)', 'browser', (rules) => rules.Csrf.browserOf(''), [''], null],
  ['Context.hash (HY-125.12)', 'contextHash', (rules) => rules.Context.hash('build', '{}'), ['build', '{}'], 'hash'],
  ['Context.validHeader (HY-127.2)', 'validContextHeader', (rules) => rules.Context.validHeader(null), [null], true],
  ['RecordSession.cookieName (HY-45.1)', 'sessionName', (rules) => rules.RecordSession.cookieName(true), [true], '__Host-hy-session'],
  ['Request.currentPath (HY-11.4)', 'currentPath', (rules) => rules.Request.currentPath('http://a.test/b?c'), ['http://a.test/b?c'], '/b'],
  ['Reply.cacheControl (HY-52.6)', 'cacheControl', (rules) => rules.Reply.cacheControl('private'), ['private'], 'private'],
  ['Reply.referrerPolicy (HY-103.2)', 'referrerPolicy', (rules) => rules.Reply.referrerPolicy('origin'), ['origin'], 'origin'],
  ['Reply.status (HY-69)', 'replyStatus', (rules) => rules.Reply.status(403), [403], 403],
  ['Result.redirect (HY-46)', 'redirectLocation', (rules) => rules.Result.redirect('/list'), ['/list'], '/list'],
  ['Result.page (HY-58)', 'pageStatus', (rules) => rules.Result.page(422), [422], 422],
  ['App.varyHeader (HY-117.1)', 'pageVary', (rules) => rules.App.varyHeader(true), [true], 'Accept, HX-Request, HX-Current-URL, Hyper-Context'],
  ['the tag of Page.respond (HY-53.1)', 'pageTag', (rules) => rules.Page.tag('{}', 'masked', TOKEN), ['{}', 'masked', TOKEN], 'W/"0"'],
];

for (const [label, name, call, args, result] of EXACT) {
  test(`${label} calls ${name} of the binding with its arguments and returns its result`, () => {
    const { rules, calls } = rulesOf({ [name]: result });
    assert.deepEqual(call(rules), result);
    assert.deepEqual(calls, [[name, args]]);
  });
}

test('RepresentationResponse.etag gives representation_tag the content type and the UTF-8 bytes of the body (HY-122.10)', () => {
  const { rules, calls } = rulesOf({ representationTag: '"tag"' });
  assert.equal(rules.RepresentationResponse.etag('application/json', '{"a":"é"}'), '"tag"');
  assert.deepEqual(calls, [['representationTag', ['application/json', new TextEncoder().encode('{"a":"é"}')]]]);
});

test('a failure of the binding reaches the caller as the binding raised it (HY-132.1, HY-132.2)', () => {
  const failure = Object.assign(new RangeError('a CSRF token is not 64 lowercase hexadecimal digits'), { kind: 'invalid_csrf_form', status: null });
  const { rules } = rulesOf({ csrfMask: failure, storedToken: failure, openPage: failure });
  assert.throws(() => rules.Csrf.mask('x', MASK), (error) => error === failure);
  // HY-24.14: a session that holds another value in the place of the token fails the request.
  assert.throws(() => rules.Session.storedToken('conformance-token'), (error) => error === failure);
  assert.throws(() => rules.Page.open(PAGES, STORE, opening()), (error) => error === failure);
});

test('a module without a member of the binding fails with the name of the member', () => {
  const { core } = standIn({});
  const { csrfMask: _mask, Pages: _pages, ...rest } = core;
  assert.throws(() => coreRules(rest as CoreBinding), { message: 'hyper: the binding of the core has no member csrfMask, Pages' });
});

function plain(status: number, body: string, more: Partial<Plain> = {}): Plain {
  return { status, body: new TextEncoder().encode(body), varyAccept: false, ...more };
}

function opening(): Parameters<CoreRules['Page']['open']>[2] {
  return { route: 'list', params: [], kind: 'html', action: false, path: '/list', basePath: '', mask: MASK, now: 0 };
}

test('a plain answer of the core is a text response with its Allow and its Vary (HY-58, HY-27.6, HY-117.3)', () => {
  const { rules } = rulesOf({});
  assert.deepEqual(rules.App.plain(plain(404, 'Not Found')), { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'Not Found' });
  assert.deepEqual(rules.App.plain(plain(405, 'Method Not Allowed', { allow: 'GET, HEAD' })), {
    status: 405,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' },
    body: 'Method Not Allowed',
  });
  assert.deepEqual(rules.App.plain(plain(406, 'text/html', { varyAccept: true, allow: null })), {
    status: 406,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', Vary: 'Accept' },
    body: 'text/html',
  });
});

test('App.storeKept gives answer_keep_request the pages, the store and the request, and the 204 has no Content-Type (HY-40.1)', () => {
  const request = { region: 'rows', path: 'open', value: 'true', formCsrf: 'masked' };
  const { rules, calls } = rulesOf({ answerKeepRequest: plain(204, '') });
  assert.deepEqual(rules.App.storeKept(PAGES, STORE, request), { status: 204, headers: {}, body: '' });
  assert.deepEqual(calls, [['answerKeepRequest', [PAGES, STORE, request]]]);
  const refused = rulesOf({ answerKeepRequest: plain(403, 'Forbidden') });
  assert.deepEqual(refused.rules.App.storeKept(PAGES, STORE, request), { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'Forbidden' });
});

test('App.route gives route_request the pages, the choice and the parts of the request (HY-116, HY-59.12, HY-120.2)', () => {
  const front = { method: 'POST', path: '/add', accept: ['text/html'], hxRequest: false, malformedContentType: true };
  const route = { route: 'plain', answer: plain(400, 'Bad Request') };
  const { rules, calls } = rulesOf({ routeRequest: route });
  assert.equal(rules.App.route(PAGES, false, front), route);
  assert.deepEqual(calls, [['routeRequest', [PAGES, false, front]]]);
});

test('App.frameHeaders gives the headers of frame_headers as a record (HY-45.5, HY-65.1)', () => {
  const { rules, calls } = rulesOf({ frameHeaders: [['Content-Security-Policy', "frame-ancestors 'self'"], ['Cache-Control', 'no-store']] });
  assert.deepEqual(rules.App.frameHeaders(403, "'self'"), { 'Content-Security-Policy': "frame-ancestors 'self'", 'Cache-Control': 'no-store' });
  assert.deepEqual(calls, [['frameHeaders', [403, "'self'"]]]);
});

test('the headers of Page.respond are those of compute_page_headers in their order, the Referrer-Policy of the reply included (HY-103.5, HY-53.4)', () => {
  const response = { status: 200, json: true, body: '{}', context: false, maskedToken: 'masked', token: TOKEN, method: 'GET', ifNoneMatch: 'W/"0"', referrerPolicy: 'origin' };
  const computed = { status: 304, headers: [['Cache-Control', 'no-store'], ['Vary', 'Accept'], ['Referrer-Policy', 'origin'], ['ETag', 'W/"0"']], body: false };
  const { rules, calls } = rulesOf({ computePageHeaders: computed });
  const headers = rules.Page.headers(response);
  assert.deepEqual(headers, { status: 304, headers: { 'Cache-Control': 'no-store', Vary: 'Accept', 'Referrer-Policy': 'origin', ETag: 'W/"0"' }, body: false });
  assert.deepEqual(Object.keys(headers.headers), ['Cache-Control', 'Vary', 'Referrer-Policy', 'ETag']);
  assert.deepEqual(calls, [['computePageHeaders', [response]]]);
});

test('App.checkShellPath and App.shellText call the two rules of the static shell, the path first (HY-62)', () => {
  const bytes = new TextEncoder().encode('<html>');
  const { rules, calls } = rulesOf({ shellText: '<html>' });
  rules.App.checkShellPath('/srv/csr/index.html');
  assert.equal(rules.App.shellText('/srv/csr/index.html', bytes), '<html>');
  assert.deepEqual(calls, [['checkShellPath', ['/srv/csr/index.html']], ['shellText', ['/srv/csr/index.html', bytes]]]);
});

test('Application.open opens the pages and registers each host function in its order (HY-48, HYC-24)', () => {
  const manifest = new TextEncoder().encode('{}');
  const templates = new Map([['layout.tpl', '']]);
  const options = { build: '1'.repeat(64), timezone: 'Z', context: false, basePath: '', formTypes: ['application/x-www-form-urlencoded'] };
  const first = (): unknown => 1;
  const second = (): unknown => 2;
  const { rules, calls } = rulesOf({});
  const pages = rules.Application.open(manifest, templates, new Map(), options, new Map([['b', first], ['a', second]]));
  assert.equal(pages.constructor.name, 'Pages');
  assert.deepEqual(calls, [['new Pages', [manifest, templates, new Map(), options]], ['Pages.register', ['b', first]], ['Pages.register', ['a', second]]]);
});

test('Page.open and Page.request give the core the pages, the store and the input of a page (HY-120.6, HY-15)', () => {
  const input: PageInput = { route: 'list', params: new Map(), kind: 'html', action: false, csrf: 'masked', changed: [], stored: new Map(), now: 0 };
  const opened = { opened: 'page', input, flash: new Map(), token: TOKEN };
  const step = { step: 'call', call: { call: 'shared' } };
  const { rules, calls } = rulesOf({ openPage: opened, 'PageRequest.next': step });
  assert.equal(rules.Page.open(PAGES, STORE, opening()), opened);
  assert.equal(rules.Page.request(PAGES, input).next({ input: 'start' }), step);
  assert.deepEqual(calls, [['openPage', [PAGES, STORE, opening()]], ['new PageRequest', [PAGES, input]], ['PageRequest.next', [{ input: 'start' }]]]);
});

// The other partial units, which return the result of their member as it is.
const PARTIAL: [string, keyof CoreBinding, (rules: CoreRules) => unknown, unknown[], unknown][] = [
  ['RecordSession.cookieHeader (HY-45.8)', 'sessionCookie', (rules) => rules.RecordSession.cookieHeader('id', true), ['id', true], '__Host-hy-session=id; Path=/; Secure; HttpOnly; SameSite=Lax'],
  ['Reply.keepsOutOfSharedCaches (HY-52.6)', 'keepsOutOfSharedCaches', (rules) => rules.Reply.keepsOutOfSharedCaches('private'), ['private'], true],
  ['Result.isApplicationPath (HY-46)', 'isApplicationPath', (rules) => rules.Result.isApplicationPath('//a'), ['//a'], false],
  ['App.keptValue (HY-40.1)', 'keptValue', (rules) => rules.App.keptValue(PAGES, 'rows', 'open', 'true'), [PAGES, 'rows', 'open', 'true'], true],
  ['Session.storedToken (HY-24.14)', 'storedToken', (rules) => rules.Session.storedToken(TOKEN), [TOKEN], TOKEN],
  ['Kept.cookieName (HYC-13.6)', 'keepName', (rules) => rules.Kept.cookieName(false), [false], 'hy-keep'],
  ['Build.read (HY-125.18)', 'readBuild', (rules) => rules.Build.read(new Uint8Array([123])), [new Uint8Array([123])], '1'.repeat(64)],
  ['Build.checkId (HY-125.19)', 'checkBuildId', (rules) => rules.Build.checkId('1'.repeat(64)), ['1'.repeat(64)], undefined],
  ['Build.id (HY-125.15)', 'buildId', (rules) => rules.Build.id([{ path: 'program/reads.json', bytes: new Uint8Array() }]), [[{ path: 'program/reads.json', bytes: new Uint8Array() }]], '2'.repeat(64)],
  ['Build.fileText (HY-125.18)', 'buildFileText', (rules) => rules.Build.fileText('1'.repeat(64)), ['1'.repeat(64)], `{"build":"${'1'.repeat(64)}"}`],
  ['Templates.problems (HY-48.3)', 'templateProblems', (rules) => rules.Templates.problems(new Uint8Array(), new Map()), [new Uint8Array(), new Map()], ['a problem']],
  ['Templates.routeReads (HY-73)', 'routeReads', (rules) => rules.Templates.routeReads(new Uint8Array(), new Map()), [new Uint8Array(), new Map()], new Map([['list', true]])],
  ['Templates.reads (HY-73)', 'templateReads', (rules) => rules.Templates.reads(new Map(), 'layout.tpl'), [new Map(), 'layout.tpl'], true],
  ['Templates.reserved (HY-31.3)', 'reservedDataTemplate', (rules) => rules.Templates.reserved(), [], { name: 'hyper/data.tpl', source: '' }],
];

for (const [label, name, call, args, result] of PARTIAL) {
  test(`${label} calls ${name} of the binding with its arguments and returns its result`, () => {
    const { rules, calls } = rulesOf({ [name]: result });
    assert.deepEqual(call(rules), result);
    assert.deepEqual(calls, [[name, args]]);
  });
}
