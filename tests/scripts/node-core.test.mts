// The rules of the core behind the names of the units of the Node server (packages/ts/src/app/core-rules.ts, HY-133.2),
// against a stand-in of the module of the Node binding: the stand-in records each call and returns the value that the
// test gives it, so the tests need no native module. They state which member of the binding each unit calls, with
// which arguments, and what the unit returns; the rules themselves are tested in the core.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coreRules, sharedRules, type CoreBinding, type CoreRules, type PageInput } from '../../packages/ts/src/app/core-rules.ts';

type Call = [string, unknown[]];

const NO_MEMBER = 'hyper: the binding of the core has no member ';

// The names of the members that coreRules requires of the module of the binding, read from the failure of coreRules
// for a module without a member, which names each of them. The stand-in holds a member for each of these names, so a
// member that core-rules.ts gains is a member of the stand-in without a change of this file.
function requiredMembers(): string[] {
  try {
    coreRules({});
  } catch (error) {
    assert.ok(error instanceof Error && error.message.startsWith(NO_MEMBER), `coreRules({}) fails with the names of the members: ${String(error)}`);
    return error.message.slice(NO_MEMBER.length).split(', ');
  }
  throw new Error('coreRules({}) did not fail: a module without a member is no binding of the core');
}

const REQUIRED = requiredMembers();

