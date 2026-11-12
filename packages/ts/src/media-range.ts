// One media range of an Accept value (RFC 9110, section 12.5.1): its type and subtype in lower case (`*` for a
// wildcard), its parameters before `q` as [name, value] pairs in their order with the name in lower case, and its weight
// in thousandths, 0 to 1000 (HY-116).

/** @internal */
export class MediaRange {
  readonly type: string;
  readonly subtype: string;
  readonly parameters: readonly [string, string][];
  readonly weight: number;

  constructor(type: string, subtype: string, parameters: readonly [string, string][], weight: number) {
    this.type = type;
    this.subtype = subtype;
    this.parameters = parameters;
    this.weight = weight;
  }
}
