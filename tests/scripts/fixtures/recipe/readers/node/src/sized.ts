/** A value with a size, which a class implements. */
export interface Sized {
  readonly next: Sized | null;
  count: number;
  grow(): void;
}
