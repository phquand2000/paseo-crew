import { z } from "zod";
import { no, ok, str } from "../context.ts";
import { putOnHold } from "../hold.ts";
import { defineTool } from "../services.ts";

/** Stops a lane where it stands: each of its seats is cut short now, reads nothing more, and nothing in it starts or lands until resume_lane. */
export const holdLane = defineTool({
  name: "hold_lane",
  input: z.strictObject({ lane: z.string(), reason: z.string() }),
  async handle(desk, caller, args) {
    const held = await putOnHold(desk, caller.project, str(args.lane), caller.id, str(args.reason));
    if (typeof held === "string") return no(held);
    const landing = held.calledOff ? " The landing it was waiting on is called off: land it again once it resumes." : "";
    return ok(`Lane ${held.lane.id} is on hold. ${held.stopped.length} of its seats were told to stop: where their agent allows it the running turn was cut short, else they stop when it ends. Nothing reaches them, no task starts and nothing lands until resume_lane.${landing}`);
  },
});
