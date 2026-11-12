import type { Sized } from './sized.ts';
import { Widget } from './widget.ts';

/** A function of the module whose name a parameter of a method also has. */
export function widget(): void {}

/** A function of the module whose name a variable of a method also has. */
export function either(): void {}

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

  sized(item: Sized): void {
    item.grow();
    const { kept, other: renamed } = this;
    kept?.grow();
    renamed.call(this);
  }

  listed(widgets: readonly Widget[], others: Array<Widget>): void {
    for (const listedWidget of widgets) listedWidget.grow();
    for (const other of others) other.grow();
  }

  async made(): Promise<Widget | null> {
    return this.kept;
  }

  all(): Widget[] {
    return this.kept === null ? [] : [this.kept];
  }
}
