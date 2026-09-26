import { tmpdir } from "node:os";
import { type Kit, TEAM_SERVER, seatOf, watchPatterns } from "../catalog/kit.ts";
import { errorText } from "../core/errors.ts";
import type { TurnEnded } from "../core/ports.ts";
import type { Desk } from "../desk/desk.ts";
import { laneOfLead, loadLedger, taskOfPeer } from "../desk/ledger.ts";
import { type Project, gateCommands, loadConfig, projectOf } from "../desk/project.ts";
import type { TeamSource } from "./team-source.ts";
import { malformed } from "./timeline.ts";
import type { Trouble } from "./watch-view.ts";
import { type Fact, callsTo } from "./watch/facts.ts";
import { decide } from "./watch/findings.ts";
import type { SeatContext, SeatWatch, WatchedSeat, Watches } from "./watch/watches.ts";

const TROUBLES = 10;

type WatchingDeps = { kit: Kit; source: TeamSource; desk: Desk; watches: () => Watches };

/** Between the watch and the desk: what the watch reads of a seat, what it noticed, and trouble shown on screen rather than mailed. */
export class Watching {
  private readonly deps: WatchingDeps;
  private readonly troubles = new Map<string, Trouble[]>();

  constructor(deps: WatchingDeps) {
    this.deps = deps;
  }

  troublesOf(project: Project): Trouble[] {
    return this.troubles.get(project.slug) ?? [];
  }

  /** What the watch reads of a seat: whether it is placed, and the rules it is held to. */
  context(seat: WatchedSeat): SeatContext | undefined {
    const found = seatOf(this.deps.kit, seat.provider);
    if (!found) return undefined;
    const project = projectOf(seat.cwd);
    const attention = this.deps.source.teamFor(project).attention;
    let scope: string[] | undefined;
    let placed = false;
    try {
      const ledger = loadLedger(project.state);
      const task = taskOfPeer(ledger, seat.id);
      scope =
        task?.kind !== "code" ? undefined : task.mode === "parallel" ? task.holds : ledger.lanes[task.lane]?.writeSet;
      placed = Boolean(task ?? laneOfLead(ledger, seat.id));
    } catch (error) {
      this.deps.desk.event(project, { kind: "watch.unbriefed", agent: seat.id, error: errorText(error) });
    }
    return {
      placed,
      rules: {
        ...watchPatterns(this.deps.kit, attention),
        desk: callsTo(found.harness.mcpCall, found.harness.mcpServerField, TEAM_SERVER),
        gates: gateCommands(seat.cwd, loadConfig(project.state).gate, this.deps.kit.ecosystem),
        cwd: seat.cwd,
        temp: tmpdir(),
        scope,
        repeatsAt: attention.repeatsAt,
        recoverWithin: 10,
      },
      handedBack: (at) => {
        try {
          const handback = taskOfPeer(loadLedger(project.state), seat.id)?.handback;
          return handback && handback.at >= at && !handback.gate ? handback.outcome : undefined;
        } catch {
          return undefined;
        }
      },
    };
  }

  private noticed(watch: SeatWatch, facts: Fact[]): void {
    if (this.deps.watches().get(watch.seat.id) !== watch) return;
    const moment = { facts, instruction: watch.window.instruction(), turn: watch.turnId };
    this.deps.desk
      .notice(projectOf(watch.seat.cwd), watch.seat, decide(facts), moment)
      .catch((error) => console.error("seatworks-v2: what the watch noticed could not be recorded:", error));
  }

  /** Trouble nobody is mailed about, kept where a screen can show it rather than only in the log. */
  private troubled(project: Project, kind: string, detail: string): void {
    const list = this.troubles.get(project.slug) ?? [];
    list.push({ kind, at: Date.now(), detail });
    if (list.length > TROUBLES) list.splice(0, list.length - TROUBLES);
    this.troubles.set(project.slug, list);
  }

  /** A call the harness refused because its input was not JSON; it never reaches the desk, so only this reports it. */
  malformedCalls(event: TurnEnded): void {
    const seat = seatOf(this.deps.kit, event.agent.provider);
    if (!seat?.role.tools) return;
    const project = projectOf(event.agent.cwd);
    for (const call of malformed(event.timeline, seat.harness.timeline?.unparsed)) {
      this.deps.desk.event(project, {
        kind: "call.malformed",
        agent: event.agent.id,
        role: seat.role.role,
        tool: call.tool,
        error: call.quote,
      });
      this.troubled(
        project,
        "call.malformed",
        `the ${seat.role.label}'s ${call.tool} was written with an input that is not JSON, and never reached the desk`,
      );
    }
  }

  /** Each fact goes on record, and what they add up to may open an incident. */
  found(watch: SeatWatch, facts: Fact[]): void {
    const project = projectOf(watch.seat.cwd);
    for (const fact of facts)
      this.deps.desk.event(project, {
        kind: "watch.fact",
        agent: watch.seat.id,
        fact: fact.kind,
        level: fact.level,
        quote: fact.quote,
      });
    this.noticed(watch, facts);
  }
}
