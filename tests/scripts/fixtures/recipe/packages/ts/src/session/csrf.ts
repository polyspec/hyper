/**
 * The CSRF token of HY-1.
 *
 * @internal
 */
export class Csrf {
  constructor(secret: string) {
    if (secret === '') throw new Error('empty');
  }

  mask(token: string): string {
    return `${token}!`;
  }

  raw(): string {
    return this.fold();
  }

  private fold(): string {
    return 'x';
  }
}
