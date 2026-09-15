import type { PluginServerContext } from "@getpaseo/plugin/server";
import { loadKit } from "./server/catalog/kit.ts";
import { PLUGIN_ID, pluginDir } from "./server/core/paths.ts";
import { Runtime } from "./server/runtime/runtime.ts";

export default function contribute(server: PluginServerContext) {
  const dir = pluginDir();
  if (!dir) {
    console.error(`${PLUGIN_ID}: this plugin's directory is not in ~/.paseo/config.json under plugins.${PLUGIN_ID}`);
    return () => {};
  }
  let runtime: Runtime;
  try {
    runtime = new Runtime(loadKit(dir));
  } catch (error) {
    console.error(`${PLUGIN_ID}: the kit in ${dir} failed to load:`, error);
    return () => {};
  }
  runtime.prepare();
  runtime.register(server);
  return () => runtime.dispose();
}
