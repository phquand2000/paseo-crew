export type BlockKind = "REPORT" | "NEED" | "BLOCKED" | "QUESTION";
export type Block = { kind: BlockKind; text: string };

const START = /^[\s>*_#`-]*(REPORT|NEED|BLOCKED|QUESTION\s*\(concept\))[\s*_`]*:/i;

export function blocks(text: string): Block[] {
  const lines = text.split(/\r?\n/);
  const found: { kind: BlockKind; start: number }[] = [];
  lines.forEach((line, index) => {
    const match = START.exec(line);
    if (!match?.[1]) return;
    const word = match[1].toUpperCase();
    found.push({ kind: word.startsWith("QUESTION") ? "QUESTION" : (word as BlockKind), start: index });
  });
  return found.map((entry, index) => ({
    kind: entry.kind,
    text: lines
      .slice(entry.start, found[index + 1]?.start ?? lines.length)
      .join("\n")
      .trim(),
  }));
}

export function isRequest(block: Block): boolean {
  return block.kind !== "REPORT";
}

export function outcomeOf(text: string): string | undefined {
  const match = /^[\s>*_#`-]*Outcome[\s*_`]*:[\s*_`]*([A-Za-z-]+)/im.exec(text);
  return match?.[1]?.toLowerCase();
}

export function dependencyRequest(text: string): string | undefined {
  const match = /^[\s>*_#`-]*DEPENDENCY_REQUEST[\s*_`]*:\s*(.+)$/im.exec(text);
  return match?.[1]?.trim();
}

export function clip(text: string, limit: number): { text: string; clipped: boolean } {
  if (text.length <= limit) return { text, clipped: false };
  return { text: `${text.slice(0, limit).trimEnd()}\n[…${text.length - limit} more characters in the seat's own timeline]`, clipped: true };
}
