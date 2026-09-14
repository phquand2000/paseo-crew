import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { Feature, Runtime } from "../runtime.ts";
import * as launch from "./launch.ts";
import * as room from "./room.ts";
import * as signals from "./signals.ts";
import * as watcher from "./watcher.ts";

export const features: Feature[] = [room, launch, signals, watcher];

export function wire(server: PluginServerContext, runtime: Runtime): void {
  runtime.register(server);
  for (const feature of features) feature.register(server, runtime);
}
