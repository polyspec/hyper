// The build id of the application, which `build.json` holds as `{"build":"<id>"}` (HY-125). The build id is the
// lowercase hexadecimal SHA-256 digest of the outputs of the browser; no server derives or defaults it (HY-48).
import { readFileSync } from 'node:fs';
import { InvalidBuild } from './invalid-build.js';

/** @internal */
export class Build {
  // Reads the build id of a `build.json` file. The file must exist, be valid JSON and hold exactly the key `build` with
  // a build id of 64 lowercase hexadecimal characters; a failure names the path of the file (HY-125.5).
  static read(file: string): string {
    let bytes: Buffer;
    try {
      bytes = readFileSync(file);
    } catch (error) {
      throw new InvalidBuild(`${file} is missing or not readable (HY-125)`, { cause: error });
    }
    let value: unknown;
    try {
      // Bytes that are not UTF-8 and a leading U+FEFF are not valid JSON, as in PHP and Python (HY-106.7).
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
    } catch (error) {
      throw new InvalidBuild(`${file} is not valid JSON (HY-125)`, { cause: error });
    }
    const build = typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 1 && 'build' in value ? value.build : undefined;
    if (typeof build !== 'string' || !/^[0-9a-f]{64}$/u.test(build)) {
      throw new InvalidBuild(`${file} does not hold exactly the key build with a build id of 64 lowercase hexadecimal characters (HY-125)`);
    }
    return build;
  }
}
