import type { PluginRpcContract } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useRef, useState } from "react";
import type { ZodType, output } from "zod";
import { message } from "../format/error.ts";

type Answer<O extends ZodType> = Exclude<output<O>, { error: string }>;

/** One project's answer over RPC, read when the project changes and again on `reload`; a refusal is its error. */
export function useProjectRead<I extends ZodType, O extends ZodType>(contract: PluginRpcContract<I, O>, project: string): { value: Answer<O> | null; error: string | null; reload(): void } {
  const call = useRpc(contract);
  // Held aside, since a new function each render would read the project again each render.
  const latest = useRef(call);
  latest.current = call;
  const [state, setState] = useState<{ value: Answer<O> | null; error: string | null }>({ value: null, error: null });
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    latest.current({ project } as never).then(
      (answer) => live && setState(answer && typeof answer === "object" && "error" in answer ? { value: null, error: String(answer.error) } : { value: answer as Answer<O>, error: null }),
      (error: unknown) => live && setState({ value: null, error: message(error) }),
    );
    return () => {
      live = false;
    };
  }, [project, round]);
  return { ...state, reload: () => setRound((count) => count + 1) };
}
