// The steps of contracts/functions.json (HYC-24, HY-106): the cases run against the application with_functions that the
// shared build of var/contract-programs holds (scripts/contract-programs.mts). `suffix` returns its first argument followed
// by `!`, and `not_a_function` is the string "x" in the place of a function; the open must refuse it.
import { fileURLToPath } from 'node:url';
import { App, MemorySessionStore, Request, type Handlers } from '../../src/index.js';
import type { HostFunction } from '@polyspec/template/render';
import type { Value } from '../../src/values.js';
import type { CaseReader } from '../case-reader.js';
import { requestOf } from '../../src/http.js';

const PROGRAMS = fileURLToPath(new URL('../../../../../var/contract-programs/', import.meta.url));

const IMPLEMENTATIONS: Record<string, unknown> = {
  suffix: (args: unknown[]) => `${String(args[0])}!`,
  not_a_function: 'x',
};

// Maps the kinds of a case to the values of the `functions` option, failing on a kind that the contract does not state.
function functionsOf(kinds: Map<string, string>, declared: Map<string, string>): Record<string, HostFunction> {
  return Object.fromEntries(
    [...kinds].map(([name, kind]) => {
      if (!declared.has(kind) || !(kind in IMPLEMENTATIONS)) throw new Error(`the contract has no function kind ${kind}`);
      return [name, IMPLEMENTATIONS[kind] as HostFunction];
    }),
  );
}

// The error of a rejected open, or null when the open did not fail.
function failureOf(open: Promise<unknown>): Promise<unknown> {
  return open.then(
    () => null,
    (error: unknown) => error,
  );
}

export const steps = {
  async cases(reader: CaseReader): Promise<void> {
    const application = reader.input('application') as string;
    const applications = reader.input('applications') as Map<string, Map<string, Map<string, Map<string, Value>>>>;
    const loaders = applications.get(application)?.get('loaders');
    if (loaders === undefined) throw new Error(`the contract has no application ${application}`);
    const dir = `${PROGRAMS}${application}`;
    const handlers: Handlers<Record<string, never>> = {
      routes: { home: { load: () => new Map(loaders.get('home') ?? []) } },
    };
    const options = {
      manifest: `${dir}/manifest.json`,
      build: `${dir}/build.json`,
      templates: { index: `${dir}/node/templates.index.json`, root: `${dir}/node` },
      handlers,
      timezone: '+09:00',
      log: () => {},
      functions: functionsOf(reader.input('functions') as Map<string, string>, reader.input('functionKinds') as Map<string, string>),
    };
    if (reader.has('openFails')) {
      const failure = await failureOf(App.open<Record<string, never>>(options));
      reader.compare('openFails', failure);
      reader.compare('openError', failure instanceof Error ? failure.message : null);
      return;
    }
    const app = await App.open<Record<string, never>>(options);
    const headers = reader.has('request.headers') ? (reader.input('request.headers') as Map<string, string>) : new Map();
    const request = requestOf({
      method: reader.has('request.method') ? (reader.input('request.method') as string) : 'GET',
      target: reader.has('request.target') ? (reader.input('request.target') as string) : '/',
      headers: Object.fromEntries(headers),
    });
    const response = await app.handle(request, new MemorySessionStore());
    reader.compare('status', response.status);
    reader.compare('body', response.body);
    reader.compare('bodyContains', response.body);
  },
};
