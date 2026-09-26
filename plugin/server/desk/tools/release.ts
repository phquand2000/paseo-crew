import { recordEvent } from "../store/event-log.ts";
import { z } from "zod";
import { IN_QUEUE } from "../../domain/task.ts";
import { no, ok, str } from "../context.ts";
import { letGo } from "../gone.ts";
import { releaseKept } from "../kept.ts";
import { findLane, loadLedger } from "../ledger.ts";
import { defineTool } from "../services.ts";
import { laneTask } from "../access.ts";

/** A Lead lets go of the Peer kept from a task it accepted, and of a copy of its own with it; the lane's Peers all go when it closes. */
export const releasePeer = defineTool({
  name: "release",
  input: z.strictObject({ task: z.string() }),
  async handle(desk, caller, args) {
    const { roster, agents } = desk;
    const { project } = caller;
    const ledger = loadLedger(project.state);
    const found = laneTask(ledger, caller, str(args.task));
    if (typeof found === "string") return no(found);
    const { lane, task } = found;
    if (task.kind === "review") return no(`${task.id} is a review: its reviewer goes when you cut it.`);
    if (task.status === "cut") return no(`${task.id} was cut, and its Peer stopped with it.`);
    if (IN_QUEUE.includes(task.status))
      return no(`${task.id} is in the merge queue: release its Peer once MERGED arrives.`);
    if (task.status !== "merged")
      return no(`${task.id} is ${task.status}: accept it first, or cut it, which stops its Peer.`);
    const peer = task.peer!;
    if (!(await roster.seated(peer))) return no(`The Peer kept from ${task.id} is gone already.`);
    const reading = Object.values(ledger.tasks).find(
      (other) =>
        other.kind === "review" && other.of === task.id && other.slot === task.slot && other.status === "running",
    );
    if (task.mode === "parallel" && reading)
      return no(`${reading.id} still reviews ${task.id} in its copy: cut it first.`);
    if (task.mode === "parallel") await agents.retire(project, task, lane.branch);
    else await letGo(desk, roster, project, peer);
    recordEvent(project, { kind: "seat.released", seat: peer, of: task.id });
    return ok(
      `The Peer kept from ${task.id} is released${task.mode === "parallel" ? `, and its copy ${task.slot} is put away with it` : ""}.`,
    );
  },
});

/** Whoever supervises lets go of the Lead kept from a closed lane, and of the copy it kept. */
export const releaseLead = defineTool({
  name: "release",
  input: z.strictObject({ lane: z.string() }),
  async handle(desk, caller, args) {
    const lane = findLane(loadLedger(caller.project.state), str(args.lane));
    if (!lane) return no(`There is no lane ${str(args.lane)}.`);
    if (lane.status !== "closed")
      return no(
        `Lane ${lane.id} is ${lane.status}: land_lane or drop_lane it first. replace_lead swaps a Lead that is gone.`,
      );
    const released = await releaseKept(desk, caller.project, lane);
    return released ? ok(released) : no(`Lane ${lane.id}'s Lead is gone already, and nothing of it is kept.`);
  },
});
