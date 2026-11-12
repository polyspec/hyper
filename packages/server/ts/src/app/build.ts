// The build id of the application, which `build.json` holds as `{"build":"<id>"}` (HY-125). The build id is the
// lowercase hexadecimal SHA-256 digest of the outputs of the browser; no server derives or defaults it (HY-48).
import { readFileSync } from 'node:fs';
import { InvalidBuild } from './invalid-build.js';
import { JsonCodec, type DecodedValue } from '../data/json-codec.js';
import { JsonDecodeError } from '../data/json-decode-error.js';

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
    let text: string;
    try {
      // Bytes that are not UTF-8 and a leading U+FEFF are not valid JSON (HY-106.7).
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      throw new InvalidBuild(`${file} is not valid JSON (HY-125)`, { cause: error });
    }
    let value: DecodedValue;
    try {
      // The JSON text is decoded by the decoder of the server, with its one nesting limit (HY-54).
      value = JsonCodec.decode(text);
    } catch (error) {
      if (!(error instanceof JsonDecodeError)) throw error;
      throw new InvalidBuild(`${file} is not valid JSON (HY-125)`, { cause: error });
    }
    const build = value instanceof Map && value.size === 1 ? value.get('build') : undefined;
    if (typeof build !== 'string' || !/^[0-9a-f]{64}$/u.test(build)) {
      throw new InvalidBuild(`${file} does not hold exactly the key build with a build id of 64 lowercase hexadecimal characters (HY-125)`);
    }
    return build;
  }
}
