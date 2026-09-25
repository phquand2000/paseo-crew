import { z } from "zod";
import { no, ok, str } from "../context.ts";
import { letGo } from "../gone.ts";
import { releaseKept } from "../kept.ts";
import { findLane, loadLedger } from "../ledger.ts";
import { defineTool } from "../services.ts";
import { laneTask } from "./lane-task.ts";

/** A Lead lets go of the Peer kept from a task it accepted in the lane's copy; the lane's Peers all go when it closes. */
export const releasePeer = defineTool({
  name: "release",
  input: z.strictObject({ task: z.string() }),
  async handle({ ctx, roster }, caller, args) {
    const { project } = caller;
    const ledger = loadLedger(project.state);
    const found = laneTask(ledger, caller, str(args.task));
    if (typeof found === "string") return no(found);
    const { task } = found;
    if (task.kind === "review") return no(`${task.id} is a review: its reviewer goes when you cut it.`);
    if (task.mode === "parallel") return no(`${task.id} ran in a copy of its own, and its Peer goes with that copy once it is merged.`);
    if (task.status === "cut") return no(`${task.id} was cut, and its Peer stopped with it.`);
    if (task.status !== "merged") return no(`${task.id} is ${task.status}: accept it first, or cut it, which stops its Peer.`);
    const peer = task.peer!;
    const bound = ledger.agents[peer]?.task;
    if (bound && bound !== task.id) return no(`Its Peer went on to ${bound}; release it from there once ${bound} is accepted.`);
    if (!(await roster.seated(peer))) return no(`The Peer kept from ${task.id} is gone already.`);
    await letGo(ctx, roster, project, peer);
    ctx.event(project, { kind: "seat.released", seat: peer, of: task.id });
    return ok(`The Peer kept from ${task.id} is released; the next task in the lane's working copy starts a new one.`);
  },
});

/** Whoever supervises lets go of the Lead kept from a closed lane, and of the copy it kept. */
export const releaseLead = defineTool({
  name: "release",
  input: z.strictObject({ lane: z.string() }),
  async handle(desk, caller, args) {
    const lane = findLane(loadLedger(caller.project.state), str(args.lane));
    if (!lane) return no(`There is no lane ${str(args.lane)}.`);
    if (lane.status !== "closed") return no(`Lane ${lane.id} is ${lane.status}: land_lane or drop_lane it first. replace_lead swaps a Lead that is gone.`);
    const released = await releaseKept(desk, caller.project, lane);
    return released ? ok(released) : no(`Lane ${lane.id}'s Lead is gone already, and nothing of it is kept.`);
  },
});
