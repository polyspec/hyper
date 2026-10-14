// Computes the read paths of one case of contracts/reads.json in its own process and writes them as JSON, so that
// tests/reads.test.ts stops an analysis that does not finish within its time limit (HY-73).
import { parse, type Template } from '@polyspec/template';
import { resolvePath } from '@polyspec/template/render';

// Node runs the sources with type stripping.
import { templateReads } from '../src/reads.ts';
import { defined, isRecord, isStringRecord } from './values.ts';

const item: unknown = JSON.parse(process.argv[2] ?? '');
if (!isRecord(item) || !isStringRecord(item.templates) || typeof item.template !== 'string') throw new Error('the case has no templates or template');
const parsed = new Map(Object.entries(item.templates).map(([name, source]) => [name, parse(source, name)]));
process.stdout.write(JSON.stringify(templateReads((name): Template => defined(parsed.get(name), `the template ${name}`), resolvePath, item.template)));
