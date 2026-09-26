import type { Kit } from "../catalog/kit/kit.ts";
import { type ModelCache, applyModels, fetchModels, listingProviders } from "../catalog/paseo/models.ts";
import { applyReconcile } from "../catalog/paseo/providers.ts";
import { daemonLog } from "../core/logger.ts";
import { stateRoot } from "../core/paths.ts";
import type { Models } from "../core/ports.ts";
import type { TeamSource } from "./team-source.ts";

type SyncOptions = {
  kit: Kit;
  models: Models;
  source: TeamSource;
  reload: () => Promise<boolean>;
  modelsChanged: () => void;
};

/** Keeps Paseo's providers and profiles, and the agents' model lists, in step with the kit and the team. */
export class ProviderSync {
  private asked = false;
  private readonly options: SyncOptions;

  constructor(options: SyncOptions) {
    this.options = options;
  }

  /** A panel call is the first sign someone looks at the models, so the first one of a load asks the agents for them. */
  firstLook(): void {
    if (this.asked) return;
    this.asked = true;
    this.refreshModels().catch((error) => daemonLog.error("could not list the agents' models:", error));
  }

  /** Asked once per load and on demand: Paseo keeps a catalog until told to refresh it. */
  async refreshModels(): Promise<ModelCache> {
    const { kit, models } = this.options;
    // Scoped to one directory: unscoped, Paseo probes the agent for every workspace it has ever opened.
    const cwd = stateRoot();
    await Promise.all([...listingProviders(kit).values()].map((provider) => models.refresh(provider, cwd)));
    const { cache, changed } = await fetchModels(kit, (provider) => models.list(provider, cwd), stateRoot());
    applyModels(kit, cache);
    if (changed) {
      this.options.modelsChanged();
      this.reconcile();
    }
    return cache;
  }

  reconcile(): void {
    try {
      const changed = applyReconcile(this.options.kit, this.options.source.teamFor());
      if (changed.length === 0) return;
      daemonLog.info(`config updated (${changed.join(", ")}); reloading the daemon`);
      void this.options.reload();
    } catch (error) {
      daemonLog.error("could not reconcile role providers:", error);
    }
  }
}
