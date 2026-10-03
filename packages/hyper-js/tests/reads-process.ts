// Computes the read paths of one case of conformance/reads.json in its own process and writes them as JSON, so that
// tests/reads.test.ts stops an analysis that does not finish within its time limit (HY-73).
import { parse, type Template } from '@polyspec/template';
import { resolvePath } from '@polyspec/template/render';

// Node runs the source with type stripping, as scripts/build-server.mjs does (HY-68).
const { templateReads } = (await import(new URL('../src/reads.ts', import.meta.url).href)) as typeof import('../src/reads.js');
const item = JSON.parse(process.argv[2]!) as { templates: Record<string, string>; template: string };
const parsed = new Map(Object.entries(item.templates).map(([name, source]) => [name, parse(source, name)]));
process.stdout.write(JSON.stringify(templateReads((name): Template => parsed.get(name)!, resolvePath, item.template)));
