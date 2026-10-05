#!/usr/bin/env node
// Runs a shell command, passes its standard output and standard error through as they come, and ends each stream
// that the command left without a final newline with one, so the next line of a log starts at column 0 (HY-84): a
// line-based reader, such as the last lines of a failed target in the full run, never finds two lines joined. Ends
// with the status of the command.
//
// Usage: node scripts/line-end.mjs '<shell command>'
import { spawn } from 'node:child_process';

/** Writes the chunks of `stream` to `output` and returns a function that ends the output with a newline if needed. */
export function passThrough(stream, output) {
  let last = '\n';
  stream.on('data', (data) => {
    if (data.length > 0) last = String(data).at(-1);
    output.write(data);
  });
  return () => { if (last !== '\n') output.write('\n'); };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === undefined || rest.length > 0) {
    process.stderr.write("Usage: node scripts/line-end.mjs '<shell command>'\n");
    process.exit(2);
  }
  const child = spawn('/bin/sh', ['-c', command], { stdio: ['inherit', 'pipe', 'pipe'] });
  const endOut = passThrough(child.stdout, process.stdout);
  const endErr = passThrough(child.stderr, process.stderr);
  child.on('error', (error) => { process.stderr.write(`${command} cannot run: ${error.message}\n`); process.exitCode = 1; });
  child.on('close', (status, signal) => {
    endOut();
    endErr();
    process.exitCode = status ?? (signal ? 1 : 0);
  });
}
