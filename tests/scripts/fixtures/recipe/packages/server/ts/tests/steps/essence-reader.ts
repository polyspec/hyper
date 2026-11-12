import { MediaType } from '../../src/media-type.ts';

export class EssenceReader {
  read(text: string): string {
    return MediaType.parse(text).essence();
  }
}
