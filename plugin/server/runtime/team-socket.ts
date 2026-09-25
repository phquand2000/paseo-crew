import { randomUUID } from "node:crypto";
import { chmodSync, rmSync } from "node:fs";
import { type Server, type Socket, createServer } from "node:net";
import { createInterface } from "node:readline";
import { z } from "zod";
import type { ToolReply, ToolRequest } from "../desk/context.ts";

/** What a seat's team server says on its line, one JSON object a line: who it is, a call, a call its harness stopped, an answer it took. */
const Heard = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), key: z.string(), role: z.string(), cwd: z.string() }),
  z.object({ type: z.literal("call"), id: z.string(), tool: z.string(), args: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal("cancel"), id: z.string() }),
  z.object({ type: z.literal("taken"), id: z.string() }),
]);

type Choices = Record<string, Record<string, string[]>>;

/** What the lines need of the desk: whose a key is, the sets a role's fields take, the calls, and a lost answer's letter. */
type LineDesk = {
  agentOf(key: string): string | undefined;
  choices(role: string, cwd: string): Choices;
  answer(request: ToolRequest, cancelled: AbortSignal): Promise<ToolReply>;
  mailLost(request: ToolRequest, reply: ToolReply): Promise<unknown>;
};

type Call = { request: ToolRequest; stop: AbortController; reply?: ToolReply };
type Line = { socket: Socket; agent?: string; role: string; cwd: string; shown?: string; calls: Map<string, Call> };

const UNKNOWN =
  "The desk does not know this agent's key, so it carries out nothing from it: the agent was started before the desk knew its agents by key. Say so, and ask for it to be archived and started again.";

/** Where seats' team servers reach the desk: one line each, a call answered on the line it came by. */
export class TeamSocket {
  private readonly path: string;
  private readonly desk: LineDesk;
  private readonly lines = new Set<Line>();
  private server: Server | undefined;

  constructor(path: string, desk: LineDesk) {
    this.path = path;
    this.desk = desk;
  }

  /** A socket file left by a plugin that stopped without closing it is taken over. */
  listen(): void {
    rmSync(this.path, { force: true });
    const server = createServer((socket) => this.serve(socket));
    server.on("error", (error) => console.error("seatworks-v2: the desk's socket failed:", error));
    server.listen(this.path, () => chmodSync(this.path, 0o600));
    this.server = server;
  }

  close(): void {
    this.server?.close();
    this.server = undefined;
    for (const line of this.lines) line.socket.destroy();
    rmSync(this.path, { force: true });
  }

  /** Whether the agent waits on a call: answered or not, until its server says the harness took the answer. */
  calling(agent: string): boolean {
    return [...this.lines].some((line) => line.agent === agent && line.calls.size > 0);
  }

  /** The sets seats' fields take may have changed: a line whose set did is sent the new one. */
  refresh(): void {
    for (const line of this.lines) if (line.agent) this.offer(line, "choices");
  }

  private serve(socket: Socket): void {
    const line: Line = { socket, role: "", cwd: "", calls: new Map() };
    this.lines.add(line);
    // readline passes on the socket's errors: a line that fails is closed, and `dropped` sees to its calls.
    createInterface({ input: socket }).on("line", (text) => this.heard(line, text)).on("error", () => {});
    socket.on("error", () => {});
    socket.on("close", () => this.dropped(line));
  }

  private heard(line: Line, text: string): void {
    let said: z.infer<typeof Heard>;
    try {
      said = Heard.parse(JSON.parse(text));
    } catch {
      return;
    }
    if (said.type === "hello") return this.hello(line, said);
    if (said.type === "call") return this.call(line, said);
    const call = line.calls.get(said.id);
    line.calls.delete(said.id);
    if (call && said.type === "cancel") this.lose(call);
  }

  private hello(line: Line, said: { key: string; role: string; cwd: string }): void {
    if (line.agent) return;
    const agent = this.desk.agentOf(said.key);
    if (!agent) return this.send(line, { type: "refused", why: UNKNOWN });
    Object.assign(line, { agent, role: said.role, cwd: said.cwd });
    this.offer(line, "welcome");
  }

  private offer(line: Line, type: "welcome" | "choices"): void {
    const choices = this.desk.choices(line.role, line.cwd);
    const shown = JSON.stringify(choices);
    if (type === "choices" && shown === line.shown) return;
    line.shown = shown;
    this.send(line, { type, choices });
  }

  private call(line: Line, said: { id: string; tool: string; args: Record<string, unknown> }): void {
    if (!line.agent) return this.send(line, { type: "result", id: said.id, ok: false, text: UNKNOWN });
    const call: Call = { request: { id: randomUUID(), agent: line.agent, role: line.role, tool: said.tool, args: said.args, cwd: line.cwd, at: Date.now() }, stop: new AbortController() };
    line.calls.set(said.id, call);
    void this.desk.answer(call.request, call.stop.signal).then((reply) => {
      // Stopped, or its line gone: that answer goes as a letter instead.
      if (line.calls.get(said.id) !== call) return;
      call.reply = reply;
      this.send(line, { type: "result", id: said.id, ...reply });
    });
  }

  /** A call whose seat will not take its answer here: stopped before it came, the desk mails it when it does; after, it is mailed now. */
  private lose(call: Call): void {
    if (call.reply) void this.desk.mailLost(call.request, call.reply);
    else call.stop.abort();
  }

  private dropped(line: Line): void {
    this.lines.delete(line);
    for (const call of line.calls.values()) this.lose(call);
    line.calls.clear();
  }

  private send(line: Line, message: object): void {
    if (!line.socket.destroyed) line.socket.write(`${JSON.stringify(message)}\n`);
  }
}
