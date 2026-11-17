// The entry `@polyspec/hyper/build` of the package: the rules of the Rust core that a build of an application applies,
// which the command tool `@polyspec/hyper-cli` calls, so that a build and the servers apply one implementation of each
// rule. A failure reaches the caller as the binding raises it, an error of the class of its category with `kind` and
// `status` (HY-132.2).
import { rules } from './app/core-rules.js';

/**
 * Returns the text of `reads.json` of a server program (HY-73.34): the read paths of every route of the manifest, whose
 * JSON text is `manifest`, with the templates `templates`, a map from the template names to their sources. The text is
 * `{"routes":<routes>}` and a line feed, where the JSON writer of the core writes the routes in the order of HY-73.32.
 */
export function readsFile(manifest: Uint8Array, templates: ReadonlyMap<string, string>): string {
  const core = rules();
  return `{"routes":${core.jsonCodecEncode(core.Templates.routeReads(manifest, templates))}}\n`;
}
