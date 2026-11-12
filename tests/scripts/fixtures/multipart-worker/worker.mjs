// One Node process that reads the request bodies of a list (tests/scripts/multipart-compare.test.mts): the arguments
// are the list, a JSON file of objects with `body`, the path of the body, `type`, `chunk`, `limit`, `valueLimit`,
// `partLimit` and `fileLimit`, and a directory for the files that it moves. It prints one JSON line for each body: what
// the body gave, a digest of the names, the values, the filenames and the contents of the files, and what it used.
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { RequestBody } from '../../../../packages/server/ts/dist/form/request-body.js';

const cases = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const [index, item] of cases.entries()) {
  const started = performance.now();
  const read = new RequestBody(item.type, item.limit, true, item.valueLimit, item.partLimit, item.fileLimit);
  let stopped = false;
  for await (const chunk of createReadStream(item.body, { highWaterMark: item.chunk })) {
    stopped = !read.feed(chunk);
    if (stopped) break;
    await read.written();
  }
  await read.written();
  const parts = read.parts();
  const ms = performance.now() - started;
  const hash = createHash('sha256');
  let values = 0;
  let files = 0;
  let bytes = 0;
  if (parts !== null) {
    for (const [name, list] of parts[0].pairs()) {
      hash.update(`V\0${name}\0`);
      for (const value of list) {
        values += 1;
        hash.update(`${Buffer.byteLength(value)}\0${value}\0`);
      }
    }
    for (const [name, list] of parts[1].pairs()) {
      for (const file of list) {
        files += 1;
        bytes += file.size();
        const target = join(process.argv[3], `node-${index}-${files}`);
        file.moveTo(target);
        const content = createHash('sha256');
        for await (const block of createReadStream(target)) content.update(block);
        hash.update(`F\0${name}\0${file.filename()}\0${file.contentType()}\0${file.size()}\0${content.digest('hex')}\0`);
        unlinkSync(target);
      }
    }
  }
  await read.remove();
  const usage = process.resourceUsage();
  console.log(JSON.stringify({ result: [parts !== null, stopped, read.exceeded(), values, files, bytes, hash.digest('hex')], ms: Math.round(ms * 10) / 10, cpu: Math.round((usage.userCPUTime + usage.systemCPUTime) / 1000) }));
}
