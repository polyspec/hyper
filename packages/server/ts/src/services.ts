// Application services that the application binds by key. A service is created once, on first use.
export class Services<S extends object> {
  // The getter of each bound service, which creates the service on its first call and returns it on every call.
  private readonly getters: { [K in keyof S]?: () => S[K] } = {};

  // Registers the factory of a service.
  bind<K extends keyof S>(key: K, factory: () => S[K]): void {
    let created: { service: S[K] } | null = null;
    // An own property, so a key such as __proto__ is a service and never the prototype of the object.
    Object.defineProperty(this.getters, key, { value: () => (created ??= { service: factory() }).service, enumerable: true, configurable: true, writable: true });
  }

  // Returns the service of a key; a key without a factory fails.
  get<K extends keyof S>(key: K): S[K] {
    // Only an own property is a bound factory; a key of Object.prototype, such as constructor, is not.
    const getter = Object.hasOwn(this.getters, key) ? this.getters[key] : undefined;
    if (getter === undefined) throw new Error(`hyper: no factory is bound for ${String(key)}`);
    return getter();
  }
}
