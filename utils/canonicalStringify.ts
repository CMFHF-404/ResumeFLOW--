/**
 * Serializes values with recursively sorted object keys while preserving array order.
 *
 * Existing fingerprint semantics are deliberate: undefined object properties are
 * omitted, explicit undefined array items become null, sparse slots stay sparse,
 * and an unsupported top-level value falls back to null. Keep fingerprint callers
 * on this shared implementation so persisted/cache comparisons cannot drift.
 */
export const canonicalStringify = (value: unknown): string => {
  const stringifyValue = (candidate: unknown): string | undefined => {
    if (candidate === undefined) {
      return undefined;
    }
    if (candidate === null || typeof candidate !== 'object') {
      return JSON.stringify(candidate);
    }
    if (Array.isArray(candidate)) {
      const items = candidate.map((item) => stringifyValue(item) ?? 'null');
      return `[${items.join(',')}]`;
    }
    const record = candidate as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const entries: string[] = [];
    keys.forEach((key) => {
      const serialized = stringifyValue(record[key]);
      if (serialized !== undefined) {
        entries.push(`${JSON.stringify(key)}:${serialized}`);
      }
    });
    return `{${entries.join(',')}}`;
  };

  return stringifyValue(value) ?? 'null';
};
