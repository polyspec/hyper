// Kept values that the server reads from the session and the hy-keep cookie (HY-17, HY-37 to HY-39).
import { applyKept, copyValue, keptPaths, type Application } from '@polyspec/hyper-client';
import { decodeJson, inDataModel, JsonDecodeError, type DecodedValue } from './json.js';
import type { Request } from './request.js';
import type { Session } from './session.js';
import type { MapValue } from './values.js';

// Returns the conforming `server` and `cookie` kept values of the regions, by region and path (HY-17, HY-38).
export function keptValues(request: Request, session: Session, data: Map<string, MapValue>, application: Application, https: boolean): MapValue {
  // On HTTPS only the host-only cookie counts, which another host cannot set (HY-39).
  const cookie = decodeCookie(request.cookie(https || request.https ? '__Host-hy-keep' : 'hy-keep'));
  const kept: MapValue = new Map();
  for (const [name, regionData] of data) {
    const stored = session.kept(name);
    const cookieValues = cookie instanceof Map ? cookie.get(name) : undefined;
    const pairs: [string, DecodedValue][] = [];
    for (const [path, kind] of Object.entries(keptPaths(application.manifest, name))) {
      const source = (kind === 'server' ? stored : kind === 'cookie' && cookieValues instanceof Map ? cookieValues : new Map()) as Map<string, DecodedValue>;
      if (source.has(path)) pairs.push([path, source.get(path)!]);
    }
    const selected = selectKept(regionData, pairs);
    if (selected.size > 0) kept.set(name, selected);
  }
  return kept;
}

// Returns the kept values that conform to the data, by path, applying each one before the next (HY-38).
export function selectKept(data: MapValue, pairs: [string, DecodedValue][]): MapValue {
  const applied = copyValue(data) as MapValue;
  const selected: MapValue = new Map();
  for (const [path, value] of pairs) {
    if (inDataModel(value) && applyKept(applied, [[path, value]]).length > 0) selected.set(path, value);
  }
  return selected;
}

// Returns the decoded hy-keep cookie, or null for a cookie that is absent or not JSON (HY-42).
function decodeCookie(text: string | null): DecodedValue {
  if (text === null) return null;
  try {
    return decodeJson(text);
  } catch (error) {
    if (error instanceof JsonDecodeError) return null;
    throw error;
  }
}
