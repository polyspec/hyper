// The steps of contracts/result.json (HY-25, HY-27, HY-46, HY-50, HY-58, HY-133): the results of actions and the stops.
import { BadRequest } from '../../src/result/bad-request.js';
import { Forbidden } from '../../src/result/forbidden.js';
import { NotFound } from '../../src/result/not-found.js';
import { Redirect } from '../../src/result/redirect.js';
import { Result } from '../../src/result/result.js';
import type { CaseReader } from '../case-reader.js';
import { failureOf } from '../case-rules.js';
import { decoded } from './session-requests.js';

function text(reader: CaseReader, name: string): string {
  const value = reader.input(name);
  if (typeof value !== 'string') throw new Error(`the case field ${name} is not a string`);
  return value;
}

function integer(reader: CaseReader, name: string): number {
  const value = reader.input(name);
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`the case field ${name} is not an integer`);
  return value;
}

function list(reader: CaseReader, name: string): unknown[] {
  const value = reader.input(name);
  if (!Array.isArray(value)) throw new Error(`the case field ${name} is not a list`);
  return value;
}

function data(reader: CaseReader, name: string): Map<string, unknown> {
  const value = reader.input(name);
  if (!(value instanceof Map)) throw new Error(`the case field ${name} is not a map`);
  const map = new Map<string, unknown>();
  value.forEach((item: unknown, key: unknown) => {
    if (typeof key !== 'string') throw new Error(`the case field ${name} has a key that is not a string`);
    map.set(key, item);
  });
  return map;
}


export const steps = {
  // Makes a redirect to the location, or records the failure with which it fails (HY-46).
  redirect(reader: CaseReader): void {
    // `notUtf8` appends a lone surrogate, the unit of a JavaScript string that is not UTF-8 text.
    const location = text(reader, 'location') + (reader.has('notUtf8') && reader.input('notUtf8') === true ? '\uD800' : '');
    const outcome = failureOf(() => Result.redirect(location));
    reader.compare('redirect', outcome.result?.location ?? null);
    reader.compare('status', outcome.result?.status ?? null);
    reader.compare('raises', outcome.raises);
  },
  // Makes an outside redirect to the location, or records the failure with which it fails (HY-133).
  outside(reader: CaseReader): void {
    const location = text(reader, 'location');
    const outcome = failureOf(() => Result.outside(location));
    reader.compare('outside', outcome.result?.location ?? null);
    reader.compare('status', outcome.result?.status ?? null);
    reader.compare('raises', outcome.raises);
  },
  // Records the origin of the text, or null for a text that is no outside location (HY-133).
  origin(reader: CaseReader): void {
    reader.compare('origin', Result.origin(text(reader, 'text')));
  },
  // Calls `flash` or `changed` of an outside redirect with the decoded argument as a JavaScript caller may, and records
  // the failure with which it fails (HY-133).
  outsideStores(reader: CaseReader): void {
    const call = text(reader, 'call');
    if (call !== 'flash' && call !== 'changed') throw new Error(`the call ${call} of the case is unknown`);
    const argument = decoded(text(reader, 'argument'));
    const result = Result.outside('https://outside.example/');
    const outcome = failureOf(() => {
      if (call === 'flash') {
        // @ts-expect-error -- a JavaScript caller passes a name that is not a string
        return result.flash(argument, null);
      }
      // @ts-expect-error -- a JavaScript caller passes a topic that is not a string
      return result.changed(argument);
    });
    reader.compare('raises', outcome.raises);
  },
  // Makes the page with the status and the data, or records the failure with which it fails (HY-58).
  page(reader: CaseReader): void {
    const status = integer(reader, 'status');
    const pageData = data(reader, 'data');
    const outcome = failureOf(() => Result.page(status, pageData));
    reader.compare('result', outcome.result?.status ?? null);
    reader.compare('redirect', outcome.result?.location ?? null);
    reader.compare('raises', outcome.raises);
    if (reader.has('held') && outcome.result !== null) {
      const page: Result = outcome.result;
      reader.compare('held', page.data);
    }
  },
  // Makes the invalid result with the data (HY-26).
  invalid(reader: CaseReader): void {
    const result = Result.invalid(data(reader, 'data'));
    reader.compare('status', result.status);
    reader.compare('redirect', result.location);
  },
  // Stores the flash values and records the changed topics on a redirect, or records the failure with which
  // storing fails (HY-25).
  copies(reader: CaseReader): void {
    const flashes = list(reader, 'flashes').map((pair): [string, unknown] => {
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') throw new Error('a flash of the case is not a name and a JSON text');
      // The JSON text gives the value as a handler returns it: an integer outside ±(2^53 − 1) is a bigint (HY-44).
      return [pair[0], decoded(pair[1])];
    });
    const topics = list(reader, 'topics').map((names) => {
      if (!Array.isArray(names)) throw new Error('topics of the case are not a list of strings');
      return names.map((name: unknown) => {
        if (typeof name !== 'string') throw new Error('topics of the case are not a list of strings');
        return name;
      });
    });
    const outcome = failureOf(() => {
      let result = Result.redirect('/');
      for (const [name, value] of flashes) result = result.flash(name, value);
      for (const names of topics) result = result.changed(...names);
      return result;
    });
    reader.compare('flashValues', outcome.result?.flashValues ?? null);
    reader.compare('changedTopics', outcome.result === null ? null : [...outcome.result.changedTopics]);
    reader.compare('raises', outcome.raises);
  },
  // Calls `flash` or `changed` with the decoded argument as a JavaScript caller may, and records the failure
  // with which it fails, or null (HY-25.6).
  types(reader: CaseReader): void {
    const call = text(reader, 'call');
    if (call !== 'flash' && call !== 'changed') throw new Error(`the call ${call} of the case is unknown`);
    const argument = decoded(text(reader, 'argument'));
    const result = Result.redirect('/');
    const outcome = failureOf(() => {
      if (call === 'flash') {
        // @ts-expect-error -- a JavaScript caller passes a name that is not a string
        return result.flash(argument, null);
      }
      // @ts-expect-error -- a JavaScript caller passes a topic that is not a string
      return result.changed(argument);
    });
    reader.compare('raises', outcome.raises);
  },
  // Makes the stop of the kind, or records the failure with which it fails (HY-27, HY-50).
  stop(reader: CaseReader): void {
    const kind = text(reader, 'kind');
    if (!['NotFound', 'Forbidden', 'BadRequest', 'Redirect'].includes(kind)) throw new Error(`the stop ${kind} of the case is unknown`);
    const redirect = reader.has('redirect') ? text(reader, 'redirect') : null;
    const outside = reader.has('outside') ? text(reader, 'outside') : null;
    const page = kind === 'Redirect' && redirect === null && outside === null ? integer(reader, 'page') : 0;
    const outcome = failureOf((): Error => {
      if (kind === 'NotFound') return new NotFound();
      if (kind === 'Forbidden') return new Forbidden();
      if (kind === 'BadRequest') return new BadRequest();
      if (redirect !== null) return new Redirect(Result.redirect(redirect));
      if (outside !== null) return new Redirect(Result.outside(outside));
      return new Redirect(Result.page(page, new Map()));
    });
    reader.compare('message', outcome.result?.message ?? null);
    reader.compare('raises', outcome.raises);
    if (reader.has('location') && outcome.result instanceof Redirect) {
      const stopped: Redirect = outcome.result;
      reader.compare('location', stopped.result.location);
    }
  },
};
