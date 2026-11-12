import { Token } from './token.ts';

/**
 * The signed token of a JSON text of HY-2.
 *
 * @internal
 */
export class SignedToken extends Token {
  constructor() {
    super();
  }

  static all(): Token[] {
    return [new SignedToken()];
  }

  shape(): string {
    return this.sign();
  }

  private sign(): string {
    return 'y';
  }
}
