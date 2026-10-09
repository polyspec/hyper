import { parseJson, type MapValue, type Value } from '@polyspec/template/render';

// The storage of a kept path (HY-37).
export type KeepKind = 'server' | 'cookie' | 'localStorage' | 'sessionStorage';
export const KEEP_KINDS: readonly KeepKind[] = ['server', 'cookie', 'localStorage', 'sessionStorage'];

// Replaces values at kept paths when the path exists and the kept value conforms to its value (HY-38). The PHP
// implementation follows the same rules; both pass conformance/keep.json.
export function applyKept(data: MapValue, kept: readonly (readonly [string, Value])[]): string[] {
  const applied: string[] = [];
  for (const [path, value] of kept) {
    const keys = path.split('.');
    let container: Value | undefined = data;
    for (const key of keys.slice(0, -1)) container = childOf(container, key);
    const last = keys[keys.length - 1]!;
    const current = childOf(container, last);
    if (current === undefined || !conforms(value, current)) continue;
    if (container instanceof Map) container.set(last, value);
    else (container as Value[])[Number(last)] = value;
    applied.push(path);
  }
  return applied;
}

function childOf(container: Value | undefined, key: string): Value | undefined {
  if (container instanceof Map) return container.get(key);
  if (Array.isArray(container) && /^\d+$/.test(key)) return container[Number(key)];
  return undefined;
}

// Returns true when a kept value has the shape of the data value (HY-38): the same type, the same keys
// of a map with conforming values, and list items that conform to the first data item. An empty map or
// list gives no shape.
export function conforms(value: Value, current: Value): boolean {
  if (current instanceof Map) {
    if (!(value instanceof Map)) return false;
    if (current.size === 0) return true;
    if (value.size !== current.size) return false;
    for (const [key, item] of current) {
      const kept = value.get(key);
      if (kept === undefined || !conforms(kept, item)) return false;
    }
    return true;
  }
  if (Array.isArray(current)) {
    if (!Array.isArray(value)) return false;
    return current.length === 0 || value.every((item) => conforms(item, current[0]!));
  }
  return kindOf(value) === kindOf(current);
}

function kindOf(value: Value): string {
  if (value === null) return 'null';
  if (value instanceof Map) return 'map';
  if (Array.isArray(value)) return 'list';
  return typeof value === 'object' ? 'string' : typeof value;
}

// Returns the JSON text of a value with map keys in their order.
export function valueToJson(value: Value): string {
  if (value instanceof Map) return `{${[...value].map(([key, item]) => `${JSON.stringify(key)}:${valueToJson(item)}`).join(',')}}`;
  if (Array.isArray(value)) return `[${value.map(valueToJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return JSON.stringify(String(value));
  return JSON.stringify(value);
}

// Reads and writes kept values as JSON text and sends server values (HY-37, HY-39).
export interface KeepStorage {
  read(kind: 'localStorage' | 'sessionStorage', region: string, path: string): string | null;
  write(kind: Exclude<KeepKind, 'server'>, region: string, path: string, json: string): void;
  send(url: string, form: Record<string, string>): Promise<boolean>;
}

const YEAR = 365 * 24 * 60 * 60;

// Returns the name of the kept cookie: on HTTPS the __Host- prefix makes browsers accept the cookie only
// from this host with Secure and Path=/, so a sibling subdomain cannot set it (HY-39).
export function keepCookieName(https: boolean): string {
  return https ? '__Host-hy-keep' : 'hy-keep';
}

// The storage of a browser document: Web Storage, the hy-keep cookie and a background request.
export function browserStorage(): KeepStorage {
  const store = (kind: 'localStorage' | 'sessionStorage'): Storage => (kind === 'localStorage' ? window.localStorage : window.sessionStorage);
  const https = window.location.protocol === 'https:';
  const cookie = keepCookieName(https);
  const readCookie = (): MapValue => {
    const entry = document.cookie.split('; ').find((part) => part.startsWith(`${cookie}=`));
    try {
      const value = entry === undefined ? null : parseJson(decodeURIComponent(entry.slice(cookie.length + 1)));
      return value instanceof Map ? value : new Map();
    } catch {
      return new Map();
    }
  };
  return {
    read: (kind, region, path) => store(kind).getItem(`hy-keep:${region}:${path}`),
    write: (kind, region, path, json) => {
      if (kind !== 'cookie') {
        store(kind).setItem(`hy-keep:${region}:${path}`, json);
        return;
      }
      const all = readCookie();
      const values = all.get(region);
      const regionValues: MapValue = values instanceof Map ? values : new Map();
      regionValues.set(path, parseJson(json));
      all.set(region, regionValues);
      document.cookie = `${cookie}=${encodeURIComponent(valueToJson(all))}; Path=/; SameSite=Lax; Max-Age=${YEAR}${https ? '; Secure' : ''}`;
    },
    send: (url, form) =>
      fetch(url, { method: 'POST', body: new URLSearchParams(form), credentials: 'same-origin', keepalive: true })
        .then((response) => response.status === 204, () => false),
  };
}
