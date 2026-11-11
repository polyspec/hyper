// Tests the build id of HY-125 with the builds of contracts/context.json: the order of the paths, the stream of the
// hashed bytes and the digest. The expected values are read from the contract file and never computed here.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { buildId, buildStream, sortFiles } from '../../packages/build/lib/build-id.mjs';

type ContractFile = { path: string; content: string };
type BuildCase = { id: string; files: ContractFile[]; sortedPaths: string[]; stream?: string; build: string };

const contract = JSON.parse(readFileSync(resolve('contracts/context.json'), 'utf8')) as { builds: BuildCase[] };

// The files of a case as the build passes them: the path and the bytes of its UTF-8 content.
const filesOf = (files: ContractFile[]) => files.map((file) => ({ path: file.path, bytes: Buffer.from(file.content, 'utf8') }));

for (const item of contract.builds) {
  test(`build ${item.id}: the sort order, the stream and the build id (HY-125)`, () => {
    const files = filesOf(item.files);
    assert.deepEqual(sortFiles(files).map((file) => file.path), item.sortedPaths);
    if (item.stream !== undefined) assert.equal(buildStream(files).toString('hex'), item.stream);
    assert.equal(buildId(files), item.build);
  });
}

test('a duplicate path fails and names the path (HY-125)', () => {
  const bytes = Buffer.from('x', 'utf8');
  assert.throws(() => buildId([{ path: 'assets/hyper-a1.js', bytes }, { path: 'assets/hyper-a1.js', bytes }]), /assets\/hyper-a1\.js/);
});
