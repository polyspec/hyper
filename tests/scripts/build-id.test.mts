// The case runner of the build (HYR-7): the build id of HY-125 with the builds of contracts/context.json (the order of
// the paths, the stream of the hashed bytes, the digest and the excluded outputs) and the template check of HY-48.3
// with the templateChecks of contracts/manifest.json, and the reserved template of HY-31.3 with the dataTemplate of
// contracts/build.json, which the build takes from the browser package. The expected values are read from the contract files and never
// computed here.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { parse, resolvePath } from '@polyspec/template';
import { buildId, buildStream, sortFiles } from '../../packages/cli/lib/build-id.mjs';
import dataTemplate from '../../packages/client/data-template.json' with { type: 'json' };
import { templateProblems } from '../../packages/cli/lib/template-rules.mjs';
import { CaseReader } from '../../packages/ts/tests/case-reader.ts';
import { writeResults } from '../../packages/ts/tests/case-run.ts';
import { mapsOf, plain, textMapOf, textOf } from '../../packages/ts/tests/inputs.ts';

type BuildFile = { path: string; bytes: Buffer };

// The files of a case as the build passes them: the path and the bytes of the UTF-8 content of the case.
function filesOf(value: unknown): BuildFile[] {
  return mapsOf(value, 'files').map((file) => ({ path: textOf(file.get('path'), 'path'), bytes: Buffer.from(textOf(file.get('content'), 'content'), 'utf8') }));
}

// The problems of the template check for the templates of a case, which the check reads from a directory.
function problemsOf(reader: CaseReader): unknown {
  const directory = mkdtempSync(join(tmpdir(), 'hyper-cli-templates-'));
  try {
    for (const [name, source] of textMapOf(reader.input('templates'), 'templates')) {
      mkdirSync(dirname(join(directory, name)), { recursive: true });
      writeFileSync(join(directory, name), source);
    }
    return templateProblems({ manifest: plain(reader.input('manifest')), templatesDir: directory, parse, resolvePath }).problems;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

// The build id of the files of a case.
function compareBuild(reader: CaseReader): void {
  const files = filesOf(reader.input('files'));
  reader.compare('sortedPaths', sortFiles(files).map((file) => file.path));
  if (reader.has('stream')) reader.compare('stream', buildStream(files).toString('hex'));
  reader.compare('build', buildId(files));
  reader.compare('excluded', [{ path: 'build.json', content: JSON.stringify({ build: buildId(files) }) }]);
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
        reader.compare('name', dataTemplate.name);
        reader.compare('source', dataTemplate.source);
      } else {
        compareBuild(reader);
      }
    } catch (error) {
      reader.fail(error instanceof Error ? error.message : String(error));
    }
    lines.push(reader.line());
  }
  const failed = writeResults(results, lines);
  assert.equal(failed, 0, `${failed} of ${lines.length} cases fail; see ${results}`);
});

test('a duplicate path fails and names the path (HY-125)', () => {
  const bytes = Buffer.from('x', 'utf8');
  assert.throws(() => buildId([{ path: 'assets/hyper-a1.js', bytes }, { path: 'assets/hyper-a1.js', bytes }]), /assets\/hyper-a1\.js/);
});
