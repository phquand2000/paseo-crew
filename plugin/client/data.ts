import { useRpc, usePaseo } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { catalogRpc, doctorRpc, flowRpc, mcpParseRpc, projectsAddRpc, projectsCandidatesRpc, projectsRemoveRpc, projectsRpc, settingsReadRpc, settingsWriteRpc, statusRpc, teamRpc } from "../shared/rpc.ts";

export type Scalar = string | number | boolean;
export type Connect = { type: "stdio" | "http" | "sse"; command?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> };
export type Parsed = { id: string; label: string; connect: Connect } | { error: string };
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
  mcp: Record<string, { label: string; enabled: boolean; roles: string[]; settings: Record<string, Scalar>; transport: string; template: boolean; connect: Connect | null; rule: string | null }>;
  roles: Record<string, { harness: string; provider: string | null; model: string | null; thinking: string | null; mcp: string[]; tools: Record<string, string[]>; skills: string[]; rules: string }>;
};

export type RoleChoice = { harness?: string; model?: string; thinking?: string };
export type McpChoice = { enabled?: boolean; removed?: boolean; label?: string; connect?: Connect; roles?: string[]; tools?: Record<string, string[]>; rule?: string; settings?: Record<string, Scalar> };
export type Layer = { roles?: Record<string, RoleChoice>; mcp?: Record<string, McpChoice>; rules?: string; limits?: { slots?: number; tasksPerLane?: number } };

export type ProjectRow = { slug: string; root: string };
export type PaseoProject = { name: string; root: string };
export type Check = { id: string; ok: boolean; detail: string };
export type FlowSeat = { id: string; status: string; minutes: number; waiting: string[] };
export type FlowTask = { id: string; title: string; status: string; kind: string; of: string | null; peer: FlowSeat | null; minutes: number; handback: number | null };
export type FlowLane = { id: string; title: string; status: string; branch: string; base: string; lead: FlowSeat | null; tasks: FlowTask[] };
export type FlowAsk = { id: string; kind: string; from: string; fromRole: string; to: string; lane: string | null; task: string | null; minutes: number; text: string };
export type FlowRole = { id: string; label: string; harness: string; model: string | null; headless: boolean; seats: FlowSeat[] };
export type FlowView = { project: string; root: string; at: number; base: string | null; gate: string | null; roles: FlowRole[]; lanes: FlowLane[]; asks: FlowAsk[] };
export type FlowResult = FlowView | { error: string };
type SettingsRead = ({ status: "ready"; revision: string; values: Layer } | { status: "invalid"; revision: string; error: string }) & { machine: Layer };
type WriteResult = { status: "saved" } | { status: "conflict"; error: string } | { status: "invalid"; error: string };
type AddResult = { slug: string; root: string } | { error: string };
type RemoveResult = { removed: string } | { error: string };

export type Data =
  | { status: "loading" }
  | { status: "error"; error: string }
  | {
      status: "ready";
      catalog: Catalog;
      team: TeamView;
      projects: ProjectRow[];
      known: PaseoProject[];
      candidates: PaseoProject[];
      values: Layer;
      machine: Layer;
      revision: string;
      settingsError: string | null;
    };

