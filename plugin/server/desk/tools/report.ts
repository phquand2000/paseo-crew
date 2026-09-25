import { z } from "zod";
import { no, ok, str, strs } from "../context.ts";
import { laneGate } from "../gates.ts";
import { askFirstHits, changeOf, changesStanding, landFacts, reviewFacts } from "../landing.ts";
import { type Lane, laneOfLead, loadLedger, tasksOf } from "../ledger.ts";
import { letters } from "../letters.ts";
import { putOnHold } from "../hold.ts";
import { midTurnAmong } from "../writing.ts";
import type { Project } from "../project.ts";
import { type DeskServices, defineTool } from "../services.ts";

/** A lane that went on without the Human's answer to a costly question stops at its ready report; says which, when it did. */
async function parkAtCheckpoint(desk: DeskServices, project: Project, lane: string): Promise<string | undefined> {
  const waiting = desk.ctx.transact(project, (ledger) => {
    const open = Object.values(ledger.questions).filter((question) => question.lane === lane && question.status === "open" && question.class === "costly");
    for (const question of open) question.parked = true;
    return open.map((question) => question.id);
  });
  if (waiting.length === 0) return undefined;
  const reason = `it went on without the Human's answer to ${waiting.join(", ")}, and stops at its ready report until they answer`;
  const held = await putOnHold(desk, project, lane, "desk", reason);
  return typeof held === "string" ? undefined : `It is on hold: ${reason}.`;
}

/** What landing a lane reported ready would bring and wait for, read before whoever lands it decides to. */
async function readAhead(desk: DeskServices, project: Project, lane: Lane): Promise<{ asks: string[]; facts: string[]; changes: boolean }> {
  const change = await changeOf(project, lane);
  const ledger = loadLedger(project.state);
  return { asks: askFirstHits(project, change), facts: await landFacts(desk.ctx.kit, project, ledger, lane, change), changes: changesStanding(ledger, lane) };
}

export const report = defineTool({
  name: "report",
  input: z.strictObject({ summary: z.string(), ready: z.boolean(), carried: z.array(z.string()).optional() }),
  async handle(desk, caller, args) {
    const { ctx, roster } = desk;
    const summary = str(args.summary);
    const lane = laneOfLead(loadLedger(caller.project.state), caller.id);
    if (!lane) return no("You have no open lane.");
    if (args.ready === true) {
      // What ready claims is what the gate runs on: the merges accepted before it land first, and nobody writes under it.
      await desk.merges.retry(caller.project);
      await desk.merges.settled(caller.project);
      const inCopy = tasksOf(loadLedger(caller.project.state), lane.id).filter((task) => task.kind === "code" && task.mode !== "parallel");
      const busy = await midTurnAmong(roster, inCopy.map((task) => task.peer));
      if (busy.length > 0) return no(`${busy.join(" and ")} ${busy.length === 1 ? "is" : "are"} mid-turn in the lane's working copy, so what ready claims could still change under the gate. Report ready once ${busy.length === 1 ? "that turn ends" : "those turns end"}.`);
    }
    const gate = args.ready === true ? await laneGate(ctx, caller.project, lane) : undefined;
    // Recorded on the lane the caller still leads: it may have closed, or had its Lead replaced, while the gate ran.
    const still = ctx.transact(caller.project, (current) => {
      const entry = laneOfLead(current, caller.id);
      if (entry?.id !== lane.id) return false;
      if (args.ready === true) entry.ready = { at: Date.now() };
      else delete entry.ready;
      return true;
    });
    if (!still) return no(`Lane ${lane.id} is no longer yours to report on: it closed, or has another Lead, while this was asked.`);
    const to = await roster.supervisorFor(caller.project, lane.opener);
    const parked = args.ready === true ? await parkAtCheckpoint(desk, caller.project, lane.id) : undefined;
    const ahead = args.ready === true ? await readAhead(desk, caller.project, lane) : { asks: [], facts: [], changes: false };
    const letter = letters.report(lane, summary, args.ready === true, strs(args.carried), { gate, parked, ...ahead });
    const posted = await ctx.post(to, letter);
    ctx.event(caller.project, { kind: "lane.report", lane: lane.id, ready: args.ready === true, gate: gate?.ok, to: to ?? null, text: posted === "nobody" ? letter.text : undefined });
    // With nobody supervising seated the post goes nowhere; it is kept in the event log and the Lead told so.
    if (posted === "nobody") {
      return ok(`Nobody supervising this project is seated, so the report reached no one. It is kept in ${caller.project.state}/events.log for whoever comes back; there is nothing to wait for until someone does.`);
    }
    // Its reviews only: the rest may name an incident, which never reaches the seat it could be about.
    const reviews = args.ready === true ? reviewFacts(loadLedger(caller.project.state), lane) : [];
    const also = reviews.length > 0 ? ` It also carries what the record has of the lane's reviews: ${reviews.join(" ")}` : "";
    return ok(`Reported to ${to}${gate && !gate.ok ? ", with what the gate did in it" : ""}.${also} Stay quiet until mail arrives.`);
  },
});
