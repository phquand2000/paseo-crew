/** What a change replaced, kept so the record says what the work was asked before it was asked again. */
export type Amendment = { at: number; by: string; why: string; was: Record<string, string | string[]> };

/** Sets what `changes` gives and keeps what it replaced in the entry's history; undefined when nothing would change. */
export function amend(
  entry: { amended?: Amendment[] },
  changes: Record<string, string | string[]>,
  by: string,
  why: string,
  at = Date.now(),
): Amendment | undefined {
  const fields = entry as unknown as Record<string, string | string[]>;
  const was: Amendment["was"] = {};
  for (const [field, value] of Object.entries(changes)) {
    if (JSON.stringify(fields[field]) === JSON.stringify(value)) continue;
    was[field] = fields[field] ?? "";
    fields[field] = value;
  }
  if (Object.keys(was).length === 0) return undefined;
  const amendment = { at, by, why, was };
  entry.amended = [...(entry.amended ?? []), amendment];
  return amendment;
}
