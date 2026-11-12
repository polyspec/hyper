export class Widget {
  size = 0;
  private hidden = 0;
  protected guarded = 0;

  static make(): Widget {
    return new Widget();
  }

  grow(): void {
    this.size += 1;
  }
}
