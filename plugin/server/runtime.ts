import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginHookContext, PluginLifecycleEvents, PluginServerContext } from "@getpaseo/plugin/server";
import { type Ask, dropAgent, dueReminders, loadAsks, markReminded, saveAsks, settle } from "./asks.ts";
import { renderPrompt } from "./content.ts";
import { decide } from "./decide.ts";
import { type Kit, type RoleSpec, entryRole, roleOf } from "./kit.ts";
import { applyRole, launchRefusal, seatEnv } from "./launch.ts";
import { letters } from "./messages.ts";
import { type Letter, Outbox, type PaseoApi } from "./outbox.ts";
import { guidesDir, outboxPath, stateRoot } from "./paths.ts";
import { type Project, projectOf } from "./project.ts";
import { applyReconcile, reloadDaemon } from "./providers.ts";
import { ensureLink, materialize, seatDir, seedRecords } from "./seats.ts";
import { type Seat, parentOf, stalledLeads, statusText } from "./stall.ts";

type EventName = keyof PluginLifecycleEvents;

export class Runtime {
  readonly kit: Kit;
  readonly outbox: Outbox;
  private api: PaseoApi | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly flagged = new Map<string, string>();
  private readonly seated = new Set<string>();

  constructor(kit: Kit, outboxFile = outboxPath()) {
    this.kit = kit;
    this.outbox = new Outbox(outboxFile, (to, list) => this.compose(to, list));
  }

  prepare(): void {
    try {
      mkdirSync(stateRoot(), { recursive: true });
      ensureLink(guidesDir(), join(this.kit.dir, "content", "guides"));
    } catch (error) {
      console.error("seatworks-v2: could not link the guides directory:", error);
    }
    for (const role of this.kit.roles) this.ensureSeat(role);
    try {
      const changed = applyReconcile(this.kit);
      if (changed.length > 0) {
        console.log(`seatworks-v2: config updated (${changed.join(", ")}); reloading the daemon`);
        void reloadDaemon();
      }
    } catch (error) {
      console.error("seatworks-v2: could not reconcile role providers:", error);
    }
  }

  ensureSeat(role: RoleSpec): void {
    if (this.seated.has(role.role)) return;
    try {
      const changes = materialize(this.kit, role);
      if (changes.length > 0) console.log(`seatworks-v2: seat ${role.role} updated: ${changes.join(", ")}`);
      this.seated.add(role.role);
    } catch (error) {
      console.error(`seatworks-v2: seat ${role.role} could not be built:`, error);
    }
  }

  log(project: Project, line: string): void {
    try {
      mkdirSync(project.state, { recursive: true });
      appendFileSync(join(project.state, "attention.log"), `${new Date().toISOString()}  ${line}\n`);
    } catch (error) {
      console.error("seatworks-v2: attention log write failed:", error);
    }
  }

  private async compose(to: string, list: Letter[]): Promise<string> {
    const text = list.map((letter) => letter.text).join("\n\n---\n\n");
    if (!this.api) return text;
    const handle = this.api.agents.ref(to);
    await handle.refresh();
    const snapshot = handle.current();
    const role = roleOf(this.kit, snapshot?.provider);
    if (!role?.entry || !snapshot?.cwd) return text;
    const open = letters.openAsks(loadAsks(projectOf(snapshot.cwd).state));
    return open ? `${text}\n\n---\n\n${open}` : text;
  }

  private on<N extends EventName>(
    server: PluginServerContext,
    name: N,
    handler: (event: PluginLifecycleEvents[N], context: PluginHookContext) => Promise<void>,
  ): void {
    server.on(name, async (event, context) => {
      this.api = context.paseo;
      try {
        await handler(event, context);
      } catch (error) {
        console.error(`seatworks-v2: ${name} handler failed:`, error);
      }
    });
  }

