import { Widget } from './widget.ts';

/** The receivers of the scope reading (HYR-5): what the source writes about the class of each. */
export class Receivers {
  private kept: Widget | null = null;

  run(widget: Widget, items: Map<string, number>): void {
    widget.grow();
    Widget.make();
    this.other();
    const made = new Widget();
    this.kept = made;
    items.get('a');
    for (const item of this.all()) {
      void item.size;
    }
    const either = widget ?? new Widget();
    either.grow();
  }

  other(): void {}

  all(): Widget[] {
    return this.kept === null ? [] : [this.kept];
  }
}
