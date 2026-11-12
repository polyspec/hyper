import type { Sized } from './sized.ts';

export class Widget implements Sized {
  size = 0;
  readonly next = null;
  count = 0;
  private hidden = 0;
  protected guarded = 0;

  static make(): Widget {
    return new Widget();
  }

  grow(): void {
    this.size += 1;
  }
}

export class Bigger extends Widget {
  readonly extra = 1;
}
