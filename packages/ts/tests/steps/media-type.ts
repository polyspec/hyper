// The steps of contracts/media-type.json (HY-119, HY-122): the parameters of a media type and the tag of a body.
import { MediaType } from '../../src/representation/media-type.js';
import type { CaseReader } from '../case-reader.js';
import { failureOf, parsed } from '../case-rules.js';
import { listOf, textOf } from '../inputs.js';

// Returns the map of the pairs of a name and a value of the case, in their order.
function parametersOf(value: unknown): Map<string, string> {
  return new Map(
    listOf(value, 'the case field parameters').map((pair): [string, string] => {
      const [name, item] = listOf(pair, 'a parameter of the case');
      return [textOf(name, 'the name of a parameter'), textOf(item, 'the value of a parameter')];
    }),
  );
}

export const steps = {
  // Makes the media type with the parameters and, when the case holds it, the content type, and compares what
  // parameters() returns and the tag of the body or the failure with which the tag fails (HY-122.13).
  values(reader: CaseReader): void {
    const parameters = parametersOf(reader.input('parameters'));
    const media = reader.has('contentType') ? new MediaType(parameters, textOf(reader.input('contentType'), 'the case field contentType')) : new MediaType(parameters);
    reader.compare('read', media.parameters());
    if (!reader.has('body')) return;
    const body = parsed(textOf(reader.input('body'), 'the case field body'));
    const outcome = failureOf(() => media.etag(body));
    reader.compare('etag', outcome.result);
    reader.compare('raises', outcome.raises);
  },
};
