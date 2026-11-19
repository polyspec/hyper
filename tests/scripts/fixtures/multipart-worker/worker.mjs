// One Node process that reads the request bodies of a list (tests/scripts/multipart-compare.test.mts): the arguments
// are the list, a JSON file of objects with `body`, the path of the body, `type`, `chunk`, `limit`, `valueLimit`,
// `partLimit` and `fileLimit`, and a directory for the files that it moves. It prints one JSON line for each body: what
// the body gave, a digest of the names, the values, the filenames and the contents of the files, and what it used.
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { binding } from '../../../../packages/ts/dist/app/core-rules.js';

const cases = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const [index, item] of cases.entries()) {
  const started = performance.now();
  // The core reads the chunks under the four limits in their order (F-25, HY-131.32); its first failure stops the body.
  const read = await binding().RequestBody.start(item.type === '' ? null : item.type, null, true, { limit: item.limit, valueLimit: item.valueLimit, partLimit: item.partLimit, fileLimit: item.fileLimit });
  let failure = null;
  for await (const chunk of createReadStream(item.body, { highWaterMark: item.chunk })) {
    try {
      await read.feed(chunk);
    } catch (error) {
      failure = error;
      break;
    }
  }
  const stopped = failure !== null;
  let parts = null;
  if (!stopped) {
    try {
      await read.finish();
      parts = read.parts();
    } catch (error) {
      failure = error;
    }
  }
  const exceeded = ['body_limit', 'value_limit', 'part_limit', 'file_limit'].includes(failure?.kind);
  const ms = performance.now() - started;
  const hash = createHash('sha256');
  let values = 0;
  let files = 0;
  let bytes = 0;
  if (parts !== null) {
    for (const [name, list] of parts.fields) {
      hash.update(`V\0${name}\0`);
      for (const value of list) {
        values += 1;
        hash.update(`${Buffer.byteLength(value)}\0${value}\0`);
      }
    }
    // A file of the core gives its name, filename, content type and size as getters; UploadedFile wraps them in methods.
    for (const [name, list] of parts.files) {
      for (const file of list) {
        files += 1;
        bytes += file.size;
        const target = join(process.argv[3], `node-${index}-${files}`);
        await file.moveTo(target);
        const content = createHash('sha256');
        for await (const block of createReadStream(target)) content.update(block);
        hash.update(`F\0${name}\0${file.filename}\0${file.contentType}\0${file.size}\0${content.digest('hex')}\0`);
        unlinkSync(target);
      }
    }
  }
  await read.remove();
  const usage = process.resourceUsage();
  console.log(JSON.stringify({ result: [parts !== null, stopped, exceeded, values, files, bytes, hash.digest('hex')], ms: Math.round(ms * 10) / 10, cpu: Math.round((usage.userCPUTime + usage.systemCPUTime) / 1000) }));
}
