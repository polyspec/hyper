// The case runner of the build (HYR-7): the build id of HY-125 with the builds of contracts/context.json (the order of
// the paths, the stream of the hashed bytes, the digest and the excluded outputs) and the template check of HY-48.3
// with the templateChecks of contracts/manifest.json, and the reserved template of HY-31.3 with the dataTemplate of
// contracts/build.json. The command tool takes each of these rules from the core of hyper through
// @polyspec/hyper/build, which this runner calls, so the cases check the rules that the build applies. The expected
// values are read from the contract files and never computed here.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFileText, buildId, buildPaths, buildStream, reservedTemplate, templateProblems } from '@polyspec/hyper/build';
import { CaseReader } from '../../packages/ts/tests/case-reader.ts';
import { failedCases, writeResults } from '../../packages/ts/tests/case-run.ts';
import { mapsOf, plain, textMapOf, textOf } from '../../packages/ts/tests/inputs.ts';

type BuildFile = { path: string; bytes: Buffer };

// The files of a case as the build passes them: the path and the bytes of the UTF-8 content of the case.
function filesOf(value: unknown): BuildFile[] {
  return mapsOf(value, 'files').map((file) => ({ path: textOf(file.get('path'), 'path'), bytes: Buffer.from(textOf(file.get('content'), 'content'), 'utf8') }));
}

// The problems of the template check for the manifest and the templates of a case.
function problemsOf(reader: CaseReader): unknown {
  const templates = new Map(textMapOf(reader.input('templates'), 'templates'));
  return templateProblems(Buffer.from(JSON.stringify(plain(reader.input('manifest')))), templates);
}

// The build id of the files of a case.
function compareBuild(reader: CaseReader): void {
  const files = filesOf(reader.input('files'));
  reader.compare('sortedPaths', buildPaths(files));
  if (reader.has('stream')) reader.compare('stream', buildStream(files));
  const id = buildId(files);
  reader.compare('build', id);
  reader.compare('excluded', [{ path: 'build.json', content: buildFileText(id) }]);
}

const lines: string[] = [];

test('cases', () => {
  const results = process.env.RECIPE_RESULTS;
  if (results === undefined) throw new Error('RECIPE_RESULTS is not set: the case runner writes its results to the file that it names');
  for (const reader of CaseReader.cases('build')) {
    try {
      if (reader.section() === 'manifest.json:templateChecks') {
        reader.compare('problems', problemsOf(reader));
      } else if (reader.section() === 'build.json:dataTemplate') {
        const reserved = reservedTemplate();
        reader.compare('name', reserved.name);
        reader.compare('source', reserved.source);
      } else {
        compareBuild(reader);
      }
    } catch (error) {
      reader.fail(error instanceof Error ? error.message : String(error));
    }
    lines.push(reader.line());
  }
  const failed = writeResults(results, lines);
  if (failed.length > 0) throw failedCases(failed, lines.length, results);
});

test('a duplicate path fails with the kind invalid_build and names the path (HY-125.17)', () => {
  const bytes = Buffer.from('x', 'utf8');
  assert.throws(() => buildId([{ path: 'public/assets/hyper-a1.js', bytes }, { path: 'public/assets/hyper-a1.js', bytes }]), (error: unknown) => {
    assert.ok(error instanceof Error && 'kind' in error, String(error));
    assert.equal(error.kind, 'invalid_build');
    assert.match(String(error), /public\/assets\/hyper-a1\.js/);
    return true;
  });
});

test('the command tool holds no copy of a rule of the core (H35.34-2, H35.34-3, H35.34-4)', async () => {
  const { readdirSync } = await import('node:fs');
  const files = readdirSync('packages/cli/lib');
  for (const copy of ['build-id.mjs', 'shell.mjs', 'template-rules.mjs']) assert.ok(!files.includes(copy), `packages/cli/lib/${copy} is a copy of a rule of the core`);
});
