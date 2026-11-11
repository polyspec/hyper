// The build id of the application, which `build.json` holds as `{"build":"<id>"}` (HY-125). The build id is the
// lowercase hexadecimal SHA-256 digest of the outputs of the browser; no server derives or defaults it (HY-48).
import { readFileSync } from 'node:fs';
import { InvalidBuild } from './invalid-build.js';

/** @internal */
export class Build {
  // Reads the build id of a `build.json` file. The file must exist, be valid JSON and hold exactly the key `build` with
  // a build id of 64 lowercase hexadecimal characters; a failure names the path of the file (HY-125.5).
  static read(file: string): string {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      throw new InvalidBuild(`${file} is missing or not readable (HY-125)`);
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new InvalidBuild(`${file} is not valid JSON (HY-125)`);
    }
    const build = typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 1 && 'build' in value ? value.build : undefined;
    if (typeof build !== 'string' || !/^[0-9a-f]{64}$/u.test(build)) {
      throw new InvalidBuild(`${file} does not hold exactly the key build with a build id of 64 lowercase hexadecimal characters (HY-125)`);
    }
    return build;
  }
}
