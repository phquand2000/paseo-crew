import { z } from "zod";
import { can } from "../../catalog/kit/roles.ts";
import { currentBranch, headSha, uncommittedPaths } from "../../core/git.ts";
import { ok } from "../context.ts";
import { leadLaneOf } from "../../domain/ledger.ts";
import { loadLedger } from "../store/ledger.ts";
import { loadConfig } from "../project/project.ts";
import { defineTool } from "../services.ts";
import { deniedLines } from "../views/denials.ts";
import { type OwnCheckout, statusText } from "../views/status.ts";

async function ownCopy(root: string): Promise<OwnCheckout> {
  const branch = await currentBranch(root);
  return {
    branch,
    head: branch ? undefined : (await headSha(root))?.slice(0, 7),
    work: await uncommittedPaths(root),
    tracked: await uncommittedPaths(root, false),
  };
}

/** A supervisor also sees the Human's own checkout, read from git only here, when it asks, and the writes a sandbox keeps refusing. */
export const status = defineTool({
  name: "status",
  input: z.strictObject({}),
  async handle({ roster, doing, teamFor }, caller) {
    const ledger = loadLedger(caller.project.state);
    const seats = new Map((await roster.open()).map((seat) => [seat.id, seat]));
    const led = can(caller.role, "lead") ? leadLaneOf(ledger, caller.id) : undefined;
    if (led?.status === "closed")
      return ok(
        `Lane ${led.id} (${led.title}) is closed${led.landed ? " and landed" : ""}. You are kept on with what you know of it until the owner releases you: nothing of it is yours to do.`,
      );
    const lane = led?.id;
    const supervises = can(caller.role, "supervise");
    const copy = supervises ? await ownCopy(caller.project.root) : undefined;
    const config = loadConfig(caller.project.state);
    const now = Date.now();
    const repeatsAt = teamFor(caller.project).attention.repeatsAt;
    const denied = supervises ? await deniedLines(caller.project.state, config, repeatsAt, now) : [];
    return ok(
      [statusText(caller.project, ledger, config, seats, now, { laneId: lane, copy, doing }), ...denied].join("\n"),
    );
  },
});
