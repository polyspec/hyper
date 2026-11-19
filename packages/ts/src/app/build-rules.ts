// The rules of the Rust core that a build of an application applies, which the entry `@polyspec/hyper/build` gives
// to the command tool `@polyspec/hyper-cli`, so that a build and the servers apply one implementation of each rule. A failure reaches the caller as the binding raises it, an error of the class of its category with `kind` and
// `status` (HY-133.2).
import { rules } from './core-rules.js';

/** One file that a build writes: its path with the prefix of its place (HY-125.17) and its bytes. */
export interface BuildOutput {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** Returns the build id of the files `outputs` that one build writes (HY-125.15 to HY-125.17, HY-125.25). */
export function buildId(outputs: Iterable<BuildOutput>): string {
  return rules().buildId(outputs);
}

/** Returns the paths of `outputs` that the build id hashes, in the order in which it hashes them (HY-125.3). */
export function buildPaths(outputs: Iterable<BuildOutput>): readonly string[] {
  return rules().buildPaths(outputs);
}

/** Returns the hexadecimal text of the bytes that the build id hashes for `outputs` (HY-125.3). */
export function buildStream(outputs: Iterable<BuildOutput>): string {
  return rules().buildStream(outputs);
}

/**
 * Returns the text of the static shell (HYC-16.23) for the data base path `api`, the build id `build` and the client
 * entry of the URL `url` and the code `code`; an entry that contains `</script` fails with the kind `invalid_build`.
 */
export function shellFile(api: string, build: string, url: string, code: string): string {
  return rules().buildShellFile(api, build, url, code);
}

/** Returns the text of `build.json` with the build id `id` (HY-125.23); an id of another form fails (HY-125.19). */
export function buildFileText(id: string): string {
  return rules().buildFileText(id);
}

/**
 * Returns the problems of the templates `templates`, a map from the template names to their sources, for the manifest
 * whose JSON text is `manifest` (HY-48.3); a manifest that breaks HY-2 fails with the error of the manifest check.
 */
export function templateProblems(manifest: Uint8Array, templates: ReadonlyMap<string, string>): readonly string[] {
  return rules().Templates.problems(manifest, templates);
}

/** Returns the name and the source of the reserved template of the embedded data (HY-31.3). */
export function reservedTemplate(): { readonly name: string; readonly source: string } {
  return rules().Templates.reserved();
}

/**
 * Returns the text of `reads.json` of a server program (HY-73.34): the read paths of every route of the manifest, whose
 * JSON text is `manifest`, with the templates `templates`, a map from the template names to their sources. The text is
 * `{"routes":<routes>}` and a line feed, where the JSON writer of the core writes the routes in the order of HY-73.32.
 */
export function readsFile(manifest: Uint8Array, templates: ReadonlyMap<string, string>): string {
  const core = rules();
  return `{"routes":${core.jsonCodecEncode(core.Templates.routeReads(manifest, templates))}}\n`;
}