type Call<Input, Output> = (input: Input) => Promise<Output>;
type Calls = {
  catalog: Call<Record<string, never>, Catalog>;
  projects: Call<Record<string, never>, ProjectRow[]>;
  add: Call<{ root: string }, AddResult>;
  remove: Call<{ project: string }, RemoveResult>;
  candidates: Call<{ roots: string[] }, string[]>;
  parseMcp: Call<{ text: string }, Parsed>;
  settings: Call<{ project?: string }, SettingsRead>;
  write: Call<{ project?: string; revision: string; values: Layer }, WriteResult>;
  team: Call<{ project?: string }, TeamView>;
  doctor: Call<{ project?: string }, Check[]>;
  status: Call<{ project: string }, { text: string; error?: string }>;
  flow: Call<{ project: string }, FlowResult>;
};

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function useSeatworks(project?: string) {
  const bound = {
    catalog: useRpc(catalogRpc),
    projects: useRpc(projectsRpc),
    add: useRpc(projectsAddRpc),
    remove: useRpc(projectsRemoveRpc),
    candidates: useRpc(projectsCandidatesRpc),
    parseMcp: useRpc(mcpParseRpc),
    settings: useRpc(settingsReadRpc),
    write: useRpc(settingsWriteRpc),
    team: useRpc(teamRpc),
    doctor: useRpc(doctorRpc),
    status: useRpc(statusRpc),
    flow: useRpc(flowRpc),
  };
  const paseo = usePaseo();
  const latest = useRef(bound as unknown as Calls);
  latest.current = bound as unknown as Calls;
  const [data, setData] = useState<Data>({ status: "loading" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    const paseoProjects = async (): Promise<PaseoProject[]> => {
      try {
        const listed = (await paseo.projects.list()) as { projects?: { projectDisplayName?: string; projectRootPath?: string }[] };
        return (listed.projects ?? [])
          .filter((entry): entry is { projectDisplayName?: string; projectRootPath: string } => typeof entry.projectRootPath === "string")
          .map((entry) => ({ name: entry.projectDisplayName ?? entry.projectRootPath, root: entry.projectRootPath }));
      } catch {
        return [];
      }
    };
    const load = async (): Promise<void> => {
      const call = latest.current;
      const [catalog, projects, team, settings, known] = await Promise.all([
        call.catalog({}),
        call.projects({}),
        call.team({ project }),
        call.settings({ project }),
        paseoProjects(),
      ]);
      const offerable = new Set(known.length > 0 ? await call.candidates({ roots: known.map((entry) => entry.root) }) : []);
      if (!alive) return;
      setData({
        status: "ready",
        catalog,
        projects,
        known,
        candidates: known.filter((entry) => offerable.has(entry.root)),
        team,
        values: settings.status === "ready" ? settings.values : {},
        machine: settings.machine ?? {},
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
  }, [project, nonce, paseo]);

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

  const addProject = useCallback(async (root: string): Promise<string | null> => {
    setSaveError(null);
    try {
      const result = await latest.current.add({ root });
      if ("error" in result) {
        setSaveError(result.error);
        return null;
      }
      return result.slug;
    } catch (error) {
      setSaveError(message(error));
      return null;
    }
  }, []);

  const attach = useCallback(
    async (root: string, values: Layer): Promise<string | null> => {
      setSaving(true);
      setSaveError(null);
      try {
        const added = await latest.current.add({ root });
        if ("error" in added) {
          setSaveError(added.error);
          return null;
        }
        if (Object.keys(values).length > 0) {
          const read = await latest.current.settings({ project: added.slug });
          const written = await latest.current.write({ project: added.slug, revision: read.revision, values });
          if (written.status !== "saved") setSaveError(written.error);
        }
        return added.slug;
      } catch (error) {
        setSaveError(message(error));
        return null;
      } finally {
        setSaving(false);
        reload();
      }
    },
    [reload],
  );

  const detach = useCallback(
    async (slug: string): Promise<boolean> => {
      setSaving(true);
      setSaveError(null);
      try {
        const result = await latest.current.remove({ project: slug });
        if ("error" in result) {
          setSaveError(result.error);
          return false;
        }
        return true;
      } catch (error) {
        setSaveError(message(error));
        return false;
      } finally {
        setSaving(false);
        reload();
      }
    },
    [reload],
  );

  const addServer = useCallback(
    async (text: string): Promise<string | null> => {
      setSaveError(null);
      try {
        const parsed = await latest.current.parseMcp({ text });
        if ("error" in parsed) {
          setSaveError(parsed.error);
          return null;
        }
        const id = parsed.id.trim();
        if (!id) {
          setSaveError("That snippet does not name the server; paste it as {\"mcp\": {\"name\": { … }}}.");
          return null;
        }
        await save((values) => setMcp(values, id, { enabled: true, label: parsed.label || id, connect: parsed.connect, removed: false }));
        return id;
      } catch (error) {
        setSaveError(message(error));
        return null;
      }
    },
    [save],
  );

  const runDoctor = useCallback(() => latest.current.doctor({ project }), [project]);
  const readStatus = useCallback((slug: string) => latest.current.status({ project: slug }), []);
  return { data, save, reload, saving, saveError, addProject, addServer, attach, detach, runDoctor, readStatus };
}

export function useFlow(project: string | undefined, everyMs = 5000): { flow: FlowView | null; error: string | null } {
  const call = useRpc(flowRpc) as unknown as Call<{ project: string }, FlowResult>;
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
    const read = async (): Promise<void> => {
      try {
        const answer = await latest.current({ project });
        if (!alive) return;
        if ("error" in answer) {
          setError(answer.error);
          return;
        }
        setFlow(answer);
        setError(null);
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
  }, [project, everyMs]);

  return { flow, error };
}

export type Source = "here" | "machine" | "default";

export function sourceOf(values: Layer, machine: Layer, pick: (layer: Layer) => unknown, layer: "machine" | "project"): Source {
  if (pick(values) !== undefined) return "here";
  if (layer === "project" && pick(machine) !== undefined) return "machine";
  return "default";
}

export function sourceText(source: Source, layer: "machine" | "project"): string {
  if (source === "here") return layer === "machine" ? "set for this machine" : "set for this project";
  if (source === "machine") return "from the machine layer";
  return "catalog default";
}

function prune<T extends object>(values: Layer, key: "roles" | "mcp", id: string, entry: T): Layer {
  const group = { ...(values[key] as Record<string, T> | undefined) };
  if (Object.keys(entry).length === 0) delete group[id];
  else group[id] = entry;
  const next = { ...values };
  if (Object.keys(group).length === 0) delete next[key];
  else (next[key] as Record<string, T>) = group;
  return next;
}

export function setRole(values: Layer, role: string, choice: RoleChoice, replace = false): Layer {
  return prune(values, "roles", role, { ...(replace ? {} : (values.roles?.[role] ?? {})), ...choice });
}

export function clearRole(values: Layer, role: string, field: keyof RoleChoice): Layer {
  const entry = { ...(values.roles?.[role] ?? {}) };
  delete entry[field];
  return prune(values, "roles", role, entry);
}

export function setMcp(values: Layer, id: string, choice: McpChoice): Layer {
  const current = values.mcp?.[id] ?? {};
  const settings = { ...current.settings, ...choice.settings };
  const entry: McpChoice = { ...current, ...choice };
  if (Object.keys(settings).length > 0) entry.settings = settings;
  else delete entry.settings;
  return prune(values, "mcp", id, entry);
}

export function clearMcp(values: Layer, id: string, field: keyof McpChoice): Layer {
  const entry = { ...(values.mcp?.[id] ?? {}) };
  delete entry[field];
  return prune(values, "mcp", id, entry);
}

export function clearMcpSetting(values: Layer, id: string, key: string): Layer {
  const entry = { ...(values.mcp?.[id] ?? {}) };
  const settings = { ...entry.settings };
  delete settings[key];
  if (Object.keys(settings).length === 0) delete entry.settings;
  else entry.settings = settings;
  return prune(values, "mcp", id, entry);
}
