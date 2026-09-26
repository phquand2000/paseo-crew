import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { z } from "zod";
import { PaseoHost } from "../../server/adapters/paseo/host.ts";
import { paseoConfigPath } from "../../server/core/paths.ts";
import { registerRpc } from "../../server/runtime/panel/rpc.ts";
import { Runtime } from "../../server/runtime/runtime.ts";
import { makeKit } from "../kit.ts";

type Contract = { name: string; input: z.ZodType; output: z.ZodType };
type Handler = (input: unknown, context: { paseo: unknown }) => unknown;

const nobodySeated = {
  agents: { list: async () => ({ entries: [], pageInfo: { hasMore: false, nextCursor: null, prevCursor: null } }) },
};

/**
 * The plugin's panel side as Paseo serves it, on the test kit: each contract's handler called with the daemon handle,
 * the input read by its schema, and the answer as sent read back by the schema the panel checks it with.
 */
export function served(paseo: unknown = nobodySeated) {
  // Paseo's config is always there where a plugin runs, and the plugin writes its seats' providers into it.
  mkdirSync(dirname(paseoConfigPath()), { recursive: true });
  writeFileSync(paseoConfigPath(), "{}\n");
  const host = new PaseoHost();
  const runtime = new Runtime(makeKit(), host, { reloadDaemon: async () => true });
  const handlers = new Map<string, Handler>();
  const server = { handle: (contract: Contract, handler: Handler) => void handlers.set(contract.name, handler) };
  registerRpc(host.answering(server as never), runtime.panel, () => {});
  const call = async <C extends Contract>(contract: C, input: z.input<C["input"]>): Promise<z.output<C["output"]>> => {
    const handler = handlers.get(contract.name);
    assert.ok(handler, `nothing serves ${contract.name}`);
    const answer: unknown = await handler(contract.input.parse(input), { paseo });
    return contract.output.parse(JSON.parse(JSON.stringify(answer))) as z.output<C["output"]>;
  };
  return { call, host, handlers };
}

/** The case of a union answer that holds `key`, or the test fails with the answer that came instead. */
export function which<T, K extends string>(answer: T, key: K): Extract<T, Record<K, unknown>> {
  assert.ok(typeof answer === "object" && answer !== null && key in answer, `no ${key} in ${JSON.stringify(answer)}`);
  return answer as Extract<T, Record<K, unknown>>;
}
