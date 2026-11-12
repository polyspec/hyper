// The media type of a representation request that the server selected, as a representation handler receives it (HY-106,
// HY-119): the values of the parameters that the entry requires, in the order of the manifest, and the tag of a body of
// the type (HY-122.11).
import { JsonCodec } from '../data/json-codec.js';
import { RepresentationResponse } from './representation-response.js';
import { toValue } from '../data/values.js';
import { ArgumentCountError } from '../app/argument-count-error.js';

export class MediaType {
  private readonly values: ReadonlyMap<string, string>;
  private readonly contentType: string;

  constructor(parameters: ReadonlyMap<string, string>, contentType = '') {
    ArgumentCountError.between(arguments.length, 1, 2);
    this.values = new Map(parameters);
    this.contentType = contentType;
  }

  // Returns the served value of each required parameter, by its lower-case name, in declared order (HY-119).
  parameters(): ReadonlyMap<string, string> {
    ArgumentCountError.between(arguments.length, 0, 0);
    return new Map(this.values);
  }

  // Returns the strong tag that a 200 response with this body of the selected type has, so that a handler compares
  // If-Match with it (HY-122.11).
  etag(body: unknown): string {
    ArgumentCountError.between(arguments.length, 1, 1);
    return RepresentationResponse.etag(this.contentType, JsonCodec.encode(toValue(body)));
  }
}
