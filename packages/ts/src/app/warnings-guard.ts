// Turns a warning that is emitted while a request is answered into an error (HY-74).
import { AsyncLocalStorage } from 'node:async_hooks';

// Set for the asynchronous work of one request.
const answering = new AsyncLocalStorage<true>();
let installed = false;

/** @internal */
export class WarningsGuard {
  // Runs `work` with the warnings of the request as errors. The first run replaces process.emitWarning once by a
  // function that throws the warning as an error at the call while a request is answered, and emits it as before at
  // any other time, so the previous handling is in force outside of the requests.
  static run<T>(work: () => Promise<T>): Promise<T> {
    if (!installed) {
      installed = true;
      const emit = process.emitWarning.bind(process);
      process.emitWarning = (warning: string | Error, ...rest: [unknown?, unknown?, unknown?]): void => {
        if (answering.getStore() === true) throw warning instanceof Error ? warning : new Error(warning);
        Reflect.apply(emit, undefined, [warning, ...rest]);
      };
    }
    return answering.run(true, work);
  }

  // Runs `work` of the server's own code with the handling of the time outside of the requests, also when a request
  // called it: a warning that the runtime emits for a module that the server itself loads on its first use is no
  // warning of the answer, so it is emitted as before and does not fail the request (HY-74.9). The work is
  // synchronous, so nothing of the application runs in it. Its one caller is the load of node:ffi of the file
  // sessions (HY-74.10), which packages/ts/tests/ffi-load.test.ts checks.
  static outside<T>(work: () => T): T {
    return answering.exit(work);
  }
}
