import { rules } from './core-rules.ts';

export class Csrf {
  /** Returns the token masked with a mask (HY-24.2). */
  static mask(token: string, mask: string): string {
    return rules().csrfMask(token, mask);
  }
}
