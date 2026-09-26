import { z } from "zod";
import { can } from "../../catalog/kit/roles.ts";
import { currentBranch, headSha, uncommittedPaths } from "../../core/git.ts";
import { hash } from "../../core/text.ts";
import { ok } from "../context.ts";
import { leadLaneOf, loadLedger } from "../store/ledger.ts";
import { loadConfig } from "../project.ts";
import { defineTool } from "../services.ts";
import { type OwnCheckout, statusText } from "../views/status.ts";

async function ownCopy(root: string): Promise<OwnCheckout> {
  const branch = await currentBranch(root);
  return { branch, head: branch ? undefined : (await headSha(root))?.slice(0, 7), work: await uncommittedPaths(root) };
}

/** A supervisor also sees the Human's own checkout, read from git only here, when it asks. */
export const status = defineTool({
  name: "status",
  input: z.strictObject({}),
  async handle({ lastStatus, roster }, caller) {
    const ledger = loadLedger(caller.project.state);
    const seats = new Map((await roster.open()).map((seat) => [seat.id, seat]));
    const led = can(caller.role, "lead") ? leadLaneOf(ledger, caller.id) : undefined;
    if (led?.status === "closed")
      return ok(
        `Lane ${led.id} (${led.title}) is closed${led.landed ? " and landed" : ""}. You are kept on with what you know of it until the owner releases you: nothing of it is yours to do.`,
      );
    const lane = led?.id;
    const copy = can(caller.role, "supervise") ? await ownCopy(caller.project.root) : undefined;
    const text = statusText(caller.project, ledger, loadConfig(caller.project.state), seats, Date.now(), {
      laneId: lane,
      copy,
    });
    if (lastStatus.get(caller.id) === hash(text))
      return ok("Nothing has changed since you last asked: end your turn, and mail wakes you when something does.");
    lastStatus.set(caller.id, hash(text));
    return ok(text);
  },
});
