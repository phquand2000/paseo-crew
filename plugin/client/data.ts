import { useRpc } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { catalogRpc, doctorRpc, projectsRpc, settingsReadRpc, settingsWriteRpc, statusRpc, teamRpc } from "../shared/rpc.ts";

export type Scalar = string | number | boolean;
export type SettingSpec = { type: "number" | "string" | "boolean"; label: string; default?: Scalar };
export type ModelView = { id: string; label: string; isDefault?: boolean; thinkingOptions?: { id: string; label: string; isDefault?: boolean }[] };

export type Catalog = {
  roles: { id: string; label: string; description: string; team: string | null; headless: boolean; defaults: { harness: string; model?: string; thinking?: string }; harnesses: string[] }[];
  harnesses: { id: string; label: string; models: ModelView[]; thinking: boolean; transports: string[]; headless: boolean }[];
  mcp: { id: string; label: string; description: string; kind: string; transport: string; settings: Record<string, SettingSpec>; defaults: { enabled: boolean }; roles: string[] }[];
};

export type TeamView = {
  project: string | null;
  errors: string[];
  rules: string;
  mcp: Record<string, { enabled: boolean; roles: string[]; settings: Record<string, Scalar> }>;
  roles: Record<string, { harness: string; provider: string | null; model: string | null; thinking: string | null; mcp: string[]; tools: Record<string, string[]>; skills: string[]; rules: string }>;
};

export type Layer = {
  roles?: Record<string, { harness?: string; model?: string; thinking?: string }>;
  mcp?: Record<string, { enabled?: boolean; roles?: string[]; settings?: Record<string, Scalar> }>;
  rules?: string;
  limits?: { slots?: number; tasksPerLane?: number };
};

export type ProjectRow = { slug: string; root: string };
export type Check = { id: string; ok: boolean; detail: string };
type SettingsRead = { status: "ready"; revision: string; values: Layer } | { status: "invalid"; revision: string; error: string };
type WriteResult = { status: "saved" } | { status: "conflict"; error: string } | { status: "invalid"; error: string };

export type Data =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; catalog: Catalog; team: TeamView; projects: ProjectRow[]; values: Layer; revision: string; settingsError: string | null };

type Call<Input, Output> = (input: Input) => Promise<Output>;
type Calls = {
  catalog: Call<Record<string, never>, Catalog>;
  projects: Call<Record<string, never>, ProjectRow[]>;
  settings: Call<{ project?: string }, SettingsRead>;
  write: Call<{ project?: string; revision: string; values: Layer }, WriteResult>;
  team: Call<{ project?: string }, TeamView>;
  doctor: Call<{ project?: string }, Check[]>;
  status: Call<{ project: string }, { text: string; error?: string }>;
};

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function useSeatworks(project?: string) {
  const bound = {
    catalog: useRpc(catalogRpc),
    projects: useRpc(projectsRpc),
    settings: useRpc(settingsReadRpc),
    write: useRpc(settingsWriteRpc),
    team: useRpc(teamRpc),
    doctor: useRpc(doctorRpc),
    status: useRpc(statusRpc),
  };
  const latest = useRef(bound as unknown as Calls);
  latest.current = bound as unknown as Calls;
  const [data, setData] = useState<Data>({ status: "loading" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async (): Promise<void> => {
      const call = latest.current;
      const [catalog, projects, team, settings] = await Promise.all([call.catalog({}), call.projects({}), call.team({ project }), call.settings({ project })]);
      if (!alive) return;
      setData({
        status: "ready",
        catalog,
        projects,
        team,
        values: settings.status === "ready" ? settings.values : {},
        revision: settings.revision,
        settingsError: settings.status === "ready" ? null : settings.error,
      });
    };
    setData({ status: "loading" });
    load().catch((error: unknown) => {
      if (alive) setData({ status: "error", error: message(error) });
    });
    return () => {
      alive = false;
    };
  }, [project, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  const save = useCallback(
    async (change: (values: Layer) => Layer): Promise<void> => {
      if (data.status !== "ready") return;
      setSaving(true);
      setSaveError(null);
      try {
        const result = await latest.current.write({ project, revision: data.revision, values: change(data.values) });
        if (result.status !== "saved") setSaveError(result.error);
      } catch (error) {
        setSaveError(message(error));
      } finally {
        setSaving(false);
        reload();
      }
    },
    [data, project, reload],
  );

  const runDoctor = useCallback(() => latest.current.doctor({ project }), [project]);
  const readStatus = useCallback((slug: string) => latest.current.status({ project: slug }), []);
  return { data, save, reload, saving, saveError, runDoctor, readStatus };
}

export function setRole(values: Layer, role: string, choice: { harness?: string; model?: string; thinking?: string }, replace = false): Layer {
  const current = replace ? {} : (values.roles?.[role] ?? {});
  return { ...values, roles: { ...values.roles, [role]: { ...current, ...choice } } };
}

export function setMcp(values: Layer, id: string, choice: { enabled?: boolean; roles?: string[]; settings?: Record<string, Scalar> }): Layer {
  const current = values.mcp?.[id] ?? {};
  return { ...values, mcp: { ...values.mcp, [id]: { ...current, ...choice, settings: { ...current.settings, ...choice.settings } } } };
}
