import { useRpc, usePaseo } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { catalogRpc, doctorRpc, flowRpc, mcpParseRpc, pathsRpc, projectsAddRpc, projectsCandidatesRpc, projectsRemoveRpc, projectsRpc, settingsReadRpc, settingsWriteRpc, statusRpc, teamRpc } from "../shared/rpc.ts";

export type Scalar = string | number | boolean;
export type Connect = { type: "stdio" | "http" | "sse"; command?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> };
export type Parsed = { id: string; label: string; connect: Connect } | { error: string };
export type SettingSpec = { type: "number" | "string" | "boolean"; label: string; default?: Scalar };
export type ModelView = { id: string; label: string; isDefault?: boolean; thinkingOptions?: { id: string; label: string; isDefault?: boolean }[] };

export type Catalog = {
  roles: { id: string; label: string; description: string; can: string[]; concern: string | null; defaults: { harness: string; model?: string; thinking?: string }; harnesses: string[] }[];
  harnesses: { id: string; label: string; models: ModelView[]; thinking: boolean; transports: string[] }[];
  mcp: { id: string; label: string; description: string; kind: string; transport: string; settings: Record<string, SettingSpec>; defaults: { enabled: boolean }; roles: string[] }[];
};

export type TeamView = {
  project: string | null;
  errors: string[];
  attention: Required<AttentionChoice>;
  rules: string;
  mcp: Record<string, { label: string; enabled: boolean; roles: string[]; settings: Record<string, Scalar>; transport: string; template: boolean; connect: Connect | null; rule: string | null }>;
  roles: Record<string, { harness: string; provider: string; model: string | null; thinking: string | null; mcp: string[]; tools: Record<string, string[]>; skills: string[]; rules: string }>;
};

export type AttentionChoice = {
  tickSeconds?: number; leadIdleMinutes?: number; askRemindMinutes?: number; maxReminders?: number;
  watchEveryClean?: number; digestMinutes?: number; watch?: boolean; strikesAt?: number;
  pagesPerWindow?: number; windowHours?: number;
};
export type RoleChoice = { harness?: string; model?: string; thinking?: string; rules?: string };
export type McpChoice = { enabled?: boolean; removed?: boolean; label?: string; connect?: Connect; roles?: string[]; tools?: Record<string, string[]>; rule?: string; settings?: Record<string, Scalar> };
export type Layer = { roles?: Record<string, RoleChoice>; mcp?: Record<string, McpChoice>; rules?: string; attention?: AttentionChoice; flow?: { live?: boolean; everySeconds?: number } };

