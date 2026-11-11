// The cases of contracts/functions.json (HYC-24, HY-43, HY-106): the host functions of an application are registered
// when the application opens, through createApplication, and through HyperOptions.functions of the browser code, where a
// failed registration fails the start.
import { parse, parseJson, type Template } from '@polyspec/template';
import { describe, expect, it } from 'vitest';
import fixture from '../../../contracts/functions.json';
import { checkManifest, createApplication, decodeResponse, Hyper, renderDocument, type Application, type DocumentAdapter, type HtmxApi, type RegionElement, type TemplateIndex } from '../src/index.js';
import { defined } from './values.js';

// The host function of each kind that the contract names (functionKinds): `suffix` returns its first argument followed by
// `!`, and `not_a_function` is the string "x" in the place of a function.
const KINDS: Record<string, unknown> = {
  suffix: (args: unknown[]) => `${String(args[0])}!`,
  not_a_function: 'x',
};

type HostFunctions = NonNullable<Parameters<typeof createApplication>[3]>;

// The functions of a case, mapped from the kinds that the case names (HYC-24). A kind that the runner does not map fails.
// The value of `not_a_function` is not a function, which the engine refuses (template RT-5), so the cast is the case.
function functionsOf(names: Record<string, string>): HostFunctions {
  return Object.fromEntries(Object.entries(names).map(([name, kind]) => {
    if (!(kind in KINDS)) throw new Error(`functions.json names the kind ${kind}, which the runner does not map`);
    return [name, KINDS[kind]];
  })) as HostFunctions;
}

// A case of the contract, typed by the members that the runner reads.
interface FunctionCase {
  id: string;
  label: string;
  functions: Record<string, string>;
  openFails?: boolean;
  openError?: string;
  status?: number;
  body?: string;
  bodyContains?: string[];
}
// The JSON import is typed by the union of its literal cases, where a member that one case omits is undefined in another.
const cases = fixture.cases as unknown as FunctionCase[];
const spec = fixture.applications.with_functions;
const manifest = checkManifest(spec.manifest);
const sources: Record<string, string> = spec.templates;
const parsed: Record<string, Template> = Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, parse(source, name)]));
const index: TemplateIndex = Object.fromEntries(Object.keys(sources).map((name) => [name, { url: `/t/${name}` }]));
const fetcher = async (url: string): Promise<Template> => defined(parsed[url.slice('/t/'.length)], `the template of ${url}`);

// The JSON response of the home route of the application (HY-17, HY-128).
const response = parseJson(JSON.stringify({ env: { timezone: 'Z' }, route: 'home', params: {}, build: spec.build, shared: { title: 'Home' }, regions: { content: {} }, kept: {} }));

// A document adapter of the test, which holds the build of the page (HY-125).
class FunctionDocument implements DocumentAdapter {
  build(): string | null {
    return spec.build;
  }
  async stylesheets(): Promise<() => void> {
    return () => undefined;
  }
  mount(): void {}
  text(): void {}
  fail(): void {}
  elements(): number {
    return 1;
  }
  assign(): void {}
}

// The htmx operations of the test, which no case uses.
const htmx: HtmxApi<RegionElement> = {
  process: () => undefined,
  swap: async () => undefined,
  find: () => null,
  config: { defaultTimeout: 60000 },
  parseInterval: Number,
};

// The application of the contract, which every case opens with its functions (createApplication, HYC-24).
async function openApplication(names: Record<string, string>): Promise<Application> {
  const app = createApplication(manifest, index, fetcher, functionsOf(names));
  await app.templates.ensure(Object.keys(index));
  return app;
}

// The browser code of the contract, which opens the application without functions and registers the functions
// through its options (HYC-24).
function openHyper(names: Record<string, string>): Hyper<RegionElement> {
  const app = createApplication(manifest, index, fetcher);
  return new Hyper<RegionElement>(app, htmx, {
    basePath: '',
    element: () => null,
    storage: { read: () => null, write: () => undefined, send: async () => true },
    document: new FunctionDocument(),
    currentUrl: () => 'http://localhost/',
    functions: functionsOf(names),
  });
}

describe('host functions of the application (HYC-24, HY-106)', () => {
  for (const testCase of cases) {
    if (testCase.openFails) {
      it(`${testCase.label} (createApplication)`, () => {
        expect(() => createApplication(manifest, index, fetcher, functionsOf(testCase.functions))).toThrow(testCase.openError);
      });
      it(`${testCase.label} (HyperOptions.functions)`, () => {
        expect(() => openHyper(testCase.functions)).toThrow(testCase.openError);
      });
      continue;
    }
    if (testCase.id === 'a_call_of_a_name_that_is_not_registered_answers_500') {
      it(`${testCase.label} (createApplication)`, async () => {
        const app = await openApplication(testCase.functions);
        expect(() => renderDocument(app, decodeResponse(app, response, '/'), { embed: false })).toThrow('shout is not a function');
      });
      continue;
    }
    it(`${testCase.label} (createApplication)`, async () => {
      const app = await openApplication(testCase.functions);
      const html = renderDocument(app, decodeResponse(app, response, '/'), { embed: false });
      for (const text of testCase.bodyContains ?? []) expect(html).toContain(text);
    });
    it(`${testCase.label} (HyperOptions.functions)`, async () => {
      const hyper = openHyper(testCase.functions);
      await hyper.app.templates.ensure(Object.keys(index));
      const html = renderDocument(hyper.app, decodeResponse(hyper.app, response, '/'), { embed: false });
      for (const text of testCase.bodyContains ?? []) expect(html).toContain(text);
    });
  }
});
