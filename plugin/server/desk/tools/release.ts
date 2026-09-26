import { z } from "zod";
import { releaseKeptLead, releaseKeptPeer } from "../kept.ts";
import { defineTool } from "../services.ts";

/** A Lead lets go of the Peer kept from a task it accepted; the lane's Peers all go when it closes. */
export const releasePeer = defineTool({
  name: "release",
  input: z.strictObject({ task: z.string() }),
  handle: (desk, caller, args) => releaseKeptPeer(desk, caller, args),
});

/** Whoever supervises lets go of the Lead kept from a closed lane, and of the copy it kept. */
export const releaseLead = defineTool({
  name: "release",
  input: z.strictObject({ lane: z.string() }),
  handle: (desk, caller, args) => releaseKeptLead(desk, caller, args),
});
