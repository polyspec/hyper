// The host functions of an application (HYC-24, HY-106): the cases of contracts/functions.json run against the application
// with_functions that the shared build of var/contract-programs holds (scripts/contract-programs.mjs).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { App, MemorySessionStore, Request, type Handlers } from '../src/index.js';
import type { HostFunction } from '@polyspec/template/render';
import type { Value } from '../src/values.js';

interface FunctionCase {
  id: string;
  application: string;
  functions: Record<string, string>;
  request?: { method: string; target: string; headers: Record<string, string> };
  status?: number;
  body?: string;
  bodyContains?: string[];
  openFails?: boolean;
  openError?: string;
}

const contract = JSON.parse(readFileSync(new URL('../../../../contracts/functions.json', import.meta.url), 'utf8')) as {
  functionKinds: Record<string, string>;
  applications: Record<string, { loaders: Record<string, Record<string, unknown>> }>;
  cases: FunctionCase[];
};
const PROGRAMS = fileURLToPath(new URL('../../../../var/contract-programs/', import.meta.url));

// The functions of the kinds that the contract names (HYC-24): `suffix` returns its first argument followed by `!`, and
// `not_a_function` is the string "x" in the place of a function.
const IMPLEMENTATIONS: Record<string, unknown> = {
  suffix: (args: unknown[]) => `${String(args[0])}!`,
  not_a_function: 'x',
};

// Maps the kinds of a case to the values of the `functions` option, failing on a kind that the contract does not state.
// The not_a_function kind is deliberately not a function: the cast passes that value to the open, which must refuse it.
function functionsOf(kinds: Record<string, string>): Record<string, HostFunction> {
  return Object.fromEntries(
    Object.entries(kinds).map(([name, kind]) => {
      if (!(kind in contract.functionKinds) || !(kind in IMPLEMENTATIONS)) throw new Error(`the contract has no function kind ${kind}`);
      return [name, IMPLEMENTATIONS[kind] as HostFunction];
    }),
  );
}

describe('host functions (HYC-24, HY-106)', () => {
  for (const item of contract.cases) {
    it(item.id, async () => {
      const loaders = contract.applications[item.application]?.loaders;
      if (loaders === undefined) throw new Error(`the contract has no application ${item.application}`);
      const dir = `${PROGRAMS}${item.application}`;
      const handlers: Handlers<Record<string, never>> = {
        routes: { home: { load: () => new Map(Object.entries(loaders.home ?? {}) as [string, Value][]) } },
      };
      const options = {
        manifest: `${dir}/manifest.json`,
        build: `${dir}/build.json`,
        templates: { index: `${dir}/node/templates.index.json`, root: `${dir}/node` },
        handlers,
        timezone: '+09:00',
        log: () => {},
        functions: functionsOf(item.functions),
      };
      if (item.openFails === true) {
        const failure = await App.open<Record<string, never>>(options).then(
          () => null,
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        );
        expect(failure).not.toBeNull();
        if (item.openError !== undefined) expect(failure).toContain(item.openError);
        return;
      }
      const app = await App.open<Record<string, never>>(options);
      const response = await app.handle(Request.from({ method: item.request?.method ?? 'GET', target: item.request?.target ?? '/', headers: item.request?.headers ?? {} }), new MemorySessionStore());
      expect(response.status).toBe(item.status);
      if (item.body !== undefined) expect(response.body).toBe(item.body);
      for (const text of item.bodyContains ?? []) expect(response.body).toContain(text);
    });
  }
});
