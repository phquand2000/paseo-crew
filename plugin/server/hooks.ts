import type { PluginHookContext, PluginLifecycleEvents, PluginServerContext } from "@getpaseo/plugin/server";

export type PaseoApi = PluginHookContext["paseo"];
export type EventName = keyof PluginLifecycleEvents;
export type Handler<N extends EventName> = (
  event: PluginLifecycleEvents[N],
  context: PluginHookContext,
) => void | Promise<void>;

export function on<N extends EventName>(server: PluginServerContext, feature: string, name: N, handler: Handler<N>): void {
  server.on(name, async (event, context) => {
    try {
      await handler(event, context);
    } catch (error) {
      console.error(`seatworks ${feature} failed on ${name}:`, error);
    }
  });
}
