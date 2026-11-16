// The AST of a template source for the renderer of @polyspec/template/render: the native parser of the package root
// gives its own record of the AST, which the renderer does not read, so the tests decode the canonical JSON of that
// AST into the Template of the renderer.
import { encodeTemplate, parse } from '@polyspec/template';
import { decodeTemplate, type Template } from '@polyspec/template/render';

/** Parses a template source and returns its AST as the renderer reads it. */
export function parseTemplate(source: string, name: string): Template {
  return decodeTemplate(encodeTemplate(parse(source, name)));
}
