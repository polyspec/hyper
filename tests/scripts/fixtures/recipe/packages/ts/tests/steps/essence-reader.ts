import { MediaType } from '../../src/representation/media-type.ts';

export class EssenceReader {
  read(text: string): string {
    return MediaType.parse(text).essence();
  }
}
