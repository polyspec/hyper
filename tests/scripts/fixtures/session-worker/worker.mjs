// One Node server process over one session (tests/scripts/session-workers.mts): the arguments are the session directory,
// the identifier, and `count <requests> <name>`, `read <names as JSON>`, `write <values as JSON>`, or `stale`, which writes
// after a line of its input, or `renew`. With HYPER_SESSION_REDIS, the port of a Redis server, it keeps the session there,
// HYPER_SESSION_RETRIES is how often it tries a lock and HYPER_SESSION_EXPIRE when a lock expires. HYPER_SESSION_SENTINEL
// names the ports of Sentinels instead, and HYPER_SESSION_TLS_CA, HYPER_SESSION_USER and HYPER_SESSION_PASSWORD secure the connection;
// HYPER_SESSION_CLUSTER names the ports of nodes of a Redis Cluster.
import { once } from 'node:events';
// The Redis store of the session-store library keeps its own connections; HYPER_SESSION_TLS_CA turns TLS on and is the
// file of the authorities that the store trusts.
import { FileSessions, RedisSessions } from '@polyspec/hyper';

const [directory, id, command, first, second] = process.argv.slice(2);
const port = process.env.HYPER_SESSION_REDIS;
const sentinels = process.env.HYPER_SESSION_SENTINEL;
const nodes = process.env.HYPER_SESSION_CLUSTER;
// The file of the authority of the test, which the store trusts alone (SR-6.7 of session-store), or null.
const authorities = process.env.HYPER_SESSION_TLS_CA ?? null;
const tls = authorities !== null;
const user = process.env.HYPER_SESSION_USER ?? null;
const password = process.env.HYPER_SESSION_PASSWORD ?? null;
// The URL of a node: the scheme `rediss` for TLS and the ACL user and its password in its user information.
const url = (item) => {
  const credentials = user === null && password === null ? '' : `${encodeURIComponent(user ?? '')}:${encodeURIComponent(password ?? '')}@`;
  return `${tls ? 'rediss' : 'redis'}://${credentials}127.0.0.1:${item}`;
};
const setting = nodes !== undefined
  ? { kind: 'cluster', urls: nodes.split(',').map(url), authorities }
  : sentinels !== undefined
    ? { kind: 'sentinel', urls: sentinels.split(',').map((item) => `redis://127.0.0.1:${item}`), service: 'hyper', tls, user, password, authorities }
    : port !== undefined
      ? { kind: 'server', url: url(port), authorities }
      : null;
const sessions = setting === null
  ? await FileSessions.inDirectory({ directory })
  : new RedisSessions({
      setting,
      lockRetries: Number(process.env.HYPER_SESSION_RETRIES ?? 1_000_000),
      lockWait: 2000,
      lockExpire: Number(process.env.HYPER_SESSION_EXPIRE ?? 30),
    });

// Returns the value as JSON of the test: a map as {"map": [[key, value], ...]}, whatever server wrote it.
const canonical = (value) => {
  if (value instanceof Map) return { map: [...value].map(([key, item]) => [key, canonical(item)]) };
  if (Array.isArray(value)) return value.map(canonical);
  return value === undefined ? null : value;
};

// The values of a JSON object as Maps in the order of the text, which an object of JavaScript loses for integer-like keys.
const mapped = (text) => {
  const restore = (value) => {
    if (Array.isArray(value)) return value.map(restore);
    if (value === null || typeof value !== 'object') return value;
    return new Map(Object.entries(value).map(([key, item]) => [key.slice(1), restore(item)]));
  };
  return restore(JSON.parse(text.replace(/"([^"\\]*)":/g, '"_$1":')));
};

const session = async (use) => {
  const store = await sessions.open(id);
  try {
    return await use(store);
  } finally {
    await store.close();
  }
};

if (command === 'count') {
  for (let index = 0; index < Number(first); index++) {
    await session((store) => {
      store.set('n', store.get('n') + 1);
      store.set(second, (store.get(second) ?? 0) + 1);
    });
  }
} else if (command === 'stale') {
  await session(async (store) => {
    store.set('stale', 1);
    process.stdout.write('held\n');
    process.stdin.resume();
    await once(process.stdin, 'data');
    process.stdin.pause();
  });
} else if (command === 'renew') {
  let renewed;
  await session((store) => {
    store.renew();
    renewed = store;
  });
  process.stdout.write(`${String(renewed.created())}\n`);
} else if (command === 'read') {
  process.stdout.write(JSON.stringify(await session((store) => JSON.parse(first).map((name) => canonical(store.get(name))))));
} else {
  await session((store) => {
    for (const [name, value] of mapped(first)) store.set(name, value);
  });
}
