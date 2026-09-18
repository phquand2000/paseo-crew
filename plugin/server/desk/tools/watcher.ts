import { no, ok, str } from "../context.ts";
import { clip, letters } from "../letters.ts";
import type { Tool } from "../services.ts";
import { type Urgency, WATCH_RULES, delivered, judge, keyOf, pagesLeft } from "../watching.ts";

const RANK: Record<Urgency, number> = { log: 0, digest: 1, page: 2 };

type Finding = { label: string; quote: string };

function findingsOf(value: unknown, labels: string[]): Finding[] | string {
  if (!Array.isArray(value)) return "raise needs findings, as a list. An ending with nothing wrong sends an empty list.";
  const taken: Finding[] = [];
  for (const item of value) {
    const entry = (item ?? {}) as Record<string, unknown>;
    const label = str(entry.label);
    const quote = str(entry.quote);
    // An empty list is the desk not policing the vocabulary: what a finding is called is the Watcher's
    // to say, and the desk only needs it to carry something it can key and count by.
    if (!label) return labels.length > 0 ? `Every finding needs a label, one of: ${labels.join(", ")}.` : "Every finding needs a label: one word for what kind of thing it is.";
    if (labels.length > 0 && !labels.includes(label)) return `Every finding needs a label, one of: ${labels.join(", ")}.`;
    if (!quote) return `The ${label} finding needs the words from the ending that show it.`;
    taken.push({ label, quote });
  }
  return taken;
}

export const raise: Tool = async ({ ctx, roster }, caller, args) => {
  const where = str(args.where);
  if (!where) return no("raise needs where the ending happened, copied from the mail as it reached you.");
  const attention = ctx.team(caller.project).attention;
  const findings = findingsOf(args.findings, attention.labels);
  if (typeof findings === "string") return no(findings);

  const { project } = caller;
  const now = Date.now();
  // The mechanical record of the turn is filed under the `where` the ending letter names, and the
  // desk asks the Watcher to copy that string back. A paraphrase is not refused — naming what it saw
  // is the Watcher's — but it silently costs the finding its evidence and starts the strike count
  // again under a key of its own, so the reply says when nothing was filed under this one.
  const recorded = ctx.reading(project, where);

  if (findings.length === 0) {
    ctx.event(project, { kind: "watch", agent: caller.id, label: "none", where, quote: "", urgency: "log", count: 0 });
    return ok("Recorded. An ending with nothing wrong needs nobody's attention, so nothing was sent.");
  }

  // One set of rules for the whole call. Built field by field, this dropped `always`, so which label
  // always interrupts was the constant in code even where the project had said otherwise.
  const rules = { ...WATCH_RULES, ...attention };

  // What was seen is recorded first and on its own, under the lock. Judging from a snapshot taken
  // before the letters went out lost a whole sighting whenever two Watchers were handed two endings in
  // the same mailbox, which is the ordinary case for a Watcher that was busy.
  const judged = await ctx.watching(project, (current) => {
    let next = current;
    let worst: Urgency = "log";
    const paged: Finding[] = [];
    const counts = new Map<string, number>();
    for (const finding of findings) {
      const verdict = judge(next, { subject: where, label: finding.label, where, quote: finding.quote, evidence: recorded }, now, rules);
      next = verdict.watching;
      const count = verdict.strike?.count ?? 0;
      counts.set(finding.label, count);
      if (RANK[verdict.urgency] > RANK[worst]) worst = verdict.urgency;
      if (verdict.urgency === "page") paged.push(finding);
      ctx.event(project, { kind: "watch", agent: caller.id, label: finding.label, where, quote: finding.quote, urgency: verdict.urgency, count });
    }
    return { save: next, result: { worst, paged, counts, room: pagesLeft(next, now, rules) } };
  });
  const { worst, paged, counts, room } = judged;

  // Only when nothing at all was filed under this where while others were: a turn with no mechanical
  // notes is filed with an empty list, and the first version said "no record" for every such turn —
  // steering a Watcher that had it right to change a where that was correct. After a restart nothing
  // is filed for anyone, and saying so for every raise would be the same false steer.
  const unknown =
    !ctx.hasReading(project, where) && ctx.readsAny(project)
      ? ` The desk has no ending filed under "${clip(where, 120)}" — if that is not the where the mail gave you, this finding carries no evidence and counts on its own.`
      : "";
  const named = findings.map((finding) => finding.label).join(", ");
  if (worst !== "page") return ok(`Recorded ${named}. It goes in the report rather than interrupting anyone.${unknown} Keep reading endings.`);

  // Every finding in one raise is judged against the same already-spent budget, so a raise carrying
  // three struck-out faults would send three. What does not fit is left with occurrences nobody has
  // been told about, which is what puts it in the report. A label the owner marked as always-interrupt
  // is never held back.
  //
  // One letter per key first, and only then the rationing: two findings under one label are a single
  // interruption — they post the same key and the outbox drops the second — so letting them reserve
  // two slots held a third, different fault back for a budget half of which was still free, and told
  // the Watcher the budget was spent.
  const once = paged.filter((finding, index) => paged.findIndex((other) => other.label === finding.label) === index);
  const urgent = once.filter((finding) => rules.always.includes(finding.label));
  const sending = [...urgent, ...once.filter((finding) => !urgent.includes(finding)).slice(0, Math.max(0, room - urgent.length))];
  const waiting = once.filter((finding) => !sending.includes(finding));

  const to = await roster.supervisorFor(project);
  if (!to) {
    // Nobody was told, so every occurrence is still owed to the report and reaches whoever opens a
    // seat next — including a recurrence of a fault an earlier report already carried. Refusing here
    // would end this turn over something the Watcher did right.
    return ok(`Recorded ${named}. Nobody above you is running to be interrupted, so it waits in the report for whoever comes back.${unknown} Keep reading endings.`);
  }
  for (const finding of sending) {
    const count = counts.get(finding.label) ?? 1;
    await ctx.post(to, `attention:${where}:${finding.label}:${count}`, letters.attention(finding.label, where, finding.quote, count, recorded));
  }
  // Charged after the letters really went, on the table as it is then: two interruptions decided from
  // one snapshot cost one page of a budget of two, and the window stopped bounding anything.
  const charged = sending.map((finding) => keyOf(where, finding.label));
  await ctx.watching(project, (current) => ({ save: delivered(current, charged, now), result: undefined }));
  const waited = waiting.length > 0 ? ` ${waiting.map((finding) => finding.label).join(", ")} waits for the report: the interruption budget for this window is spent.` : "";
  // Named, because it is not the owner: the letter goes to whichever seat supervises this project,
  // and what the Watcher is told about where its finding went is what it reasons from next.
  return ok(`Raised ${sending.map((finding) => finding.label).join(", ") || named} to ${to}, who supervises this project.${waited}${unknown} Keep reading endings; nothing to wait for.`);
};
