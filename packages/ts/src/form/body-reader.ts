// The body of a request as its host read it through the core.
import type { CoreRequestBody } from '../app/core-rules.js';

/**
 * The body of a request as its host read it through the core (HY-131, F-9, F-25): the body of the core and the kind of
 * its first failure, or null when it read to its end.
 *
 * @internal
 */
export interface BodyReader {
  readonly core: CoreRequestBody;
  readonly failure: string | null;
}
