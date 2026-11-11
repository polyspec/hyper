/**
 * The media type of HY-2.
 */
export type Essence = string;

export class MediaType {
  private constructor() {}

  essence(): string {
    return 'text/html';
  }
}
