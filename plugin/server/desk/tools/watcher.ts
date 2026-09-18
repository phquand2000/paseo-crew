import { no, ok, str } from "../context.ts";
import { letters } from "../letters.ts";
import type { Tool } from "../services.ts";
import { type Urgency, type Watching, WATCH_RULES, delivered, judge, keyOf, loadWatching, pagesLeft, saveWatching } from "../watching.ts";

/** What the SLP preset asks a Watcher to distinguish. The kit names these; the desk only checks a finding carries one. */
export const LABELS = ["destructive", "repetition", "mismatch", "unverified", "off-spec", "unasked", "early-stop", "derailed"];

const RANK: Record<Urgency, number> = { log: 0, digest: 1, page: 2 };

type Finding = { label: string; quote: string };

function findingsOf(value: unknown): Finding[] | string {
  if (!Array.isArray(value)) return "raise needs findings, as a list. An ending with nothing wrong sends an empty list.";
  const taken: Finding[] = [];
  for (const item of value) {
    const entry = (item ?? {}) as Record<string, unknown>;
    const label = str(entry.label);
    const quote = str(entry.quote);
    if (!LABELS.includes(label)) return `Every finding needs a label, one of: ${LABELS.join(", ")}.`;
    if (!quote) return `The ${label} finding needs the words from the ending that show it.`;
    taken.push({ label, quote });
  }
  return taken;
}

export const raise: Tool = async ({ ctx, roster }, caller, args) => {
  const where = str(args.where);
  if (!where) return no("raise needs where the ending happened, copied from the mail as it reached you.");
  const findings = findingsOf(args.findings);
  if (typeof findings === "string") return no(findings);

  const { project } = caller;
  const now = Date.now();
  const recorded = ctx.reading(project, where);
  let watching: Watching = loadWatching(project.state);
  let worst: Urgency = "log";
  const paged: Finding[] = [];
  const counts = new Map<string, number>();

  for (const finding of findings) {
    const attention = ctx.team(caller.project).attention;
    const rules = { ...WATCH_RULES, strikesAt: attention.strikesAt, pagesPerWindow: attention.pagesPerWindow, windowHours: attention.windowHours, watch: attention.watch };
    const verdict = judge(watching, { subject: where, label: finding.label, where, quote: finding.quote, evidence: recorded }, now, rules);
    watching = verdict.watching;
    const count = verdict.strike?.count ?? 0;
    counts.set(finding.label, count);
    if (RANK[verdict.urgency] > RANK[worst]) worst = verdict.urgency;
    if (verdict.urgency === "page") paged.push(finding);
    ctx.event(project, { kind: "watch", agent: caller.id, label: finding.label, where, quote: finding.quote, urgency: verdict.urgency, count });
  }

  if (findings.length === 0) {
    ctx.event(project, { kind: "watch", agent: caller.id, label: "none", where, quote: "", urgency: "log", count: 0 });
    return ok("Recorded. An ending with nothing wrong needs nobody's attention, so nothing was sent.");
  }

  const named = findings.map((finding) => finding.label).join(", ");
  if (worst !== "page") {
    saveWatching(project.state, watching);
    return ok(`Recorded ${named}. It goes in the report rather than interrupting anyone. Keep reading endings.`);
  }

  // Every finding in one raise is judged against the same already-spent budget, so a raise carrying
  // three struck-out faults would send three. What does not fit is left with occurrences nobody has
  // been told about, which is what puts it in the report. A label the owner marked as always-interrupt
  // is never held back.
  //
  // One letter per key first, and only then the rationing: two findings under one label are a single
  // interruption — they post the same key and the outbox drops the second — so letting them reserve
  // two slots held a third, different fault back for a budget half of which was still free, and told
  // the Watcher the budget was spent.
  const rules = { ...WATCH_RULES, ...ctx.team(caller.project).attention };
  const room = pagesLeft(watching, now, rules);
  const once = paged.filter((finding, index) => paged.findIndex((other) => other.label === finding.label) === index);
  const urgent = once.filter((finding) => rules.always.includes(finding.label));
  const sending = [...urgent, ...once.filter((finding) => !urgent.includes(finding)).slice(0, Math.max(0, room - urgent.length))];
  const waiting = once.filter((finding) => !sending.includes(finding));

  const to = await roster.supervisorFor(project);
  if (!to) {
    // Nobody was told, so every occurrence is still owed to the report and reaches whoever opens a
    // seat next — including a recurrence of a fault an earlier report already carried. Refusing here
    // would end this turn over something the Watcher did right.
    saveWatching(project.state, watching);
    return ok(`Recorded ${named}. Nobody above you is running to be interrupted, so it waits in the report for whoever comes back. Keep reading endings.`);
  }
  for (const finding of sending) {
    const count = counts.get(finding.label) ?? 1;
    await ctx.post(to, `attention:${where}:${finding.label}:${count}`, letters.attention(finding.label, where, finding.quote, count, recorded));
  }
  saveWatching(project.state, delivered(watching, sending.map((finding) => keyOf(where, finding.label)), now));
  const waited = waiting.length > 0 ? ` ${waiting.map((finding) => finding.label).join(", ")} waits for the report: the interruption budget for this window is spent.` : "";
  return ok(`Raised ${sending.map((finding) => finding.label).join(", ") || named} to the owner.${waited} Keep reading endings; nothing to wait for.`);
};
