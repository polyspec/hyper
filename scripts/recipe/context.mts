// What every check of the recipe check reads: the spec, the tree, the protocol (contracts/protocol.json), the readers'
// sources of the tree and a way to run the reader of one language over another directory (the case readers, HYR-8).

import type { Protocol } from './protocol.mts';
import type { Lang, Sources, Spec } from './types.mts';

export type Ctx = {
  spec: Spec;
  root: string;
  protocol: Protocol;
  sources: Record<Lang, Sources>;
  readDir: (lang: Lang, dir: string) => Sources;
  add: (code: string, message: string) => void;
};
