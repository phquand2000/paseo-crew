import type { ToolReply, ToolRequest } from "../context.ts";
import { ok } from "../context.ts";
import type { Intents } from "../store/intents.ts";
import { type Letter } from "../letters/envelope.ts";
import { messageLetters } from "../letters/message-letters.ts";

/** When the run began, how long this caller waits from its own call, and whether it joined a run already going. */
type Window = { started: number; within: number; again: boolean; cancelled?: AbortSignal };

/**
 * The reply if it comes within the window, else word that it arrives as mail: one letter for one run, whichever of its
 * callers stopped waiting first, kept on disk until it is posted.
 */
export function inTime(
  request: ToolRequest,
  reply: Promise<ToolReply>,
  how: Window,
  mail: { intents: Intents; post(to: string, letter: Letter): Promise<unknown> },
): Promise<ToolReply> {
  return new Promise((resolve) => {
    let answered = false;
    const mailed = (said: string, cut: boolean) => {
      if (answered) return;
      answered = true;
      clearTimeout(timer);
      resolve(ok(said));
      const promised = { agent: request.agent, tool: request.tool, started: how.started };
      mail.intents.promise(promised);
      void reply.then(async (done) => {
        await mail.post(request.agent, messageLetters.later(promised, done, cut));
        mail.intents.kept(promised);
      });
    };
    const long = how.again
      ? `That ${request.tool} call is already running from before. Its answer arrives as mail; there is nothing to call again.`
      : `The desk is still working on ${request.tool} — a gate can take as long as the project allows it. The answer arrives as mail. End your turn now; do not call ${request.tool} again.`;
    const timer = setTimeout(() => mailed(long, false), how.within);
    timer.unref?.();
    // A call stopped while it waited to be carried out was stopped before this listens, and the listener would never hear it.
    const stopped = () => mailed(`${request.tool} was stopped on the seat's side.`, true);
    if (how.cancelled?.aborted) stopped();
    else how.cancelled?.addEventListener("abort", stopped, { once: true });
    void reply.then((done) => {
      if (answered) return;
      answered = true;
      clearTimeout(timer);
      resolve(done);
    });
  });
}
