import { Csrf } from '../session/csrf.ts';
import { JsonCodec } from './json-codec.ts';

/**
 * The media type of HY-2.
 */
export type Essence = string;

export class MediaType {
  private constructor() {}

  static parse(text: string): MediaType {
    JsonCodec.decode(text);
    return new MediaType();
  }

  essence(): string {
    return this.folded(new Csrf('k'));
  }

  private folded(csrf: Csrf): string {
    return csrf.raw();
  }
}