export type ProjectRow = { slug: string; root: string };
export type PaseoProject = { name: string; root: string };
export type Check = { id: string; ok: boolean; detail: string };
export type FlowSeat = { id: string; role: string; status: string; minutes: number; waiting: string[] };
export type FlowTask = { id: string; title: string; status: string; kind: string; peer: FlowSeat | null; minutes: number; handback: number | null };
export type FlowLane = { id: string; title: string; status: string; branch: string; base: string; lead: FlowSeat | null; tasks: FlowTask[]; taskCount: number; running: number; open: boolean };
export type FlowAsk = { id: string; kind: string; fromRole: string; to: string; minutes: number; text: string };
export type FlowView = { project: string; at: number; revision: string; supervisor: FlowSeat | null; lanes: FlowLane[]; moreLanes: number; asks: FlowAsk[] };
export type Folder = { name: string; path: string; repository: boolean };
export type Folders = { path: string; parent: string | null; repository: boolean; folders: Folder[] };
export type FlowResult = FlowView | { unchanged: true; revision: string } | { error: string };
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
  flow: Call<{ project: string; since?: string; open?: string[] }, FlowResult>;
  paths: Call<{ path?: string }, Folders | { error: string }>;
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
    paths: useRpc(pathsRpc),
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
    async (change: (values: Layer) => Layer): Promise<boolean> => {
      if (data.status !== "ready") return false;
      setSaving(true);
      setSaveError(null);
      try {
        const result = await latest.current.write({ project, revision: data.revision, values: change(data.values) });
        if (result.status !== "saved") setSaveError(result.error);
        return result.status === "saved";
      } catch (error) {
        setSaveError(message(error));
        return false;
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
          if (read.status !== "ready") {
            setSaveError(read.error);
            return added.slug;
          }
          // A write is the whole layer, so what the dialog collected is folded into what the project
          // already holds. Sending the draft on its own erased the rules, the pasted servers with
          // their tokens and the attention tuning of a project that turned out to be attached already.
          const catalogue = data.status === "ready" ? data.catalog.roles : [];
          const merged = foldRoles(read.values, values, (role) =>
            read.values.roles?.[role]?.harness ?? read.machine.roles?.[role]?.harness ?? catalogue.find((entry) => entry.id === role)?.defaults.harness,
          );
          const written = await latest.current.write({ project: added.slug, revision: read.revision, values: merged });
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
    // `data` is read for the catalog's default harness: without it here the callback keeps the one
    // built on the first render, where the settings are still loading and the catalog is empty.
    [data, reload],
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
        // Given only to the roles whose agent can reach it. Left to "every eligible role", a hosted
        // server was refused for whichever role runs an agent with no transport for it — and the
        // control that narrows it only appears once the server is saved, so it could never be added.
        if (data.status !== "ready") return null;
        const harnessOf = (role: { id: string; defaults: { harness: string } }) =>
          data.values.roles?.[role.id]?.harness ?? data.machine.roles?.[role.id]?.harness ?? role.defaults.harness;
        const reachable = data.catalog.roles
          .filter((role) => (data.catalog.harnesses.find((entry) => entry.id === harnessOf(role))?.transports ?? []).includes(parsed.connect.type))
          .map((role) => role.id);
        if (reachable.length === 0) {
          setSaveError(`No role's agent can reach a ${parsed.connect.type} server, so there is nobody to give it to.`);
          return null;
        }
        // Pasting the same name again is how a connection is updated — a rotated token, a new url —
        // so the roles the owner narrowed to are kept, intersected with what can reach the transport.
        // `roles` is derived from the kit, not carried by the snippet, so a paste must not assert it.
        // An empty list is nothing to preserve, not a narrowing to nobody: a server switched on for no
        // role could not be re-pasted at all, and the refusal named nobody.
        const narrowed = data.values.mcp?.[id]?.roles;
        const roles = narrowed?.length ? narrowed.filter((role) => reachable.includes(role)) : reachable;
        if (roles.length === 0) {
          setSaveError(`This server is given to ${narrowed!.join(", ")}, and no agent of theirs can reach a ${parsed.connect.type} server. Widen the roles on its own tab first.`);
          return null;
        }
        const saved = await save((values) => setMcp(values, id, { enabled: true, label: parsed.label || id, connect: parsed.connect, removed: false, roles }));
        // The snippet is the owner's only copy of what they pasted; it is not thrown away on a refusal.
        return saved ? id : null;
      } catch (error) {
        setSaveError(message(error));
        return null;
      }
    },
    [data, save],
  );

  const listFolders = useCallback((path?: string) => latest.current.paths(path ? { path } : {}), []);
  const runDoctor = useCallback(() => latest.current.doctor({ project }), [project]);
  const readStatus = useCallback((slug: string) => latest.current.status({ project: slug }), []);
  return { data, save, reload, saving, saveError, addProject, addServer, attach, detach, listFolders, runDoctor, readStatus };
}

export function useFlow(project: string | undefined, everyMs = 5000, openKey = ""): { flow: FlowView | null; error: string | null } {
  const call = useRpc(flowRpc) as unknown as Call<{ project: string; since?: string; open?: string[] }, FlowResult>;
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

export type Source = "here" | "machine" | "default";

export function sourceOf(values: Layer, machine: Layer, pick: (layer: Layer) => unknown, layer: "machine" | "project"): Source {
  if (pick(values) !== undefined) return "here";
  if (layer === "project" && pick(machine) !== undefined) return "machine";
  return "default";
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

/**
 * Folds a setup draft into the layer a project already holds.
 *
 * Each role goes through `setRole` with the answer to the question that function exists to ask: is
 * this a *different* agent from the one this role runs now? A draft that moves the Peer to another
 * agent while the layer still holds the old agent's model would otherwise keep that model and pin it
 * onto the new one, and nothing downstream fences a model an agent does not have.
 */
export function foldRoles(into: Layer, draft: Layer, harnessNow: (role: string) => string | undefined): Layer {
  return Object.entries(draft.roles ?? {}).reduce((values, [role, choice]) => {
    // Only a harness we can *name* counts as the one being replaced. Reading "not recorded anywhere"
    // as "different from this one" threw away a model the owner had picked for a role still running
    // its kit default, which is the ordinary state of a role nobody has moved.
    const now = harnessNow(role);
    const moved = Boolean(choice.harness) && now !== undefined && choice.harness !== now;
    return setRole(values, role, choice, moved);
  }, into);
}

export function setRole(values: Layer, role: string, choice: RoleChoice, newHarness = false): Layer {
  const current = values.roles?.[role] ?? {};
  // A new harness invalidates the model and the thinking level picked for the old one. It does not
  // invalidate what this seat was told: that is the owner's writing and holds whatever runs it.
  const base: RoleChoice = newHarness ? (current.rules ? { rules: current.rules } : {}) : current;
  return prune(values, "roles", role, { ...base, ...choice });
}

export function setMcp(values: Layer, id: string, choice: McpChoice): Layer {
  const current = values.mcp?.[id] ?? {};
  const settings = { ...current.settings, ...choice.settings };
  const entry: McpChoice = { ...current, ...choice };
  if (Object.keys(settings).length > 0) entry.settings = settings;
  else delete entry.settings;
  return prune(values, "mcp", id, entry);
}

