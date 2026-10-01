// Route matching (HY-4 to HY-8). The PHP router implements the same rules; both pass conformance/routes.json.

export interface RouteMatch {
  name: string;
  params: Record<string, string>;
}

type Segment = { literal: string } | { param: string };

interface CompiledRoute {
  name: string;
  segments: Segment[];
}

const LITERAL = /^[A-Za-z0-9._~-]+$/;
const PARAM = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/;
const decoder = new TextDecoder('utf-8', { fatal: true });

export class Router {
  private readonly routes: CompiledRoute[];

  // Compiles route paths; an invalid path fails here (HY-4).
  constructor(routes: readonly { name: string; path: string }[]) {
    this.routes = routes.map((route) => ({ name: route.name, segments: compilePath(route.path) }));
  }

  // Returns the first route that matches a request path, or null (HY-5 to HY-7).
  match(path: string): RouteMatch | null {
    if (!path.startsWith('/')) return null;
    const parts = path === '/' ? [] : path.slice(1).split('/');
    for (const route of this.routes) {
      const params = matchSegments(route.segments, parts);
      if (params !== null) return { name: route.name, params };
    }
    return null;
  }
}

// Removes a base path from a request path; returns null when the path is outside the base path (HY-8).
export function stripBasePath(path: string, basePath: string): string | null {
  if (basePath === '') return path;
  if (path === basePath) return '/';
  return path.startsWith(`${basePath}/`) ? path.slice(basePath.length) : null;
}

function compilePath(path: string): Segment[] {
  if (!path.startsWith('/')) throw new Error(`route path ${JSON.stringify(path)} does not start with /`);
  if (path === '/') return [];
  const names = new Set<string>();
  return path.slice(1).split('/').map((part) => {
    if (LITERAL.test(part)) return { literal: part };
    const param = PARAM.exec(part)?.[1];
    if (param === undefined || names.has(param)) throw new Error(`route path ${JSON.stringify(path)} has an invalid segment ${JSON.stringify(part)}`);
    names.add(param);
    return { param };
  });
}

function matchSegments(segments: Segment[], parts: string[]): Record<string, string> | null {
  if (segments.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!;
    const part = parts[index]!;
    if ('literal' in segment) {
      if (segment.literal !== part) return null;
    } else {
      const value = part === '' ? null : decodeSegment(part);
      if (value === null) return null;
      params[segment.param] = value;
    }
  }
  return params;
}

// Decodes %XX sequences to bytes and the bytes as strict UTF-8; returns null for a malformed segment (HY-6).
function decodeSegment(part: string): string | null {
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (let index = 0; index < part.length; ) {
    if (part[index] === '%') {
      const hex = part.slice(index + 1, index + 3);
      if (!/^[0-9A-Fa-f]{2}$/.test(hex)) return null;
      bytes.push(parseInt(hex, 16));
      index += 3;
    } else {
      const codePoint = part.codePointAt(index)!;
      const character = String.fromCodePoint(codePoint);
      bytes.push(...encoder.encode(character));
      index += character.length;
    }
  }
  try {
    return decoder.decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}
