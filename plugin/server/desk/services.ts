import type { PaseoApi } from "../core/paseo.ts";
import type { Agents } from "./agents.ts";
import type { Args, Caller, DeskContext, ToolReply } from "./context.ts";
import type { MergeQueue } from "./merge.ts";
import type { Slots } from "./slots.ts";

export type DeskServices = { ctx: DeskContext; slots: Slots; agents: Agents; merges: MergeQueue };

export type Tool = (desk: DeskServices, paseo: PaseoApi, caller: Caller, args: Args) => Promise<ToolReply>;
