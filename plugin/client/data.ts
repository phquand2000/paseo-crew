import { useRpc, usePaseo } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Check, FlowAsk, FlowLane, FlowSeat, FlowTask, FlowView, WatchSeat, WatchTrouble, WatchView } from "../shared/views.ts";
import { catalogRpc, doctorRpc, flowRpc, mcpParseRpc, pathsRpc, projectsAddRpc, projectsCandidatesRpc, projectsRemoveRpc, projectsRpc, settingsReadRpc, settingsWriteRpc, statusRpc, teamRpc } from "../shared/rpc.ts";

export type { Check, FlowAsk, FlowLane, FlowSeat, FlowTask, FlowView, WatchSeat, WatchTrouble, WatchView };

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
  watch?: boolean; destructive?: string; testPath?: string; repeatsAt?: number; reworksAt?: number; reviewsAt?: number; suppressed?: string;
  longTurnMinutes?: number; incidentsPerDay?: number;
};
export type RoleChoice = { harness?: string; model?: string; thinking?: string; rules?: string };
export type McpChoice = { enabled?: boolean; removed?: boolean; label?: string; connect?: Connect; roles?: string[]; tools?: Record<string, string[]>; rule?: string; settings?: Record<string, Scalar> };
export type SensorChoice = { key?: string };
export type Layer = { roles?: Record<string, RoleChoice>; mcp?: Record<string, McpChoice>; rules?: string; attention?: AttentionChoice; flow?: { live?: boolean; everySeconds?: number }; sensor?: SensorChoice };

export type ProjectRow = { slug: string; root: string };
export type PaseoProject = { name: string; root: string };
export type Folder = { name: string; path: string; repository: boolean };
/** `root` is the repository this folder belongs to when it is not itself that repository's top. */
export type Folders = { path: string; parent: string | null; repository: boolean; root?: string | null; folders: Folder[] };
export type FlowResult = FlowView | { unchanged: true; revision: string } | { error: string };
type SettingsRead = ({ status: "ready"; revision: string; values: Layer } | { status: "invalid"; revision: string; error: string }) & { machine: Layer };
type WriteResult = { status: "saved"; revision: string; values: Layer } | { status: "conflict"; error: string } | { status: "invalid"; error: string };
type AddResult = { slug: string; root: string } | { error: string };
type RemoveResult = { removed: string } | { error: string };

