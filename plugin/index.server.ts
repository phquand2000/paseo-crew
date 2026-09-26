import type { PluginServerContext } from "@getpaseo/plugin/server";
import { decisionsJudge } from "./server/adapters/decisions.ts";
import { PaseoHost } from "./server/adapters/paseo/host.ts";
import { loadKit } from "./server/catalog/kit/kit.ts";
import { applyModels, readModels } from "./server/catalog/paseo/models.ts";
import { PLUGIN_ID, pluginDir, stateRoot } from "./server/core/paths.ts";
import { registerRpc } from "./server/runtime/panel/rpc.ts";
import { Runtime } from "./server/runtime/runtime.ts";

export default function contribute(server: PluginServerContext) {
  const dir = pluginDir();
  if (!dir) {
    console.error(`${PLUGIN_ID}: this plugin's directory is not in ~/.paseo/config.json under plugins.${PLUGIN_ID}`);
    return () => {};
  }
  const host = new PaseoHost();
  let runtime: Runtime;
  try {
    const kit = loadKit(dir, stateRoot());
    applyModels(kit, readModels(stateRoot()));
    runtime = new Runtime(kit, host, { sensor: (spec, key) => decisionsJudge(spec, key) });
  } catch (error) {
    console.error(`${PLUGIN_ID}: the kit in ${dir} failed to load:`, error);
    return () => {};
  }
  runtime.prepare();
  registerRpc(host.answering(server), runtime.panel, () => runtime.panelCalled());
  host.connect(server, runtime);
  runtime.start();
  return () => runtime.dispose();
}
