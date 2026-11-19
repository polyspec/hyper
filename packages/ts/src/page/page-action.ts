import type { Data } from '../data/values.js';

// The action of a request that answers its route page: the status and the data of its result, or null for an action
// that let `revision_changed` escape (HY-107.9), and the masked value of the token that the request held before the
// action, which differs from that of the request of the page after a renewal (HY-72.3).
/** @internal */
export interface PageAction {
  readonly result: { readonly status: number; readonly data: Data } | null;
  readonly masked: string;
}
