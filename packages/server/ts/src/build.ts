// Reads the build id of the asset output (HY-125): the file `build.json` that holds exactly the key `build` with a build id
// of 64 lowercase hexadecimal characters. A failure names the path; no build id is invented or defaulted (HY-48).
import { readFileSync } from 'node:fs';

const BUILD_ID = /^[0-9a-f]{64}$/;

export function readBuildId(path: string): string {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`hyper: the build file ${path} cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`hyper: the build file ${path} is not valid JSON`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length !== 1 || !('build' in value)) {
    throw new Error(`hyper: the build file ${path} does not hold exactly the key build`);
  }
  const build = value.build;
  if (typeof build !== 'string' || !BUILD_ID.test(build)) {
    throw new Error(`hyper: the build id in ${path} is not 64 lowercase hexadecimal characters`);
  }
  return build;
}
