import { z } from "zod";
import { releaseKept, releaseKeptPeer } from "../seats/kept.ts";
import { defineTool } from "../services.ts";

/** A Lead lets go of the Peer kept from a task it accepted; the lane's Peers all go when it closes. */
export const releasePeer = defineTool({
  name: "release",
  input: z.strictObject({ task: z.string() }),
  handle: (desk, caller, args) => releaseKeptPeer(desk, caller, args),
});

/** Whoever supervises lets go of a lane's Lead, or of the Peer kept from a task in any lane. */
export const releaseLead = defineTool({
  name: "release",
  input: z.strictObject({ lane: z.string().optional(), task: z.string().optional() }),
  handle: (desk, caller, args) => releaseKept(desk, caller, args),
});
