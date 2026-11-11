// A loader or an action throws this error to answer the request with 400 (HY-58).
export class BadRequest extends Error {
  constructor() {
    super('bad request');
    this.name = 'BadRequest';
  }
}
