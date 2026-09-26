import type { PluginLifecycleEvents, PluginServerContext } from "@getpaseo/plugin/server";
import type { Host, HostHooks, Models } from "../../core/ports.ts";
import { type PaseoApi, seatsOn, workspacesOn } from "./agents.ts";

type Answer = (input: any) => unknown;
type Handle = (contract: { name: string }, handler: (input: unknown, context: { paseo: PaseoApi }) => unknown) => void;

/** Paseo hands the plugin its API only with a hook or a panel call, so each one binds it before the plugin acts. */
export class PaseoHost implements Host {
  readonly seats;
  readonly workspaces;
  readonly models: Models;
  private api: PaseoApi | undefined;

  constructor(api?: PaseoApi) {
    this.api = api;
    this.seats = seatsOn(() => this.api);
    this.workspaces = workspacesOn(() => this.api);
    this.models = {
      refresh: async (provider, cwd) => {
        await this.reach().providers.refresh({ cwd, providers: [provider] });
      },
      list: (provider, cwd) => this.reach().providers.listModels(provider, { cwd }),
    };
  }

  connected(): boolean {
    return this.api !== undefined;
  }

  connect(server: PluginServerContext, hooks: HostHooks): void {
    server.before("agent.create", ({ request }, context) => {
      this.api = context.paseo;
      // The plugin's config type is narrower than Paseo's, and the daemon checks what a hook returns.
      return { ...request, config: hooks.create(request.config) as typeof request.config };
    });
    server.before("agent.session_open", ({ request }, context) => {
      this.api = context.paseo;
      return { ...request, ...hooks.sessionOpen(request) };
    });
    this.on(server, "agent.turn_started", ({ agent }) => hooks.turnStarted(agent));
    this.on(server, "agent.turn_ended", (event) => hooks.turnEnded(event));
    this.on(server, "agent.permission_requested", (event) => hooks.permissionRequested(event));
    this.on(server, "agent.created", ({ agent }) => hooks.created(agent));
    this.on(server, "agent.archived", ({ agent }) => hooks.archived(agent));
  }

  /** Panel calls carry the live daemon handle: after a reload with no seat hooks yet, it is the desk's only way to get one. */
  answering(server: Pick<PluginServerContext, "handle">): (contract: { name: string }, answer: Answer) => void {
    const handle = server.handle.bind(server) as unknown as Handle;
    return (contract, answer) =>
      handle(contract, (input, context) => {
        this.api = context.paseo;
        return answer(input);
      });
  }

  /** A hook that throws is logged here and goes no further, as Paseo would only log it too. */
  private on<N extends keyof PluginLifecycleEvents>(server: PluginServerContext, name: N, handler: (event: PluginLifecycleEvents[N]) => Promise<void>): void {
    server.on(name, async (event, context) => {
      this.api = context.paseo;
      try {
        await handler(event);
      } catch (error) {
        console.error(`seatworks-v2: ${name} handler failed:`, error);
      }
    });
  }

  private reach(): PaseoApi {
    if (!this.api) throw new Error("Paseo is not connected, so it cannot list the agents' models");
    return this.api;
  }
}