export type Data =
  | { status: "loading" }
  | { status: "error"; error: string }
  | {
      status: "ready";
      /** Which screen this is for, so a refresh keeps it up and a move to another one does not. */
      of: string;
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

export const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

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
  // Set by a save and cleared by the reload it asked for, so the controls stay locked until they are
  // drawn from what the save produced.
  const settling = useRef(false);
  // Held with the screen it came from. The hook serves every screen, and a refusal on one project was
  // shown under "Needs your attention" on every other one and on the list, until the next save anywhere.
  const [refusal, setRefusal] = useState<{ of: string; text: string } | null>(null);
  // Read through a ref, so a callback built on an earlier render still tags the screen that is open
  // now: closed over `project`, detach and add kept the list's "" from the first render for good.
  const here = useRef(project ?? "");
  here.current = project ?? "";
  const setSaveError = useCallback((text: string | null) => setRefusal(text === null ? null : { of: here.current, text }), []);
  const saveError = refusal?.of === (project ?? "") ? refusal.text : null;
  // Whether the last write really went. The "Saved" toast used to infer it from there being no error
  // on the screen now open, so a refusal recorded for another screen read as a success.
  const [saved, setSaved] = useState<boolean | null>(null);
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
      if (settling.current) {
        settling.current = false;
        setSaving(false);
      }
      setData({
        status: "ready",
        of: project ?? "",
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
    // Only a move to another screen blanks it. Every save ends in a reload, and blanking on that
    // returned the surface to its loading view, which unmounts every section and remounts it with
    // fresh local state: the tab the owner was on, the server they had just pasted and were told to
    // narrow, the draft they were halfway through, and any error shown beside it. Keeping it up for a
    // different project would show one project's settings as another's, so what it is for is checked.
    setData((held) => (held.status === "ready" && held.of === (project ?? "") ? held : { status: "loading" }));
    load().catch((error: unknown) => {
      if (!alive) return;
      if (settling.current) {
        settling.current = false;
        setSaving(false);
      }
      setData({ status: "error", error: message(error) });
    });
    return () => {
      alive = false;
    };
  }, [project, nonce, paseo]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  /**
   * The shell every write to the desk runs inside: locked, cleared of the last refusal, and ending in
   * a reload the controls stay locked until.
   *
   * Cleared anywhere but here, the controls came back live while they were still drawn from the team
   * read before the save: first a second click was refused as a conflict over the owner's own change,
   * and then — once the new revision alone was adopted — it went through, built on a view one save
   * behind, and silently undid the first.
   */
  const writing = useCallback(
    async <T,>(run: () => Promise<T>, failed: T): Promise<T> => {
      setSaving(true);
      setSaveError(null);
      try {
        return await run();
      } catch (error) {
        setSaveError(message(error));
        setSaved(false);
        return failed;
      } finally {
        settling.current = true;
        reload();
      }
    },
    [reload],
  );

  const save = useCallback(
    async (change: (values: Layer) => Layer): Promise<boolean> => {
      if (data.status !== "ready") return false;
      return writing(async () => {
        const result = await latest.current.write({ project, revision: data.revision, values: change(data.values) });
        if (result.status !== "saved") {
          setSaveError(result.error);
          setSaved(false);
          return false;
        }
        setSaved(true);
        return true;
      }, false);
    },
    [data, project, writing],
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
      return writing(async () => {
        const added = await latest.current.add({ root });
        if ("error" in added) {
          setSaveError(added.error);
          setSaved(false);
          return null;
        }
        if (Object.keys(values).length > 0) {
          const read = await latest.current.settings({ project: added.slug });
          if (read.status !== "ready") {
            // Filed under the project the dialog is about to open, which is where it has to be read.
            setRefusal({ of: added.slug, text: read.error });
            setSaved(false);
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
          if (written.status !== "saved") {
            setRefusal({ of: added.slug, text: written.error });
            setSaved(false);
            return added.slug;
          }
        }
        setSaved(true);
        return added.slug;
      }, null);
    },
    // `data` is read for the catalog's default harness: without it here the callback keeps the one
    // built on the first render, where the settings are still loading and the catalog is empty.
    [data, writing],
  );

  const detach = useCallback(
    async (slug: string): Promise<boolean> => {
      return writing(async () => {
        const result = await latest.current.remove({ project: slug });
        if ("error" in result) {
          setSaveError(result.error);
          setSaved(false);
          return false;
        }
        setSaved(true);
        return true;
      }, false);
    },
    [writing],
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
        const narrowed = data.values.mcp?.[id]?.roles;
        const roles = keptRoles(narrowed, reachable);
        if (narrowed?.length && roles.length === 0) {
          setSaveError(`This server is given to ${narrowed.join(", ")}, and no agent of theirs can reach a ${parsed.connect.type} server. Widen the roles on its own tab first.`);
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
  // The setup screen needs the layers of the project it is pointed at, which is not the one open here.
  const readSettings = useCallback((slug: string) => latest.current.settings({ project: slug }), []);
  return { data, save, reload, saving, saved, saveError, addProject, addServer, attach, detach, listFolders, runDoctor, readStatus, readSettings };
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

/**
 * Who a re-pasted server stays given to.
 *
 * A list the owner emptied is a narrowing to nobody — the resolver reads it that way and really does
 * give the server to no role — so a paste that rotates its token must leave it that way. Reading the
 * empty list as "nothing to preserve" handed the server, and the new token with it, to every role
 * whose agent could reach it, and said only "Saved".
 */
export function keptRoles(narrowed: string[] | undefined, reachable: string[]): string[] {
  return narrowed ? narrowed.filter((role) => reachable.includes(role)) : reachable;
}

/**
 * The agent in force for a role, nearest layer first: a draft the owner is filling in, then the
 * project's settings, then the machine's, then the kit's default.
 *
 * A screen that skipped the two middle layers showed the kit's default as if it were the choice in
 * force, so it offered the wrong agent's model list and wrote the model onto the agent really there.
 */
export function harnessInForce(role: { id: string; defaults: { harness: string } }, ...layers: (Layer | undefined)[]): string {
  for (const layer of layers) {
    const named = layer?.roles?.[role.id]?.harness;
    if (named) return named;
  }
  return role.defaults.harness;
}

/**
 * The model in force for a role, by the resolver's own rule, walked from the lowest layer up: a layer
 * that names another agent drops every model chosen below it, and returning to the role's own agent
 * brings back the kit's choice there. A screen that took the nearest model it could find showed one
 * chosen for an agent no longer in force.
 */
export function modelInForce(role: { id: string; defaults: { harness: string; model?: string } }, ...nearestFirst: (Layer | undefined)[]): string | undefined {
  let harness = role.defaults.harness;
  let model = role.defaults.model;
  for (const layer of [...nearestFirst].reverse()) {
    const choice = layer?.roles?.[role.id];
    if (!choice) continue;
    if (choice.harness && choice.harness !== harness) {
      harness = choice.harness;
      model = choice.harness === role.defaults.harness ? role.defaults.model : undefined;
    }
    if (choice.model) model = choice.model;
  }
  return model;
}

/**
 * The model row a settings screen should show: what is in force, and whether this agent lists it.
 *
 * The resolver does not fence the model against the catalogue — the catalogue is what a screen offers,
 * not a law — so a screen that printed the catalogued model instead of the one in force claimed the
 * seat was running something it was not, and where the agent listed only one it rendered no control to
 * put it right.
 */
export function modelRow(model: string, models: { id: string; label: string }[]): { value: string; options: { label: string; value: string }[]; stray: boolean } {
  const known = models.map((entry) => ({ label: entry.label, value: entry.id }));
  const stray = Boolean(model) && !models.some((entry) => entry.id === model);
  return { value: model, stray, options: stray ? [...known, { label: model, value: model }] : known };
}

export function setAttention(values: Layer, choice: AttentionChoice): Layer {
  return { ...values, attention: { ...values.attention, ...choice } };
}

export function setFlow(values: Layer, choice: { live?: boolean; everySeconds?: number }): Layer {
  return { ...values, flow: { ...values.flow, ...choice } };
}

/**
 * Write, keep or forget the sensor's key.
 *
 * `KEPT` is what a read hands the screen in place of a key that is set, so every save the screen makes
 * carries it back and the key on disk is left alone — including saves about something else entirely,
 * since a write is the whole layer. `null` is the owner forgetting it: the block goes, and with it the
 * paid calls.
 */
export function setSensorKey(values: Layer, key: string | null): Layer {
  const next = { ...values };
  if (key === null) delete next.sensor;
  else next.sensor = { ...next.sensor, key };
  return next;
}

/**
 * Forget a server this layer added, rather than marking it removed.
 *
 * A template from the kit has to stay on record as removed or the kit would switch it back on. One the
 * owner pasted has no template behind it: marking it left the whole entry on disk — its url and its
 * `Authorization` header — with no tab, no switch and no way back, under a screen that had just said
 * removing it drops it.
 */
export function dropMcp(values: Layer, id: string): Layer {
  return prune(values, "mcp", id, {});
}

export function setMcp(values: Layer, id: string, choice: McpChoice): Layer {
  const current = values.mcp?.[id] ?? {};
  const settings = { ...current.settings, ...choice.settings };
  const entry: McpChoice = { ...current, ...choice };
  if (Object.keys(settings).length > 0) entry.settings = settings;
  else delete entry.settings;
  return prune(values, "mcp", id, entry);
}

/**
 * Whether a collapsed lane may show its task counts in place of its Lead.
 *
 * Lanes start collapsed, so for any lane with a live task the Lead's line was never drawn — and that
 * line is the only place the flow screen renders a seat waiting on a permission. A Lead blocked on
 * the owner read as "3 tasks, 1 running" in the same green as a healthy one, and a Lead whose seat
 * had gone read the same with only the colour dropped and the word never shown.
 */
export function countsInstead(lane: { taskCount: number; open: boolean; lead: { status: string; waiting: string[] } | null }): boolean {
  if (lane.taskCount === 0 || lane.open) return false;
  return Boolean(lane.lead) && lane.lead!.status !== "gone" && lane.lead!.waiting.length === 0;
}
