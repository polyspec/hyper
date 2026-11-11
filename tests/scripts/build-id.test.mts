// Tests the build id of HY-125 with the builds of contracts/context.json (HYR-7): the order of the paths, the stream of the
// hashed bytes, the digest and the excluded outputs. The expected values are read from the contract file and never computed here.
import assert from 'node:assert/strict';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { test } from 'node:test';
import { buildId, buildStream, sortFiles } from '../../packages/build/lib/build-id.mjs';
import { CaseReader } from '../../packages/server/ts/tests/case-reader.ts';

type BuildFile = { path: string; bytes: Buffer };

// The files of a case as the build passes them: the path and the bytes of the UTF-8 content of the case.
function filesOf(value: unknown): BuildFile[] {
  return (value as Map<string, string>[]).map((file) => ({ path: file.get('path') as string, bytes: Buffer.from(file.get('content') as string, 'utf8') }));
}

const lines: string[] = [];

test('cases', () => {
  const results = process.env.RECIPE_RESULTS;
  if (results === undefined) throw new Error('RECIPE_RESULTS is not set: the case runner writes its results to the file that it names');
  for (const reader of CaseReader.cases('build')) {
    try {
      const files = filesOf(reader.input('files'));
      reader.compare('sortedPaths', sortFiles(files).map((file) => file.path));
      if (reader.has('stream')) reader.compare('stream', buildStream(files).toString('hex'));
      reader.compare('build', buildId(files));
      reader.compare('excluded', [{ path: 'build.json', content: JSON.stringify({ build: buildId(files) }) }]);
    } catch (error) {
      reader.fail(error instanceof Error ? error.message : String(error));
    }
    lines.push(reader.line());
  }
  const temporary = `${results}.tmp`;
  mkdirSync(dirname(results), { recursive: true });
  writeFileSync(temporary, `${lines.join('\n')}\n`);
  renameSync(temporary, results);
  const failed = lines.filter((line) => line.includes(' FAIL ')).length;
  assert.equal(failed, 0, `${failed} of ${lines.length} cases fail; see ${results}`);
});

test('a duplicate path fails and names the path (HY-125)', () => {
  const bytes = Buffer.from('x', 'utf8');
  assert.throws(() => buildId([{ path: 'assets/hyper-a1.js', bytes }, { path: 'assets/hyper-a1.js', bytes }]), /assets\/hyper-a1\.js/);
});
