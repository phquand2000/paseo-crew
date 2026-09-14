import type { PluginServerContext } from "@getpaseo/plugin/server";
import { wire } from "./server/features/index.ts";
import { kitLoader } from "./server/kit.ts";
import { Runtime } from "./server/runtime.ts";

export default function contribute(server: PluginServerContext) {
  const runtime = new Runtime({ kit: kitLoader() });
  wire(server, runtime);
  return () => runtime.dispose();
}
