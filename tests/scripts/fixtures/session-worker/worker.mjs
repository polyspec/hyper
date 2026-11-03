// One Node server process over one session (tests/scripts/session-workers.mts): the arguments are the session directory,
// the identifier, and `count <requests> <name>`, `read <names as JSON>`, `write <values as JSON>`, or `stale`, which writes
// after a line of its input, or `renew`. With HYPER_SESSION_REDIS, the port of a Redis server, it keeps the session there,
// and HYPER_SESSION_RETRIES is how often it tries a lock.
import { once } from 'node:events';
import { createClient, RESP_TYPES } from 'redis';
import { FileSessions, RedisSessions } from '@polyspec/hyper-server';

const [directory, id, command, first, second] = process.argv.slice(2);
const port = process.env.HYPER_SESSION_REDIS;
const client = port === undefined ? null : await createClient({ socket: { port: Number(port) } }).connect();
const sessions = client === null
  ? new FileSessions({ directory })
  : new RedisSessions({
      command: (words) => client.withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer }).sendCommand(words.map((word) => Buffer.from(word))),
      lockRetries: Number(process.env.HYPER_SESSION_RETRIES ?? 1_000_000),
      lockWait: 2,
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
  process.stdout.write(`${renewed.created}\n`);
} else if (command === 'read') {
  process.stdout.write(JSON.stringify(await session((store) => JSON.parse(first).map((name) => canonical(store.get(name))))));
} else {
  await session((store) => {
    for (const [name, value] of mapped(first)) store.set(name, value);
  });
}
await client?.quit();
