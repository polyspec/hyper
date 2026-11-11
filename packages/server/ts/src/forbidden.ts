// A loader or an action throws this error to answer the request with 403 (HY-51).
export class Forbidden extends Error {
  constructor() {
    super('forbidden');
    this.name = 'Forbidden';
  }
}
