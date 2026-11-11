// The Node server of tests/scripts/upload-servers.test.mts: the server of `App.server`, with the application that the
// test built in UPLOAD_APP. The request hook answers every request with what the request gave of its body as JSON:
// whether its input is valid, its form values, and the name, the filename, the content type, the size and the SHA-256
// digest of each file, which it moves into UPLOAD_MOVED, reads and removes; `held` is the number of directories of requests in
// the temporary directory while the request runs. It prints the address that it listens on.
import { createHash } from 'node:crypto';
import { createReadStream, readdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App, FileSessions, Response } from '@polyspec/hyper-server';

const application = process.env.UPLOAD_APP;
const moved = process.env.UPLOAD_MOVED;
const limit = Number(process.env.UPLOAD_LIMIT);
const app = await App.open({
  manifest: join(application, 'manifest.json'),
  build: join(application, 'build.json'),
  templates: { index: join(application, 'node/templates.index.json'), root: join(application, 'node') },
  handlers: { routes: { home: { load: () => ({}) } } },
  timezone: 'Z',
  bodyLimit: limit,
  formTypes: ['application/x-www-form-urlencoded', 'multipart/form-data'],
  fileLimit: limit,
  partLimit: Number(process.env.UPLOAD_PARTS ?? 1000),
});
const server = app.server(new FileSessions({ directory: process.env.UPLOAD_SESSIONS }), {
  around: async (request) => {
    // UPLOAD_USAGE=1 is the form of benchmarks/uploads.mts: the sizes of the files without a move, and the processor
    // time and the largest memory of the process.
    const usage = process.env.UPLOAD_USAGE === '1';
    const files = [];
    for (const [name, list] of request.files()) {
      for (const file of list) {
        if (usage) {
          files.push([name, file.size()]);
          continue;
        }
        const target = join(moved, `node-${files.length}`);
        file.moveTo(target);
        const digest = createHash('sha256');
        for await (const block of createReadStream(target)) digest.update(block);
        files.push([name, file.filename(), file.contentType(), file.size(), digest.digest('hex')]);
        unlinkSync(target);
      }
    }
    const answer = { valid: request.validInput(), form: request.form(), files, held: readdirSync(tmpdir()).filter((name) => name.startsWith('hyper-')).length };
    if (usage) {
      const used = process.resourceUsage();
      answer.cpu = (used.userCPUTime + used.systemCPUTime) / 1000;
      // Node gives the largest memory in kilobytes; the answer holds bytes, as PHP and Python give them on Darwin.
      answer.rss = used.maxRSS * 1024;
    }
    return Response.text(200, JSON.stringify(answer));
  },
});
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error(`the upload server listens on no TCP port: ${String(address)}`);
  console.log(`upload on http://127.0.0.1:${address.port}`);
});
