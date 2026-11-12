/**
 * The token of a JSON text of HY-2.
 *
 * @internal
 */
export class Token {
  constructor() {
    this.seed();
  }

  text(): string {
    return this.shape();
  }

  shape(): string {
    return 'x';
  }

  private seed(): void {}
}
