// A loader or an action throws this error when the requested resource does not exist (HY-27).
export class NotFound extends Error {
  constructor() {
    super('not found');
    this.name = 'NotFound';
  }
}
