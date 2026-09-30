import type { Level } from "../../domain/incident.ts";

/** Every fact the code raises and its level; one that can open an incident has the title a person reads it by. */
export const FACTS = {
  irreversible: { level: "page", title: "Ran a command that cannot be undone" },
  stuck: { level: "attend", title: "Going round in circles" },
  "no-recovery": { level: "attend", title: "Did not recover from a failure" },
  "test-weakened": { level: "attend", title: "A test lost its assertions" },
  suppressed: { level: "attend", title: "Silenced a check instead of fixing it" },
  "claim-contradicted": { level: "attend", title: "Handed back as complete while its last check failed" },
  "long-turn": { level: "attend", title: "A turn with nothing new for a long time" },
  "rework-loop": { level: "attend", title: "Sent back again and again" },
  "patched-not-fixed": { level: "attend", title: "Several tasks patched, none fixed" },
  "reviews-unconverged": { level: "attend", title: "Reviews piling up with nothing accepted" },
  "certainty-only": { level: "attend", title: "A review told to report only certainties" },
  "brief-prewritten": { level: "attend", title: "A brief that writes the answer out" },
  "ask-waiting": { level: "attend", title: "An ask left waiting on its reader" },
  "call-failed": { level: "note" },
  "gate-failed": { level: "note" },
  "outside-scope": { level: "note" },
  "edit-before-look": { level: "note" },
  destructive: { level: "note" },
} as const satisfies Record<string, { level: "note" } | { level: Exclude<Level, "note">; title: string }>;

export type FactKind = keyof typeof FACTS;

export type Fact = { kind: FactKind; level: Level; quote: string };

export const fact = (kind: FactKind, quote: string): Fact => ({ kind, level: FACTS[kind].level, quote });

/** The title of a kind the incident book holds, which may be one this code no longer raises. */
export function factTitle(kind: string): string | undefined {
  return (FACTS as Record<string, { title?: string }>)[kind]?.title;
}
