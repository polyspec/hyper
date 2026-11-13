// One declared representation of a route (HY-118): its type as the manifest writes it, its lower-case media type, its
// required parameters, each a lower-case name with its served values, in declared order, its methods and its vary names.

/** @internal */
export class RepresentationEntry {
  readonly type: string;
  readonly media: string;
  readonly parameters: readonly (readonly [string, readonly string[]])[];
  readonly methods: readonly string[];
  readonly vary: readonly string[];

  constructor(type: string, media: string, parameters: readonly (readonly [string, readonly string[]])[], methods: readonly string[], vary: readonly string[]) {
    this.type = type;
    this.media = media;
    this.parameters = parameters;
    this.methods = methods;
    this.vary = vary;
  }
}
