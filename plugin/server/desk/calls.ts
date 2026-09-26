import { schemaOf, seatOf } from "../catalog/kit/roles.ts";
import { errorText } from "../core/errors.ts";
import { sortKeys } from "../core/json.ts";
import { clip } from "../core/text.ts";
import { argsProblems, shapeOf, withoutNulls } from "./args.ts";
import { type Args, type Caller, type ToolReply, type ToolRequest, no } from "./context.ts";
import { inTime } from "./in-time.ts";
import { messageLetters } from "./letters/message-letters.ts";
import { projectOf } from "./project.ts";
import { type DeskServices, type ToolDef, servedBy } from "./services.ts";
import { recordEvent } from "./store/event-log.ts";

/** How long a harness waits on one call before it gives up; the desk answers first. */
export const ANSWER_WITHIN_MS = 240_000;

/** The tools a seat says something with; any other call only shows it was heard from. */
const SPEAKS = ["done", "ask", "answer", "message", "report"];

type Mail = Parameters<typeof inTime>[3];

/** A seat's tool calls: who is calling, whether the call fits what the seat was shown, and its reply in time or as mail. */
export class ToolCalls {
  private readonly running = new Map<string, { reply: Promise<ToolReply>; started: number }>();
  private readonly desk: DeskServices;
  private readonly tools: ToolDef[];
  private readonly mail: Mail;

  constructor(desk: DeskServices, tools: ToolDef[], mail: Mail) {
    this.desk = desk;
    this.tools = tools;
    this.mail = mail;
  }

  /** Whether a call from this seat is still being worked on — which is not silence. */
  inFlight(agentId: string): boolean {
    return [...this.running.keys()].some((key) => key.startsWith(`${agentId}\n`));
  }

  /**
   * A harness waits minutes for a call but a gate may run thirty: a call that runs long is answered with what is happening
   * and its result mailed, and the same call again while it runs joins it. One its caller gives up on is mailed too.
   */
  answer(
    request: ToolRequest,
    { within = ANSWER_WITHIN_MS, cancelled }: { within?: number; cancelled?: AbortSignal } = {},
  ): Promise<ToolReply> {
    const key = `${request.agent}\n${request.tool}\n${JSON.stringify(sortKeys(request.args ?? {}))}`;
    const running = this.running.get(key);
    if (running)
      return inTime(request, running.reply, { started: running.started, within, again: true, cancelled }, this.mail);
    const started = Date.now();
    // A throw is answered too: only a resolved reply posts the letter the seat was promised.
    const reply = this.handle(request)
      .catch((error: unknown) => no(`The desk failed: ${errorText(error)}`))
      .finally(() => {
        if (this.running.get(key)?.started === started) this.running.delete(key);
      });
    this.running.set(key, { reply, started });
    return inTime(request, reply, { started, within, again: false, cancelled }, this.mail);
  }

  /** A reply that went out but never reached its seat, whose call was stopped or whose line dropped: mailed instead. */
  mailLost(request: ToolRequest, reply: ToolReply): Promise<unknown> {
    const call = { agent: request.agent, tool: request.tool, started: request.at };
    return this.desk.mail.post(request.agent, messageLetters.later(call, reply, true));
  }

  async handle(request: ToolRequest): Promise<ToolReply> {
    const caller = await this.caller(request);
    if ("error" in caller) return no(caller.error);
    const reply = await this.run(caller, request);
    const text = clip(reply.text, 300);
    recordEvent(caller.project, {
      kind: "tool",
      agent: caller.id,
      role: caller.role.role,
      tool: request.tool,
      ok: reply.ok,
      reply: text,
    });
    if (reply.ok) this.heardFrom(caller, request.tool);
    return reply;
  }

  /** The tool's reply, or why it was not carried out: a tool the seat was not shown, args that miss its schema, a crash. */
  private async run(caller: Caller, request: ToolRequest): Promise<ToolReply> {
    const shown = schemaOf(this.desk.kit, caller.role, request.tool);
    const tool = shown ? servedBy(this.tools, request.tool, shown) : undefined;
    if (!shown || !tool) return no(`Unknown tool ${request.tool}.`);
    const args = (request.args ?? {}) as Args;
    const problems = argsProblems(shown, args);
    if (problems.length > 0)
      return no(`${request.tool} was not carried out: it ${problems.join("; ")}. ${shapeOf(shown)}`);
    try {
      return await tool.handle(this.desk, caller, tool.input.parse(withoutNulls(args)));
    } catch (error) {
      this.desk.log(caller.project, `${caller.role.role} ${caller.id} ${request.tool} crashed: ${errorText(error)}`);
      return no(`${request.tool} failed: ${errorText(error)}`);
    }
  }

  /** Notes that the seat was heard from; noting it must not turn a reply it has earned into a crash. */
  private heardFrom(caller: Caller, tool: string): void {
    try {
      this.desk.ledgers.transact(caller.project, (ledger) => {
        const ref = ledger.agents[caller.id] ?? { id: caller.id, role: caller.role.role };
        ref.recordedAt = Date.now();
        if (SPEAKS.includes(tool)) ref.spokeAt = ref.recordedAt;
        ledger.agents[caller.id] = ref;
      });
    } catch (error) {
      this.desk.log(caller.project, `could not record that ${caller.id} was heard from: ${errorText(error)}`);
    }
  }

  private async caller(request: ToolRequest): Promise<Caller | { error: string }> {
    if (!request.agent) return { error: "This tool works only inside a team agent." };
    const seat = await this.desk.roster.look(request.agent);
    const role = seatOf(this.desk.kit, seat.provider)?.role;
    if (!role?.tools) return { error: "This agent is not part of the team." };
    if (role.role !== request.role)
      return { error: `This agent is a ${role.label}, so ${request.role} tools are not available to it.` };
    const project = projectOf(seat.cwd ?? request.cwd);
    return { id: request.agent, role, title: seat.title ?? request.agent, project };
  }
}
