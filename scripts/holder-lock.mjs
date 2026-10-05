// The holder lock of a resource that exists once, such as the fixed ports of `make serve-demo`. A lock is a file that
// names its holder: the checkout, the process ID and the start time. The file is written completely under a name of
// its own and then linked to the lock path, which fails when the lock exists, so the lock appears atomically with its
// whole content. One process holds a lock at a time; another process fails with the holder of the lock, and only the
// holder releases it, when it exits. A lock whose holder process has ended is reported and stays until `clear`
// removes it.
//
// Usage: node scripts/holder-lock.mjs clear <lock>
//          removes the lock when its holder process has ended, and fails while the holder runs
import { randomBytes } from 'node:crypto';
import { linkSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Returns the holder that a lock file names, or null when the lock does not exist. */
export function readHolder(lock) {
  let text;
  try {
    text = readFileSync(lock, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const holder = JSON.parse(text);
  if (typeof holder.checkout !== 'string' || !Number.isInteger(holder.pid) || typeof holder.started !== 'string' || typeof holder.token !== 'string') {
    throw new Error(`${lock} does not name a holder: ${text}`);
  }
  return holder;
}

/** Returns whether the process of a holder runs. */
export function holderRuns(holder) {
  try {
    process.kill(holder.pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process runs under another user.
    if (error.code === 'EPERM') return true;
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

/** Describes a holder by its checkout, its process ID and its start time. */
export function describeHolder(holder) {
  return `process ${holder.pid} of the checkout ${holder.checkout}, started at ${holder.started}`;
}

/**
 * Takes the lock for the checkout `checkout` and releases it when this process exits; a caller that handles a signal
 * ends with process.exit. Fails with the holder when another process holds the lock, also when that process has
 * ended.
 */
export function acquire(lock, checkout) {
  const holder = { checkout: resolve(checkout), pid: process.pid, started: new Date().toISOString(), token: randomBytes(16).toString('hex') };
  const pending = `${lock}.${process.pid}.${holder.token}`;
  writeFileSync(pending, `${JSON.stringify(holder)}\n`, { flag: 'wx' });
  try {
    linkSync(pending, lock);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const current = readHolder(lock);
    if (holderRuns(current)) throw new Error(`${lock} is held by ${describeHolder(current)}`);
    throw new Error(`${lock} is held by ${describeHolder(current)}, and that process has ended; remove the lock with \`node scripts/holder-lock.mjs clear ${lock}\` after checking the resource`);
  } finally {
    unlinkSync(pending);
  }
  process.on('exit', () => {
    const current = readHolder(lock);
    if (current === null || current.token !== holder.token) {
      process.stderr.write(`${lock} is no longer held by process ${process.pid}\n`);
      return;
    }
    unlinkSync(lock);
  });
}

/** Removes a lock whose holder process has ended and returns its holder; fails while the holder runs. */
export function clear(lock) {
  const holder = readHolder(lock);
  if (holder === null) throw new Error(`${lock} does not exist`);
  if (holderRuns(holder)) throw new Error(`${lock} is held by ${describeHolder(holder)}, which still runs`);
  unlinkSync(lock);
  return holder;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [action, lock, ...rest] = process.argv.slice(2);
  try {
    if (action !== 'clear' || lock === undefined || rest.length > 0) throw new Error('usage: holder-lock.mjs clear <lock>');
    const holder = clear(lock);
    process.stdout.write(`removed ${lock} of ${describeHolder(holder)}, which has ended\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
