import { SignedToken } from './signed-token.ts';

/**
 * The JSON codec of HY-2.
 *
 * @internal
 */
export class JsonCodec {
  static decode(text: string): string {
    let decoded = text;
    for (const token of SignedToken.all()) {
      decoded += token.text();
    }
    return decoded;
  }
}
