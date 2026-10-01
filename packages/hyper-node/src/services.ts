// Application services that the application binds by key. A service is created once, on first use.
export class Services<S extends object> {
  private readonly factories = new Map<keyof S, () => unknown>();
  private readonly instances = new Map<keyof S, unknown>();

  // Registers the factory of a service.
  bind<K extends keyof S>(key: K, factory: () => S[K]): void {
    this.factories.set(key, factory);
    this.instances.delete(key);
  }

  // Returns the service of a key; a key without a factory fails.
  get<K extends keyof S>(key: K): S[K] {
    if (!this.instances.has(key)) {
      const factory = this.factories.get(key);
      if (factory === undefined) throw new Error(`hyper: no factory is bound for ${String(key)}`);
      this.instances.set(key, factory());
    }
    return this.instances.get(key) as S[K];
  }
}
