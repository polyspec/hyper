// The keys of the Node services (HY-105.4): a handler names a service by a key, and a key of Object.prototype is a key
// like any other. contracts/container.json holds the cases of the services that every server shares.
import { describe, expect, it } from 'vitest';
import { Container } from '../src/app/container.js';

interface Bound { clock: { now: number }; constructor: string; __proto__: string }

describe('Container', () => {
  it('fails for a key of Object.prototype without a factory', () => {
    const services = new Container<Bound>();
    expect(() => services.get('constructor')).toThrow('no factory is bound for constructor');
  });

  it('binds __proto__ as a service and leaves the prototype of its store alone', () => {
    const services = new Container<Bound>();
    services.bind('__proto__', () => 'bound');
    expect(services.get('__proto__')).toBe('bound');
    expect(() => services.get('constructor')).toThrow('no factory is bound for constructor');
  });
});
