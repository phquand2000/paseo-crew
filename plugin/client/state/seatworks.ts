import { useRpc, usePaseo } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { catalogRpc, doctorRpc, flowRpc, mcpParseRpc, pathsRpc, projectsAddRpc, projectsCandidatesRpc, projectsRemoveRpc, projectsRpc, settingsReadRpc, settingsWriteRpc, statusRpc, teamRpc } from "../../shared/rpc.ts";
import type { Layer } from "../../shared/settings.ts";
import type { CatalogView, ProjectRow, TeamView } from "../../shared/views.ts";
import { message } from "../format/error.ts";
import { type InForce, foldRoles, harnessInForce, keptRoles, setMcp } from "../model/layer.ts";

export type PaseoProject = { name: string; root: string };

type Data =
  | { status: "loading" }
  | { status: "error"; error: string }
  | {
      status: "ready";
      of: string;
      catalog: CatalogView;
      team: TeamView;
      projects: ProjectRow[];
      known: PaseoProject[];
      candidates: PaseoProject[];
      values: Layer;
      machine: Layer;
      revision: string;
      settingsError: string | null;
    };

/** The projects Paseo itself knows, which a setup screen offers; none when Paseo cannot say. */
async function paseoProjects(paseo: ReturnType<typeof usePaseo>): Promise<PaseoProject[]> {
  try {
    const listed = (await paseo.projects.list()) as { projects?: { projectDisplayName?: string; projectRootPath?: string }[] };
    return (listed.projects ?? [])
      .filter((entry): entry is { projectDisplayName?: string; projectRootPath: string } => typeof entry.projectRootPath === "string")
      .map((entry) => ({ name: entry.projectDisplayName ?? entry.projectRootPath, root: entry.projectRootPath }));
  } catch {
    return [];
  }
}

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
  const latest = useRef(bound);
  latest.current = bound;
  const [data, setData] = useState<Data>({ status: "loading" });
  const [saving, setSaving] = useState(false);
  // Set by a save, cleared by its reload: the controls stay locked until drawn from what it produced.
  const settling = useRef(false);
  // Tagged with its screen: the hook serves every screen, and an untagged refusal showed on all of them.
  const [refusal, setRefusal] = useState<{ of: string; text: string } | null>(null);
  // A ref, so a callback built on an earlier render still tags the screen open now.
  const here = useRef(project ?? "");
  here.current = project ?? "";
  const setSaveError = useCallback((text: string | null) => setRefusal(text === null ? null : { of: here.current, text }), []);
  const saveError = refusal?.of === (project ?? "") ? refusal.text : null;
  // Whether the last write went; inferring it from no error here read another screen's refusal as success.
  const [saved, setSaved] = useState<boolean | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async (): Promise<void> => {
      const call = latest.current;
      const [catalog, projects, team, settings, known] = await Promise.all([
        call.catalog({}),
        call.projects({}),
        call.team({ project }),
        call.settings({ project }),
        paseoProjects(paseo),
      ]);
      const offerable = new Set(known.length > 0 ? await call.candidates({ roots: known.map((entry) => entry.root) }) : []);
      if (!alive) return;
      if ("error" in team) throw new Error(team.error);
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
    // Only a move to another screen blanks it: blanking on a save's reload remounted every section and lost its local state.
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
   * Every desk write runs inside this: locked, refusal cleared, ending in a reload the controls stay locked until;
   * unlocking earlier let a click built on the pre-save view silently undo the save.
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
          // A write is the whole layer, so the draft is folded into what the project holds; alone it erased rules, servers and tuning.
          const catalogue = data.status === "ready" ? data.catalog.roles : [];
          const merged = foldRoles(read.values, values, (role) => {
            const spec = catalogue.find((entry) => entry.id === role);
            return spec ? harnessInForce(spec, read.values, read.machine) : undefined;
          });
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
    // `data` for the catalog's default harness; without it the callback keeps the first render's empty catalog.
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
        // Only to roles whose agent can reach it: otherwise it was refused, and the narrowing control appears only once saved.
        if (data.status !== "ready") return null;
        const harnessOf = (role: InForce) => harnessInForce(role, data.values, data.machine);
        const reachable = data.catalog.roles
          .filter((role) => (data.catalog.harnesses.find((entry) => entry.id === harnessOf(role))?.transports ?? []).includes(parsed.connect.type))
          .map((role) => role.id);
        if (reachable.length === 0) {
          setSaveError(`No role's agent can reach a ${parsed.connect.type} server, so there is nobody to give it to.`);
          return null;
        }
        // A re-paste updates the connection, so the owner's narrowing is kept, intersected with what can reach the transport.
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
