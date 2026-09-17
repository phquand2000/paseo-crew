import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Kit } from "../catalog/kit.ts";
import { type Layer, MachineLayerSchema, ProjectLayerSchema, layerValues, readLayer } from "../catalog/settings.ts";
import { type Team, resolveTeam } from "../catalog/team.ts";
import { stateRoot } from "../core/paths.ts";
import { readJson, writeJson } from "../core/store.ts";
import type { Project } from "../desk/project.ts";

export class TeamSource {
  private readonly kit: Kit;
  private readonly recorded = new Set<string>();

  constructor(kit: Kit) {
    this.kit = kit;
  }

  machineFile(): string {
    return join(stateRoot(), "settings.json");
  }

  projectFile(project: Project): string {
    return join(project.state, "settings.json");
  }

  machineLayer(): Layer {
    return layerValues(this.machineFile(), MachineLayerSchema);
  }

  teamFor(project?: Project): Team {
    const local = project ? layerValues(this.projectFile(project), ProjectLayerSchema) : {};
    return resolveTeam(this.kit, this.machineLayer(), local);
  }

  revision(project?: Project): string {
    const machine = readLayer(this.machineFile(), MachineLayerSchema).revision;
    const local = project ? readLayer(this.projectFile(project), ProjectLayerSchema).revision : "";
    return `${machine}:${local}`;
  }

  record(project: Project): void {
    // The Set is a way of not writing the same file every turn, not proof that the file is there: a
    // project detached in this same session left the record behind and the next attach wrote nothing,
    // reported success, and opened a screen for a project no handler could find.
    if (this.recorded.has(project.slug) && existsSync(join(project.state, "meta.json"))) return;
    try {
      mkdirSync(project.state, { recursive: true });
      writeJson(join(project.state, "meta.json"), { root: project.root, slug: project.slug });
      this.recorded.add(project.slug);
    } catch (error) {
      console.error("seatworks-v2: could not record the project:", error);
    }
  }

  /** A project that is no longer on record: the next attach has to write it again. */
  forget(slug: string): void {
    this.recorded.delete(slug);
  }

  known(): Project[] {
    const root = join(stateRoot(), "projects");
    if (!existsSync(root)) return [];
    const found: Project[] = [];
    for (const slug of readdirSync(root)) {
      const meta = readJson<{ root?: string; slug?: string }>(join(root, slug, "meta.json"), {});
      if (typeof meta.root === "string" && meta.slug === slug) found.push({ root: meta.root, slug, state: join(root, slug) });
    }
    return found.sort((a, b) => a.slug.localeCompare(b.slug));
  }

  named(slug: string): Project | undefined {
    return this.known().find((project) => project.slug === slug);
  }
}
