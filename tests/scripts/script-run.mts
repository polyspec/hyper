// The run of a check script by the tests of that script: the script runs under the node of the test run with its
// arguments, and a failure is the status 1 with each expected message on stderr.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

export type ScriptResult = { status: number | null; stdout: string; stderr: string };

/** Runs `script` with `args` under the node of the test run, in the environment `env` when it is given. */
export function runScript(script: string, args: string[], env?: NodeJS.ProcessEnv): ScriptResult {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', ...(env === undefined ? {} : { env }) });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Asserts the status 1 and each of `messages` on stderr. */
export function assertFails(result: ScriptResult, messages: string[]): void {
  assert.equal(result.status, 1, result.stderr);
  for (const message of messages) assert.ok(result.stderr.includes(message), `missing "${message}" in:\n${result.stderr}`);
}
