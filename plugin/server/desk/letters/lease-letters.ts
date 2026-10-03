import { clock } from "../views/lease-lines.ts";
import { type Letter, fyi, mail } from "./envelope.ts";

/** What the desk mails a seat about a lease it holds or waits for. */
export const leaseLetters = {
  /** It reached the head of the queue: the lease is its now, so it may go on with the work that waited. */
  granted(resource: string, until: number): Letter {
    const text = `LEASE ${resource}: it is yours now, until ${clock(until)}, handed on from its queue.`;
    return mail("lease", [resource, until], text, `Use ${resource}, then call lease with release true once done.`);
  },
  /** The desk took the lease or its place in the queue, which asks nothing of it until it next needs the resource. */
  ended(resource: string, why: string, held: boolean, at: number): Letter {
    const what = held ? "It is no longer yours" : "You no longer wait for it";
    const text = `LEASE ENDED ${resource}: ${why}. ${what}.`;
    return fyi(mail("leaseended", [resource, at], text, `Before you use ${resource} again, take it with lease.`));
  },
};
