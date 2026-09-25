import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useRef, useState } from "react";
import { flowRpc } from "../../shared/rpc.ts";
import type { FlowView } from "../../shared/views.ts";
import { message } from "../format/error.ts";

export function useFlow(project: string | undefined, everyMs = 5000, openKey = ""): { flow: FlowView | null; error: string | null } {
  const call = useRpc(flowRpc);
  const latest = useRef(call);
  latest.current = call;
  const [flow, setFlow] = useState<FlowView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!project) {
      setFlow(null);
      setError(null);
      return;
    }
    let alive = true;
    let since: string | undefined;
    const read = async (): Promise<void> => {
      try {
        const open = openKey ? openKey.split(",") : [];
        const answer = await latest.current(since ? { project, since, open } : { project, open });
        if (!alive) return;
        if ("error" in answer) {
          setError(answer.error);
          return;
        }
        setError(null);
        if ("unchanged" in answer) return;
        since = answer.revision;
        setFlow(answer);
      } catch (problem) {
        if (alive) setError(message(problem));
      }
    };
    void read();
    const timer = setInterval(() => void read(), everyMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [project, everyMs, openKey]);

  return { flow, error };
}
