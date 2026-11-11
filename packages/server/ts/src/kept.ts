// Kept values (HY-37, HY-38). Values outside the template data model are ignored; the cases of contracts/keep.json hold
// the rules.
import { inDataModel, type DecodedValue } from './json.js';
import { SafeString, type MapValue, type Value } from './values.js';

/** @internal */
export class Kept {
  // Replaces values at kept paths when the path exists and the kept value conforms to its value.
  static apply(data: MapValue, kept: readonly (readonly [string, Value | DecodedValue])[]): MapValue {
    let result = data;
    for (const [path, value] of kept) {
      if (!inDataModel(value)) continue;
      const [replaced] = Kept.replaceAt(result, path.split('.'), value);
      if (replaced instanceof Map) result = replaced;
    }
    return result;
  }

  // Returns the kept values that conform to the data, by path (HY-17, HY-38), applying each one before the next.
  static select(data: MapValue, kept: readonly (readonly [string, Value | DecodedValue])[]): MapValue {
    const selected: MapValue = new Map();
    let result = data;
    for (const [path, value] of kept) {
      if (!inDataModel(value)) continue;
      const [replaced, applied] = Kept.replaceAt(result, path.split('.'), value);
      if (applied) selected.set(path, value);
      if (replaced instanceof Map) result = replaced;
    }
    return selected;
  }

  // Returns the container with the value at the path of keys replaced when it conforms, and whether it replaced the
  // value; an absent path changes nothing. A list accepts only an index.
  private static replaceAt(container: Value, keys: readonly string[], value: Value): [Value, boolean] {
    const key = keys[0] ?? '';
    const rest = keys.slice(1);
    if (container instanceof Map) {
      const current = container.get(key);
      if (current === undefined) return [container, false];
      const copy = new Map(container);
      if (rest.length === 0) {
        if (!Kept.conforms(value, current)) return [container, false];
        copy.set(key, value);
        return [copy, true];
      }
      const [replaced, applied] = Kept.replaceAt(current, rest, value);
      copy.set(key, replaced);
      return [copy, applied];
    }
    if (!Array.isArray(container) || !/^\d+$/u.test(key)) return [container, false];
    const index = Number(key);
    const current: Value | undefined = container[index];
    if (current === undefined) return [container, false];
    const items = [...container];
    if (rest.length === 0) {
      if (!Kept.conforms(value, current)) return [container, false];
      items[index] = value;
      return [items, true];
    }
    const [replaced, applied] = Kept.replaceAt(current, rest, value);
    items[index] = replaced;
    return [items, applied];
  }

  // Returns true when a kept value has the shape of the data value (HY-38): the same type, the same keys of a map with
  // conforming values, and list items that conform to the first data item. An empty map or list gives no shape.
  private static conforms(value: Value, current: Value): boolean {
    if (Kept.valueKind(current) !== Kept.valueKind(value)) return false;
    const data = Kept.mapEntries(current);
    const kept = Kept.mapEntries(value);
    if (data !== null && kept !== null) {
      if (data.size === 0) return true;
      if (kept.size !== data.size) return false;
      for (const [key, item] of data) {
        const keptItem = kept.get(key);
        if (keptItem === undefined || !Kept.conforms(keptItem, item)) return false;
      }
      return true;
    }
    const [first] = Array.isArray(current) ? current : [];
    if (first !== undefined && Array.isArray(value)) return value.every((item) => Kept.conforms(item, first));
    return true;
  }

  // Returns the entries of a map of the data model, or null for another value.
  private static mapEntries(value: Value): MapValue | null {
    return value instanceof Map ? value : null;
  }

  // Returns the value type of the data model: null, bool, number, string, list or map.
  private static valueKind(value: Value): string {
    if (value === null) return 'null';
    if (typeof value === 'boolean') return 'bool';
    if (typeof value === 'number' || typeof value === 'bigint') return 'number';
    if (typeof value === 'string' || value instanceof SafeString) return 'string';
    if (Array.isArray(value)) return 'list';
    if (value instanceof Map) return 'map';
    return 'other';
  }
}
