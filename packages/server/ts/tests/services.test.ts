import { describe, expect, it } from 'vitest';
import { Services } from '../src/services.js';

interface Bound { clock: { now: number }; constructor: string; __proto__: string }

describe('Services', () => {
  it('creates a service once, on its first use', () => {
    const services = new Services<Bound>();
    let created = 0;
    services.bind('clock', () => ({ now: ++created }));
    expect(created).toBe(0);
    expect(services.get('clock')).toBe(services.get('clock'));
    expect(created).toBe(1);
  });

  it('fails for a key without a factory, a key of Object.prototype too', () => {
    const services = new Services<Bound>();
    expect(() => services.get('clock')).toThrow('no factory is bound for clock');
    expect(() => services.get('constructor')).toThrow('no factory is bound for constructor');
  });

  it('binds __proto__ as a service and leaves the prototype of its store alone', () => {
    const services = new Services<Bound>();
    services.bind('__proto__', () => 'bound');
    expect(services.get('__proto__')).toBe('bound');
    expect(() => services.get('constructor')).toThrow('no factory is bound for constructor');
  });
});
