// The advisory lock of an open file: flock(2), which PHP holds on a session file. Node has no such function of its own,
// so this calls the C library through node:ffi of the Node version that the package requires (HY-104).
import { WarningsGuard } from '../app/warnings-guard.js';

const LOCK_EX = 2;
const LOCK_NB = 4;

// Tells whether a module is node:ffi with the two functions that the lock uses.
function isFfi(module: unknown): module is { dlopen(path: null, definitions: Record<string, { arguments: string[]; return: string }>): { functions: Record<string, ((...values: number[]) => unknown) | undefined> }; getInt32(pointer: unknown, offset: number): number; } {
  return typeof module === 'object' && module !== null && 'dlopen' in module && 'getInt32' in module;
}

// The name of the function that returns the address of errno, and the value of EWOULDBLOCK, by platform.
const PLATFORMS: Partial<Record<NodeJS.Platform, { errno: string; busy: number }>> = {
  darwin: { errno: '__error', busy: 35 },
  linux: { errno: '__errno_location', busy: 11 },
};

/**
 * Returns the function that tries the exclusive lock of a file descriptor: true when it holds the lock, false while
 * another holds it. It fails on a platform without flock and on any other error.
 *
 * @internal
 */
export function exclusiveLock(): (descriptor: number) => boolean {
  const platform = PLATFORMS[process.platform];
  if (platform === undefined) throw new Error(`hyper: file sessions need flock, which the platform ${process.platform} does not name`);
  // The first load of node:ffi in a process emits an ExperimentalWarning. The load is the server's own, and only an
  // application that constructs FileSessions causes it, so it runs outside of the warnings guard of a request (HY-74.9):
  // an application that constructs its first FileSessions while a request is answered gets the warning as at any other
  // time, and the request is answered.
  const ffi: unknown = WarningsGuard.outside(() => process.getBuiltinModule('node:ffi'));
  if (!isFfi(ffi)) throw new Error('hyper: file sessions need node:ffi, which this Node process does not allow');
  const { functions } = ffi.dlopen(null, {
    flock: { arguments: ['int32', 'int32'], return: 'int32' },
    [platform.errno]: { arguments: [], return: 'pointer' },
  });
  const flock = functions.flock;
  const location = functions[platform.errno];
  if (flock === undefined || location === undefined) throw new Error('hyper: the C library names no flock');
  return (descriptor) => {
    if (flock(descriptor, LOCK_EX | LOCK_NB) === 0) return true;
    const code = ffi.getInt32(location(), 0);
    if (code === platform.busy) return false;
    throw new Error(`hyper: flock of a session file failed with errno ${code}`);
  };
}
