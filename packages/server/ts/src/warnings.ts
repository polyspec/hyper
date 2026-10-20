// Turns a warning that is emitted while a request is answered into an error (HY-74).
import { AsyncLocalStorage } from 'node:async_hooks';

// Set for the asynchronous work of one request.
const answering = new AsyncLocalStorage<true>();
let installed = false;

// Replaces process.emitWarning once by a function that throws the warning as an error at the call while a request is
// answered, and emits it as before at any other time, so the previous handling is in force outside of the requests.
function install(): void {
  if (installed) return;
  installed = true;
  const emit = process.emitWarning;
  process.emitWarning = (warning: string | Error, ...rest: [unknown?, unknown?, unknown?]): void => {
    if (answering.getStore() === true) throw warning instanceof Error ? warning : new Error(warning);
    Reflect.apply(emit, process, [warning, ...rest]);
  };
}

// Runs `work` with the warnings of the request as errors (HY-74).
export function warningsAsErrors<T>(work: () => Promise<T>): Promise<T> {
  install();
  return answering.run(true, work);
}
