/** JSON values: records, a stable order for comparing them, dot paths, and one layered over another. */

export type Json = Record<string, unknown>;

export const isRecord = (value: unknown): value is Json =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])]),
  );
}

export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

/** What `path` reaches through nested records, or undefined where one is missing. */
export function getPath(value: unknown, path: string[]): unknown {
  let cursor = value;
  for (const part of path) cursor = isRecord(cursor) ? cursor[part] : undefined;
  return cursor;
}

/** Sets `path` in `target`, making the records on the way; undefined removes it. */
export function setPath(target: Json, path: string[], value: unknown): void {
  let cursor = target;
  for (const part of path.slice(0, -1)) {
    if (!isRecord(cursor[part])) cursor[part] = {};
    cursor = cursor[part] as Json;
  }
  const last = path[path.length - 1];
  if (last === undefined) return;
  if (value === undefined) delete cursor[last];
  else cursor[last] = value;
}

/** `over` laid over `base`: records merge key by key, lists join without repeats, anything else is replaced. */
export function layered(base: unknown, over: unknown): unknown {
  if (Array.isArray(base) && Array.isArray(over))
    return [...new Set<unknown>([...(base as unknown[]), ...(over as unknown[])])];
  if (!isRecord(base) || !isRecord(over)) return over === undefined ? base : over;
  const out: Json = { ...base };
  for (const [key, value] of Object.entries(over)) out[key] = layered(base[key], value);
  return out;
}