  register(server: PluginServerContext): void {
    server.before("agent.create", ({ request }) => {
      const role = roleOf(this.kit, request.config.provider);
      if (!role) return request;
      this.ensureSeat(role);
      const project = projectOf(request.config.cwd);
      const config = applyRole(this.kit, request.config, (entry) =>
        renderPrompt(this.kit, entry, { guides: guidesDir(), state: project.state }),
      );
      return { ...request, config };
    });

    server.before("agent.session_open", ({ request }) => {
      const role = roleOf(this.kit, request.provider);
      if (!role) return request;
      this.ensureSeat(role);
      const project = projectOf(request.cwd);
      try {
        const seeded = seedRecords(this.kit, project.state);
        if (seeded.length > 0) this.log(project, `seeded ${seeded.join(", ")}`);
      } catch (error) {
        console.error("seatworks-v2: could not seed project records:", error);
      }
      return seatEnv(this.kit, request, (entry) => seatDir(this.kit, entry), project);
    });

    this.on(server, "agent.created", async ({ agent }, { paseo }) => {
      if (!agent.parentAgentId || !roleOf(this.kit, agent.provider)) return;
      const parent = paseo.agents.ref(agent.parentAgentId);
      await parent.refresh();
      const refusal = launchRefusal(this.kit, parent.current()?.provider, agent.provider);
      if (!refusal) return;
      await paseo.agents.ref(agent.id).archive();
      const project = projectOf(agent.cwd);
      this.log(project, `refused ${refusal.child.role} ${agent.id} started by ${refusal.parent.role} ${agent.parentAgentId}`);
      await this.outbox.post(paseo, {
        to: agent.parentAgentId,
        key: `refused:${agent.id}`,
        text: letters.refused(refusal.parent.role, refusal.child.role, refusal.parent.mayStart ?? []),
      });
    });

    this.on(server, "agent.turn_ended", async ({ agent, turnId, outcome, timeline }, { paseo }) => {
      this.outbox.turnEnded(agent.id);
      const role = roleOf(this.kit, agent.provider);
      if (role) {
        const project = projectOf(agent.cwd);
        const decision = decide({ role, agent, turnId, outcome, timeline });
        if (decision.requests !== null) {
          const result = settle(loadAsks(project.state), agent.id, agent.title ?? agent.id, decision.requests, Date.now());
          if (result.opened.length > 0 || result.closed.length > 0) {
            saveAsks(project.state, result.asks);
            for (const ask of result.opened) this.log(project, `open ${ask.kind} ${ask.id}`);
            for (const ask of result.closed) this.log(project, `closed ${ask.kind} ${ask.id}`);
          }
        }
        for (const letter of decision.letters) {
          const posted = await this.outbox.post(paseo, letter);
          this.log(project, `letter ${letter.key} ${agent.id} -> ${letter.to}: ${posted}`);
        }
      }
      await this.outbox.pump(paseo, agent.id);
    });

    this.on(server, "agent.permission_requested", async ({ agent, request }, { paseo }) => {
      const role = roleOf(this.kit, agent.provider);
      if (!role || !agent.parentAgentId) return;
      await this.outbox.post(paseo, {
        to: agent.parentAgentId,
        key: `permission:${agent.id}:${request.id}`,
        text: letters.permission(agent.title, agent.id, role.role, request.kind, request.title ?? request.name),
      });
    });

    this.on(server, "agent.archived", async ({ agent }) => {
      this.outbox.archived(agent.id);
      this.flagged.delete(agent.id);
      if (!roleOf(this.kit, agent.provider)) return;
      const project = projectOf(agent.cwd);
      const asks = loadAsks(project.state);
      const kept = dropAgent(asks, agent.id);
      if (kept.length !== asks.length) saveAsks(project.state, kept);
    });

    this.timer = setInterval(() => {
      this.tick().catch((error) => console.error("seatworks-v2: tick failed:", error));
    }, this.kit.attention.tickSeconds * 1000);
  }

  async tick(now = Date.now()): Promise<void> {
    const paseo = this.api;
    if (!paseo) return;
    const { entries } = await paseo.agents.list({ filter: { includeArchived: false } });
    const seats = entries.map((entry) => entry.agent as unknown as Seat).filter((seat) => !seat.archivedAt);
    const ours = seats.filter((seat) => roleOf(this.kit, seat.provider));
    const byProject = new Map<string, { project: Project; seats: Seat[] }>();
    for (const seat of ours) {
      const project = projectOf(seat.cwd);
      const group = byProject.get(project.slug) ?? { project, seats: [] };
      group.seats.push(seat);
      byProject.set(project.slug, group);
    }
    const entry = entryRole(this.kit);
    const { leadIdleMinutes, askRemindMinutes, maxReminders } = this.kit.attention;
    for (const { project, seats: group } of byProject.values()) {
      const leads = group.filter((seat) => roleOf(this.kit, seat.provider)?.reports === "blocks");
      const asks = loadAsks(project.state);
      const upward = (lead: Seat): string | undefined => {
        const parent = parentOf(lead);
        if (parent && group.some((seat) => seat.id === parent)) return parent;
        return group
          .filter((seat) => entry && roleOf(this.kit, seat.provider)?.role === entry.role)
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]?.id;
      };
      for (const lead of stalledLeads(leads, group, asks, now, leadIdleMinutes * 60_000, this.flagged)) {
        this.flagged.set(lead.id, lead.updatedAt);
        const to = upward(lead);
        if (!to) continue;
        const minutes = Math.round((now - Date.parse(lead.updatedAt)) / 60_000);
        const posted = await this.outbox.post(paseo, { to, key: `stalled:${lead.id}:${lead.updatedAt}`, text: letters.stalled(lead.title, lead.id, minutes) });
        this.log(project, `stalled ${lead.id} ${minutes}m -> ${to}: ${posted}`);
      }
      const due = dueReminders(asks, now, askRemindMinutes * 60_000, maxReminders).filter((ask) =>
        leads.some((lead) => lead.id === ask.agentId && lead.status === "idle"),
      );
      if (due.length > 0) {
        for (const ask of due) {
          const lead = leads.find((seat) => seat.id === ask.agentId);
          const to = lead ? upward(lead) : undefined;
          if (!to) continue;
          const minutes = Math.round((now - ask.openedAt) / 60_000);
          await this.outbox.post(paseo, { to, key: `reminder:${ask.id}:${ask.reminders}`, text: letters.reminder(ask, minutes) });
        }
        saveAsks(project.state, markReminded(asks, new Set(due.map((ask) => ask.id)), now));
      }
      try {
        mkdirSync(project.state, { recursive: true });
        writeFileSync(join(project.state, "status.md"), statusText(project.root, leads, group, loadAsks(project.state), now));
      } catch (error) {
        console.error("seatworks-v2: status write failed:", error);
      }
    }
    const targets = new Set(this.outbox.letters().map((letter) => letter.to));
    for (const to of targets) await this.outbox.pump(paseo, to);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

export type { Ask };
