// The steps of contracts/functions.json (HYC-24, HY-106): the cases run against the application with_functions that the
// shared build of var/contract-programs holds (scripts/contract-programs.mts). `suffix` returns its first argument followed
// by `!`, and `not_a_function` is the string "x" in the place of a function; the open must refuse it.
import { fileURLToPath } from 'node:url';
import { App, ArraySession, type Handlers } from '../../src/index.js';
import type { CaseReader } from '../case-reader.js';
import { mapOf, textMapOf, textOf, textsOf } from '../inputs.js';
import { requestFrom } from '../support.js';
import { failureOf } from './recorded.js';

const PROGRAMS = fileURLToPath(new URL('../../../../var/contract-programs/', import.meta.url));

const IMPLEMENTATIONS: Record<string, unknown> = {
  suffix: (args: unknown[]) => `${String(args[0])}!`,
  not_a_function: 'x',
};

// Maps the kinds of a case to the values of the `functions` option, failing on a kind that the contract does not state.
// A value is given without the type of a host function, because the kind `not_a_function` is no function.
function functionsOf(kinds: Map<string, string>, declared: Map<string, string>): Record<string, unknown> {
  return Object.fromEntries(
    [...kinds].map(([name, kind]) => {
      if (!declared.has(kind) || !Object.hasOwn(IMPLEMENTATIONS, kind)) throw new Error(`the contract has no function kind ${kind}`);
      return [name, IMPLEMENTATIONS[kind]];
    }),
  );
}

// Opens the application with options that the declaration of `open` may exclude, which the open checks at run time.
async function opened(options: Record<string, unknown>): Promise<App> {
  const app: unknown = await Reflect.apply(App.open.bind(App), undefined, [options]);
  if (!(app instanceof App)) throw new Error('App.open returned no application');
  return app;
}

export const steps = {
  async cases(reader: CaseReader): Promise<void> {
    const application = textOf(reader.input('application'), 'application');
    const loaders = mapOf(mapOf(mapOf(reader.input('applications'), 'applications').get(application), application).get('loaders'), 'loaders');
    const home = loaders.has('home') ? mapOf(loaders.get('home'), 'the loader home') : new Map<string, unknown>();
    const dir = `${PROGRAMS}${application}`;
    const handlers: Handlers<Record<string, never>> = {
      routes: { home: { load: () => new Map(home) } },
    };
    const options: Record<string, unknown> = {
      manifest: `${dir}/manifest.json`,
      build: `${dir}/build.json`,
      templates: { index: `${dir}/node/templates.index.json`, root: `${dir}/node` },
      handlers,
      timezone: '+09:00',
      log: () => {},
      functions: functionsOf(textMapOf(reader.input('functions'), 'functions'), textMapOf(reader.input('functionKinds'), 'functionKinds')),
    };
    if (reader.has('openFails')) {
      const failure = await failureOf(opened(options));
      reader.compare('openFails', failure);
      reader.compare('openError', failure instanceof Error ? failure.message : null);
      return;
    }
    const app = await opened(options);
    const request = requestFrom({
      method: reader.has('request.method') ? textOf(reader.input('request.method'), 'request.method') : 'GET',
      target: reader.has('request.target') ? textOf(reader.input('request.target'), 'request.target') : '/',
      headers: reader.has('request.headers') ? textsOf(reader.input('request.headers'), 'request.headers') : {},
    });
    const response = await app.handle(request, new ArraySession());
    reader.compare('status', response.status);
    reader.compare('body', response.body);
    reader.compare('bodyContains', response.body);
  },
};