// A stand-in of the binding module: every function member records its call and returns `results[name]`, or throws it
// when it is an Error; the classes record their construction and the calls of their methods.
function standIn(results: Record<string, unknown>): { core: Record<string, unknown>; calls: Call[] } {
  const calls: Call[] = [];
  const member = (name: string) => (...args: unknown[]): unknown => {
    calls.push([name, args]);
    const result = results[name];
    if (result instanceof Error) throw result;
    return result;
  };
  class HyperValueError extends RangeError {
    readonly kind: unknown;
    readonly status: unknown;

    constructor(...args: unknown[]) {
      super(String(args[0]));
      calls.push(['new HyperValueError', args]);
      [, this.kind, this.status] = args;
    }
  }
  class HyperTypeError extends TypeError {
    readonly kind: unknown;
    readonly status: unknown;

    constructor(...args: unknown[]) {
      super(String(args[0]));
      calls.push(['new HyperTypeError', args]);
      [, this.kind, this.status] = args;
    }
  }
  class Pages {
    constructor(...args: unknown[]) {
      calls.push(['new Pages', args]);
    }

    register(...args: unknown[]): void {
      calls.push(['Pages.register', args]);
    }

    renderDocument(...args: unknown[]): unknown {
      calls.push(['Pages.renderDocument', args]);
      return results['Pages.renderDocument'];
    }

    renderParts(...args: unknown[]): unknown {
      calls.push(['Pages.renderParts', args]);
      return results['Pages.renderParts'];
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
  class RequestBody {
    static start(...args: unknown[]): unknown {
      calls.push(['RequestBody.start', args]);
      return results['RequestBody.start'];
    }
  }
  const classes: Record<string, unknown> = { Pages, PageRequest, RequestBody, HyperValueError, HyperTypeError };
  const module: Record<string, unknown> = {};
  for (const name of REQUIRED) module[name] = classes[name] ?? member(name);
  return { core: module, calls };
}

// The members of the binding that a test of this file below calls by its own statement, outside the tables EXACT and
// PARTIAL.
const OWN_TEST = [
  'representationTag', 'openPage', 'answerKeepRequest', 'routeRequest', 'frameHeaders', 'computePageHeaders', 'checkShellPath', 'shellText',
  'jsonRead', 'acceptRanges', 'Pages', 'PageRequest', 'RequestBody', 'HyperValueError', 'HyperTypeError',
];

function rulesOf(results: Record<string, unknown>): { rules: CoreRules; calls: Call[] } {
  const { core, calls } = standIn(results);
  return { rules: coreRules(core), calls };
}

const TOKEN = 'a'.repeat(64);
const MASK = 'b'.repeat(64);
const PAGES = { pages: true };
const STORE = { store: true };
// A value that a session holds, and the values of the data model that the binding gives for a flash and for kept values.
const STORED = { stored: true };
const FLASH = new Map<string, unknown>([['values', new Map()], ['changed', []]]);
const KEPT = new Map([['rows', new Map([['open', true]])]]);
// The four limits of a body as the record body_limits of the core takes them (F-25).
const LIMITS = { limit: 8, valueLimit: 4, partLimit: 2, fileLimit: 1 };

// The exact units: the name of the unit of the server, the member of the binding, the arguments of the call, the
// arguments that the member must receive and the value that the member returns, which the unit returns as it is.
const EXACT: [string, keyof CoreBinding, (rules: CoreRules) => unknown, unknown[], unknown][] = [
  ['Csrf.mask (HY-24.2)', 'csrfMask', (rules) => rules.csrfMask(TOKEN, MASK), [TOKEN, MASK], 'masked'],
  ['Csrf.verify (HY-24.4)', 'csrfVerify', (rules) => rules.csrfVerify(TOKEN, 'value'), [TOKEN, 'value'], true],
  ['Csrf.browserOf (HY-24.10)', 'browser', (rules) => rules.csrfBrowserOf('masked'), ['masked'], 'digest'],
  ['Csrf.browserOf of a request without a session (HY-24.12)', 'browser', (rules) => rules.csrfBrowserOf(''), [''], null],
  ['Context.hash (HY-125.12)', 'contextHash', (rules) => rules.contextHash('build', '{}'), ['build', '{}'], 'hash'],
  ['Context.validHeader (HY-127.2)', 'validContextHeader', (rules) => rules.contextValidHeader(null), [null], true],
  ['FileSession.get (HY-104.13)', 'sessionValue', (rules) => rules.sessionValue('stored'), ['stored'], 'value'],
  ['FileSession.set (HY-104.14)', 'sessionRecord', (rules) => rules.sessionRecord('value'), ['value'], 'stored'],
  ['JsonCodec.encode (HY-54.18)', 'jsonWrite', (rules) => rules.jsonCodecEncode(FLASH), [FLASH], '{"values":{},"changed":[]}'],
  ['Request.fileOver (HY-114.12)', 'fileOver', (rules) => rules.requestFileOver([3, 9], 8), [[3, 9], 8], true],
  ['Session.flashOf (HY-25.2)', 'flashOf', (rules) => rules.sessionFlashOf(STORED), [STORED], FLASH],
  ['Session.keptOf (HY-104.22)', 'keptOf', (rules) => rules.sessionKeptOf(STORED), [STORED], KEPT],
  ['RecordSession.cookieName (HY-45.1)', 'sessionName', (rules) => rules.sessionCookieName(true), [true], '__Host-hy-session'],
  ['Request.mediaType (HY-59.13)', 'mediaType', (rules) => rules.requestMediaType('text/plain; charset=UTF-8'), ['text/plain; charset=UTF-8'], 'text/plain'],
  ['Request.currentPath (HY-11.5)', 'currentPath', (rules) => rules.requestCurrentPath('http://a.test/b?c'), ['http://a.test/b?c'], '/b'],
  ['Reply.cacheControl (HY-52.6)', 'cacheControl', (rules) => rules.replyCacheControl('private'), ['private'], 'private'],
  ['Reply.referrerPolicy (HY-103.2)', 'referrerPolicy', (rules) => rules.replyReferrerPolicy('origin'), ['origin'], 'origin'],
  ['Reply.status (HY-69)', 'replyStatus', (rules) => rules.replyStatus(403), [403], 403],
  ['Result.redirect (HY-46)', 'redirectLocation', (rules) => rules.resultRedirect('/list'), ['/list'], '/list'],
  ['Result.page (HY-58)', 'pageStatus', (rules) => rules.resultPage(422), [422], 422],
  ['App.varyHeader (HY-117.1)', 'pageVary', (rules) => rules.appVaryHeader(true), [true], 'Accept, HX-Request, HX-Current-URL, Hyper-Context'],
  ['the tag of Page.respond (HY-53.1)', 'pageTag', (rules) => rules.pageTag('{}', 'masked', TOKEN), ['{}', 'masked', TOKEN], 'W/"0"'],
];

test('RepresentationResponse.etag gives representation_tag the content type and the UTF-8 bytes of the body (HY-122.10)', () => {
  const { rules, calls } = rulesOf({ representationTag: '"tag"' });
  assert.equal(rules.representationEtag('application/json', '{"a":"é"}'), '"tag"');
  assert.deepEqual(calls, [['representationTag', ['application/json', new TextEncoder().encode('{"a":"é"}')]]]);
});

test('a failure of the binding reaches the caller as the binding raised it (HY-133.1, HY-133.2)', () => {
  const failure = Object.assign(new RangeError('a CSRF token is not 64 lowercase hexadecimal digits'), { kind: 'invalid_csrf_form', status: null });
  const { rules } = rulesOf({ csrfMask: failure, storedToken: failure });
  assert.throws(() => rules.csrfMask('x', MASK), (error) => error === failure);
  // HY-24.14: a session that holds another value in the place of the token fails the request.
  assert.throws(() => rules.sessionStoredToken('conformance-token'), (error) => error === failure);
});

test('a module without a member of the binding fails with the name of the member', () => {
  const { core } = standIn({});
  const { csrfMask: _mask, Pages: _pages, ...rest } = core;
  assert.throws(() => coreRules(rest), { message: `${NO_MEMBER}csrfMask, Pages` });
  // A member that is no function is no member of the binding.
  assert.throws(() => coreRules({ ...core, jsonRead: 'text' }), { message: `${NO_MEMBER}jsonRead` });
});

test('JsonCodec.decode gives json_read the UTF-8 bytes of the text and returns its value (HY-54.20)', () => {
  const { rules, calls } = rulesOf({ jsonRead: KEPT });
  assert.equal(rules.jsonCodecDecode('{"rows":{"open":true},"é":1}'), KEPT);
  assert.deepEqual(calls, [['jsonRead', [new TextEncoder().encode('{"rows":{"open":true},"é":1}')]]]);
});

test('Accept.parse gives accept_ranges the value as one line, and no line for a request without Accept (HY-116.17)', () => {
  const ranges = [{ type: 'text', subtype: 'html', parameters: [], weight: 1000 }];
  const { rules, calls } = rulesOf({ acceptRanges: ranges });
  assert.equal(rules.acceptParse('text/html'), ranges);
  assert.equal(rules.acceptParse(null), ranges);
  assert.deepEqual(calls, [['acceptRanges', [['text/html']]], ['acceptRanges', [[]]]]);
});

test('valueError and typeError give the errors of the classes of the binding with their kind and no status (HY-133.2)', () => {
  const { rules, calls } = rulesOf({});
  const value = rules.valueError('a value', 'invalid_value');
  const type = rules.typeError('a type', 'invalid_type');
  assert.ok(value instanceof RangeError && type instanceof TypeError);
  assert.deepEqual([value.message, value.kind, value.status], ['a value', 'invalid_value', null]);
  assert.deepEqual([type.message, type.kind, type.status], ['a type', 'invalid_type', null]);
  assert.deepEqual(calls, [['new HyperValueError', ['a value', 'invalid_value', null]], ['new HyperTypeError', ['a type', 'invalid_type', null]]]);
});

test('App.frameHeaders gives the headers of frame_headers as a record (HY-45.5, HY-65.1)', () => {
  const { rules, calls } = rulesOf({ frameHeaders: [['Content-Security-Policy', "frame-ancestors 'self'"], ['Cache-Control', 'no-store']] });
  assert.deepEqual(rules.appFrameHeaders(403, "'self'"), { 'Content-Security-Policy': "frame-ancestors 'self'", 'Cache-Control': 'no-store' });
  assert.deepEqual(calls, [['frameHeaders', [403, "'self'"]]]);
});

test('the headers of Page.respond are those of compute_page_headers in their order, the Referrer-Policy of the reply included (HY-103.5, HY-53.4)', () => {
  const response = { status: 200, json: true, body: '{}', context: false, maskedToken: 'masked', token: TOKEN, method: 'GET', ifNoneMatch: 'W/"0"', referrerPolicy: 'origin' };
  const computed = { status: 304, headers: [['Cache-Control', 'no-store'], ['Vary', 'Accept'], ['Referrer-Policy', 'origin'], ['ETag', 'W/"0"']], body: false };
  const { rules, calls } = rulesOf({ computePageHeaders: computed });
  const headers = rules.pageHeaders(response);
  assert.deepEqual(headers, { status: 304, headers: { 'Cache-Control': 'no-store', Vary: 'Accept', 'Referrer-Policy': 'origin', ETag: 'W/"0"' }, body: false });
  assert.deepEqual(Object.keys(headers.headers), ['Cache-Control', 'Vary', 'Referrer-Policy', 'ETag']);
  assert.deepEqual(calls, [['computePageHeaders', [response]]]);
});

test('App.checkShellPath and App.shellText call the two rules of the static shell, the path first (HY-62)', () => {
  const bytes = new TextEncoder().encode('<html>');
  const { rules, calls } = rulesOf({ shellText: '<html>' });
  rules.appCheckShellPath('/srv/csr/index.html');
  assert.equal(rules.appShellText('/srv/csr/index.html', bytes), '<html>');
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

test('Page.document and Page.parts give the pages the route, the shared data, the data of each region and the time (HY-12.1, HY-13)', () => {
  const parts = { title: 'T - Site', regions: new Map([['content', '<p>T</p>\n']]) };
  const { rules, calls } = rulesOf({ 'Pages.renderDocument': '<title>T - Site</title>', 'Pages.renderParts': parts });
  const pages = rules.Application.open(new TextEncoder().encode('{}'), new Map(), new Map(), { build: '1'.repeat(64), timezone: 'Z', context: false, basePath: '', formTypes: [] }, new Map());
  const shared = new Map([['title', 'T']]);
  const regions = new Map([['content', new Map<string, unknown>()]]);
  assert.equal(rules.pageDocument(pages, 'home', shared, regions, 0), '<title>T - Site</title>');
  assert.equal(rules.pageParts(pages, 'home', shared, regions, 0), parts);
  assert.deepEqual(calls.slice(1), [['Pages.renderDocument', ['home', shared, regions, 0]], ['Pages.renderParts', ['home', shared, regions, 0]]]);
});

test('Page.request gives the core the pages and the input of a page, and steps it (HY-15)', () => {
  const input: PageInput = { route: 'list', params: new Map(), kind: 'html', action: false, csrf: 'masked', changed: [], now: 0 };
  const step = { step: 'call', call: { call: 'shared' } };
  const { rules, calls } = rulesOf({ 'PageRequest.next': step });
  assert.equal(rules.pageRequest(PAGES, input).next({ input: 'start' }), step);
  assert.deepEqual(calls, [['new PageRequest', [PAGES, input]], ['PageRequest.next', [{ input: 'start' }]]]);
});

// The other partial units, which return the result of their member as it is.
const PARTIAL: [string, keyof CoreBinding, (rules: CoreRules) => unknown, unknown[], unknown][] = [
  ['RecordSession.cookieHeader (HY-45.8)', 'sessionCookie', (rules) => rules.sessionCookieHeader('id', true), ['id', true], '__Host-hy-session=id; Path=/; Secure; HttpOnly; SameSite=Lax'],
  ['Session.storedToken (HY-24.14)', 'storedToken', (rules) => rules.sessionStoredToken(TOKEN), [TOKEN], TOKEN],
  ['Kept.cookieName (HYC-13.6)', 'keepName', (rules) => rules.keptCookieName(false), [false], 'hy-keep'],
  ['Build.read (HY-125.23)', 'readBuild', (rules) => rules.buildRead(new Uint8Array([123])), [new Uint8Array([123])], '1'.repeat(64)],
  ['Build.id (HY-125.15)', 'buildId', (rules) => rules.buildId([{ path: 'program/reads.json', bytes: new Uint8Array() }]), [[{ path: 'program/reads.json', bytes: new Uint8Array() }]], '2'.repeat(64)],
  ['Build.paths (HY-125.3)', 'buildPaths', (rules) => rules.buildPaths([]), [[]], ['program/reads.json']],
  ['Build.stream (HY-125.3)', 'buildStream', (rules) => rules.buildStream([]), [[]], '00'],
  ['Build.shellFile (HYC-16.23)', 'shellFile', (rules) => rules.buildShellFile('/api', '1'.repeat(64), '/e.js', ''), ['/api', '1'.repeat(64), '/e.js', ''], '<!doctype html>\n'],
  ['Build.fileText (HY-125.23)', 'buildFileText', (rules) => rules.buildFileText('1'.repeat(64)), ['1'.repeat(64)], `{"build":"${'1'.repeat(64)}"}`],
  ['Templates.problems (HY-48.3)', 'templateProblems', (rules) => rules.Templates.problems(new Uint8Array(), new Map()), [new Uint8Array(), new Map()], ['a problem']],
  ['Templates.routeReads (HY-73)', 'routeReads', (rules) => rules.Templates.routeReads(new Uint8Array(), new Map()), [new Uint8Array(), new Map()], new Map([['list', true]])],
  ['Templates.reads (HY-73)', 'templateReads', (rules) => rules.Templates.reads(new Map(), 'layout.tpl'), [new Map(), 'layout.tpl'], true],
  ['Templates.reserved (HY-31.3)', 'reservedDataTemplate', (rules) => rules.Templates.reserved(), [], { name: 'hyper/data.tpl', source: '' }],
  ['Application.checkFunctionEntry (HYC-24.7)', 'checkFunctionEntry', (rules) => rules.Application.checkFunctionEntry('shout', false), ['shout', false], undefined],
  ['Request.form (HY-57, F-21, F-22)', 'readHeldBody', (rules) => rules.formReadHeld('application/x-www-form-urlencoded', new Uint8Array([97]), LIMITS), ['application/x-www-form-urlencoded', new Uint8Array([97]), LIMITS], { fields: [['a', ['']]], files: [] }],
  ['Fields.parse (HY-56, F-20)', 'parseUrlencoded', (rules) => rules.formParseUrlencoded(new Uint8Array([97])), [new Uint8Array([97])], [['a', ['']]]],
];

for (const [label, name, call, args, result] of [...EXACT, ...PARTIAL]) {
  test(`${label} calls ${name} of the binding with its arguments and returns its result`, () => {
    const { rules, calls } = rulesOf({ [name]: result });
    assert.deepEqual(call(rules), result);
    assert.deepEqual(calls, [[name, args]]);
  });
}

test('the host gives request_body.start the content type, the Content-Length, the stream and the four limits, and receives its body (HY-131.1, HY-131.29)', async () => {
  const body = { body: true };
  const { rules, calls } = rulesOf({ 'RequestBody.start': Promise.resolve(body) });
  assert.equal(await rules.formStart('multipart/form-data; boundary=x', '12', true, LIMITS), body);
  assert.deepEqual(calls, [['RequestBody.start', ['multipart/form-data; boundary=x', '12', true, LIMITS]]]);
});

test('each member that coreRules requires has a test of the unit that calls it', () => {
  const tested = new Set<string>([...OWN_TEST, ...[...EXACT, ...PARTIAL].map(([, name]) => name)]);
  assert.deepEqual(REQUIRED.filter((name) => !tested.has(name)), [], 'core-rules.ts requires these members, which no test of this file calls');
  assert.deepEqual([...tested].filter((name) => !REQUIRED.includes(name)), [], 'this file tests these members, which core-rules.ts does not require');
});

const ADDON =`hyper.${process.platform}-${process.arch}${process.platform === 'linux' ? '-gnu' : ''}.node`;

test('a loader that throws fails each call with CoreBindingError naming the addon, and no rule answers (HY-133.2)', () => {
  let loads = 0;
  const rules = sharedRules(() => {
    loads += 1;
    throw new Error(`Cannot find module './${ADDON}'`);
  });
  for (const call of [() => rules(), () => rules().csrfMask(TOKEN, MASK)]) {
    assert.throws(call, (error: unknown) => error instanceof Error && error.name === 'CoreBindingError' && error.message.includes(ADDON) && error.cause instanceof Error);
  }
  assert.equal(loads, 2);
});

test('the shared rules load the module once and give one instance (HY-133.2)', () => {
  let loads = 0;
  const { core, calls } = standIn({ csrfMask: 'masked' });
  const rules = sharedRules(() => {
    loads += 1;
    return core;
  });
  assert.equal(rules(), rules());
  assert.equal(rules().csrfMask(TOKEN, MASK), 'masked');
  assert.equal(loads, 1);
  assert.deepEqual(calls, [['csrfMask', [TOKEN, MASK]]]);
});
