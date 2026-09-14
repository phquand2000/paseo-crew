export type AttentionKind = "urgent" | "log";

export type Attention = {
  kind?: AttentionKind;
  trigger: string;
  agentId: string;
  role: string;
  what: string;
  quote?: string;
  where?: string;
};

export const ATTENTION_HEADER = /^ATTENTION(?: \((urgent|log)\))?: (.+?) in (\S+) \(([^)]+)\)[ \t]*$/m;

export function quoted(text: string): string {
  return `"${(text.trim().split("\n")[0] ?? "").replace(/"/g, "'").slice(0, 160)}"`;
}

export function attention(event: Attention): string {
  const head = `ATTENTION${event.kind ? ` (${event.kind})` : ""}: ${event.trigger} in ${event.agentId} (${event.role})`;
  return [
    head,
    `What: ${event.what}`,
    ...(event.quote ? [`Quote: ${event.quote}`] : []),
    ...(event.where ? [`Where: ${event.where}`] : []),
  ].join("\n");
}

export function logFields(agentId: string, role: string, trigger: string, quote?: string): string {
  return `${agentId} (${role})  ${trigger}${quote === undefined ? "" : `  ${quoted(quote)}`}`;
}

export function sweepPrompt(since: Date): string {
  return `SWEEP since ${since.toISOString()}`;
}

export function archivedAtStart(agentId: string, role: string, reasons: string[]): string {
  return `Agent ${agentId} (${role}) was archived as soon as it started: ${reasons.join("; ")}.`;
}

export const refusal = {
  launchOutsideProject: (role: string, cwd: string) =>
    `a ${role} starts only inside a project that has .seatworks/, and ${cwd} has none. Leave the workspace out to start it beside you.`,
  modelNotOffered: (role: string, allowed: string[]) =>
    `a ${role} runs ${allowed.join(" or ")}, as its profile says. Leave the model out, or pass ${allowed.length > 1 ? "one of those" : "that one"}.`,
  sessionOutsideProject: (role: string, cwd: string) =>
    `a ${role} runs only inside a project that has .seatworks/, and ${cwd} has none.`,
  seatMissing: (dir: string, role: string, root: string) =>
    `${dir} does not exist, so this ${role} would start without its prompt, skills and settings. Run setup/add-project.fish ${root} first.`,
  mayStart: (parentRole: string, mayStart: string[]) =>
    `a ${parentRole} starts ${mayStart.length > 0 ? `only ${mayStart.join(", ")}` : "no agents"}`,
  otherProject: (home: string) =>
    `it runs outside ${home}, where a seat would load another project's prompts and records`,
};
