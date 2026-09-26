import { join } from "node:path";
import type { Kit } from "../../catalog/kit/kit.ts";
import { seatOf } from "../../catalog/kit/roles.ts";
import { home, paseoHome, stateRoot } from "../../core/paths.ts";
import type { Seats } from "../../core/ports.ts";
import { type Project, projectOf } from "../../desk/project/project.ts";
import type { CleanView, MigrateView, UpdateView } from "../../../shared/upkeep-views.ts";
import { removeGarbage, scanGarbage } from "../../upkeep/clean.ts";
import { contentChanges, decide } from "../../upkeep/content.ts";
import { type LiveSeat, migrate, migrationPlan } from "../../upkeep/migrate.ts";
import { applyUpdate, checkUpdate, npmInstall, reloadSoon } from "../../upkeep/update.ts";
import type { TeamSource } from "../team-source.ts";
import type { UpkeepRpc } from "./rpc.ts";

type UpkeepDeps = { kit: Kit; source: TeamSource; seats: Seats; reconcile: () => void; changed: () => void };

/** The plugin's own upkeep on the panel: what it left behind, its updates, and the kit files the owner changed. */
export class UpkeepPanel implements UpkeepRpc {
  private readonly deps: UpkeepDeps;

  constructor(deps: UpkeepDeps) {
    this.deps = deps;
  }

  async clean(remove?: string[]): Promise<CleanView> {
    const { kit, source } = this.deps;
    const ctx = {
      kit,
      home: home(),
      known: source.known(),
      teamFor: (project: Project) => source.teamFor(project),
      live: await this.live(),
    };
    if (!remove) return { items: await scanGarbage(ctx), removed: [], failed: [] };
    const cleaned = await removeGarbage(ctx, remove);
    for (const project of ctx.known) if (!source.named(project.slug)) source.forget(project.slug);
    return cleaned;
  }

  async update(apply: boolean, fetch = true): Promise<UpdateView> {
    const counts = new Map<string, number>();
    for (const seat of await this.live()) counts.set(seat.slug, (counts.get(seat.slug) ?? 0) + 1);
    const busy = [...counts].map(([slug, count]) => `${slug} ${count} seat${count === 1 ? "" : "s"}`);
    const ctx = {
      dir: this.deps.kit.dir,
      managedRoot: join(paseoHome(), "plugins"),
      busy,
      install: npmInstall,
      reload: reloadSoon,
    };
    return apply ? applyUpdate(ctx) : checkUpdate(ctx, fetch);
  }

  async migrate(apply: boolean): Promise<MigrateView> {
    const { kit, source } = this.deps;
    const known = source.known();
    const ctx = {
      kit,
      home: home(),
      known,
      settings: [
        { where: "machine", file: source.machineFile() },
        ...known.map((project) => ({ where: project.slug, file: source.projectFile(project) })),
      ],
      live: await this.live(),
      now: Date.now(),
    };
    const content = await contentChanges(kit, stateRoot());
    if (!apply) return { ...migrationPlan(ctx), content };
    const done = migrate(ctx);
    this.deps.reconcile();
    return { ...done, content };
  }

  async decide(unit: string, choice: "new" | "mine" | "seen"): Promise<MigrateView> {
    await decide(this.deps.kit, stateRoot(), unit, choice);
    // A seat's skills are read when it is built: the next one follows the answer.
    this.deps.changed();
    return this.migrate(false);
  }

  private async live(): Promise<LiveSeat[]> {
    const seats = await this.deps.seats.open();
    return seats.flatMap((seat) => {
      const found = seatOf(this.deps.kit, seat.provider);
      if (!found) return [];
      const name = [found.role.label, found.harness.label, seat.title].filter(Boolean).join(" · ");
      return [
        { provider: seat.provider.split("/")[0]!, slug: projectOf(seat.cwd).slug, createdAt: seat.createdAt, name },
      ];
    });
  }
}
