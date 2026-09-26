import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { delimiter, join } from "node:path";
import { writeConfigAtomic } from "../../core/config-file.ts";
import { executableIn, nodeBin, pathDirs, stateRoot } from "../../core/paths.ts";
import type { AgentConfig, SessionOpen } from "../../core/ports.ts";
import { type Json, layered, setPath } from "../../core/json.ts";
import {
  type HarnessSpec,
  type Kit,
  type McpServers,
  type ModelSpec,
  PASEO_SERVER,
  type RoleSpec,
} from "../kit/kit.ts";
import { agentDefault, seatOf } from "../kit/roles.ts";
import type { Team } from "../team/team.ts";
import { preapprovedFor } from "./servers.ts";

type RenderPrompt = (role: RoleSpec) => string;

/** Only what the role declares it writes: state also holds the desk's record, whose `gate` runs unsandboxed in the daemon. */
export function stateWrites(role: RoleSpec, state: string): string[] {
  return (role.writes ?? []).map((entry) => join(state, entry.replace(/\/$/, "")));
}

/** A seat's launch config as its role and the team make it: model, thinking, prompt, MCP servers and provider options. */
export function applyRole(
  kit: Kit,
  team: Team,
  config: AgentConfig,
  render: RenderPrompt,
  state?: string,
  servers: McpServers = {},
): AgentConfig {
  const seat = seatOf(kit, config.provider);
  if (!seat) return config;
  const { role, harness } = seat;
  const next: AgentConfig = { ...config };
  const { model, preferred } = modelOf(kit, team, config, role, harness);
  if (model) next.model = model.id;
  if (harness.provider.profileModeId) next.modeId = harness.provider.profileModeId;
  const thinking = thinkingOf(config.thinkingOptionId, model, preferred);
  if (thinking !== undefined) next.thinkingOptionId = thinking;
  else delete next.thinkingOptionId;
  const prompt = render(role);
  next.systemPrompt = config.systemPrompt ? `${prompt}\n\n${config.systemPrompt}` : prompt;
  if (harness.mcp.delivery === "launch" && Object.keys(servers).length > 0) {
    next.mcpServers = { ...(config.mcpServers ?? {}), ...servers };
    if (harness.mcp.preapprove) {
      const preapproved = preapprovedFor(kit, team, role.role);
      next.toolPolicy = {
        preapproved: preapproved.filter((ref) => ref.server in servers || ref.server === PASEO_SERVER),
      };
    }
  }
  const providerOptions = providerOptionsOf(harness, role, config, state);
  if (providerOptions !== config.providerOptions) next.providerOptions = providerOptions;
  return next;
}

/** Paseo's model where the catalog lists it, else the team's for the role on this harness, else the agent's default; and the thinking the team chose for that model. */
function modelOf(
  kit: Kit,
  team: Team,
  config: AgentConfig,
  role: RoleSpec,
  harness: HarnessSpec,
): { model?: ModelSpec; preferred?: string } {
  const chosen = team.roles[role.role];
  const own = chosen?.harness.id === harness.id ? chosen : undefined;
  const listed = (harness.models ?? []).find((entry) => entry.id === config.model);
  const model = listed ?? own?.model ?? agentDefault(kit.roles, harness);
  return { model, preferred: own && own.model?.id === model?.id ? own.thinking : undefined };
}

/** Paseo's thinking where the model offers it, else the team's, else the model's default; with no options offered, only the team's. */
function thinkingOf(
  given: string | undefined,
  model: ModelSpec | undefined,
  preferred: string | undefined,
): string | undefined {
  const options = model?.thinkingOptions ?? [];
  if (options.length === 0) return preferred || undefined;
  const valid = (id: string | undefined) => Boolean(id) && options.some((option) => option.id === id);
  return [given, preferred].find(valid) ?? (options.find((option) => option.isDefault) ?? options[0])!.id;
}

/** The paths the role writes under the state, and the project as its context, where the harness takes them at launch. */
function providerOptionsOf(
  harness: HarnessSpec,
  role: RoleSpec,
  config: AgentConfig,
  state: string | undefined,
): Json | undefined {
  let options = config.providerOptions;
  if (harness.stateWrites?.delivery === "launch" && state)
    for (const path of stateWrites(role, state)) options = appendAt(options, harness.stateWrites.path, path);
  if (harness.projectContextOption && config.cwd) options = appendAt(options, harness.projectContextOption, config.cwd);
  return options;
}

/** `options` with `value` added to the list at the dot path `path`, the records on the way copied rather than changed. */
function appendAt(options: Json | undefined, path: string, value: string): Json {
  const added: Json = {};
  setPath(added, path.split("."), [value]);
  return layered(options, added) as Json;
}

/** What a seat's rules file takes in of the project's own instructions that its agent reads nowhere else: only while the project has none it reads. */
export function projectImports(harness: HarnessSpec, root: string | undefined): string {
  const spec = harness.projectInstructions;
  if (!spec || !root || spec.reads.some((file) => existsSync(join(root, file)))) return "";
  return spec.otherwise
    .filter((file) => existsSync(join(root, file)))
    .map((file) => `${spec.importAs.replace("{path}", join(root, file))}\n`)
    .join("");
}

/**
 * The harness's own env goes in too: Paseo may run one agent server for every seat of a harness, built from its built-in provider.
 * `shim` is the directory `seatBin` writes, which goes first on the seat's PATH.
 */
export function seatEnv(
  kit: Kit,
  request: SessionOpen,
  seatPath: string,
  project: { root: string; state: string },
  shim?: string,
): SessionOpen {
  const seat = seatOf(kit, request.provider);
  if (!seat) return request;
  return {
    ...request,
    env: {
      ...request.env,
      ...seat.harness.provider.env,
      [seat.harness.configDirEnv]: seatPath,
      ...(seat.harness.settings.overlayEnv
        ? { [seat.harness.settings.overlayEnv]: join(seatPath, seat.harness.settings.file) }
        : {}),
      SEATWORKS_ROLE: seat.role.role,
      SEATWORKS_PROJECT: project.root,
      SEATWORKS_STATE: project.state,
      ...(shim ? { PATH: [shim, request.env.PATH ?? process.env.PATH].filter(Boolean).join(delimiter) } : {}),
    },
  };
}

const quoted = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

/** The git a seat's PATH finds past the shim: the shim's directory is skipped, since what is there is named git too. */
function realGit(skip: string): string | undefined {
  return executableIn(
    pathDirs().filter((dir) => dir && dir !== skip),
    "git",
  );
}

/**
 * Writes the directory a seat's PATH starts at, and gives it: a git that runs the kit's git shim with node, the shim and the real
 * git by absolute path, and for each command the kit refuses one that says why and fails. Nothing where this machine has no git.
 */
export function seatBin(kit: Kit, root = stateRoot()): string | undefined {
  const dir = join(root, "bin");
  const git = realGit(dir);
  if (!git) return undefined;
  const wanted: Record<string, string> = {
    git: `#!/bin/sh\nexec ${quoted(nodeBin())} ${quoted(join(kit.dir, "bin", "git-shim.mjs"))} ${quoted(git)} "$@"\n`,
  };
  for (const [name, why] of Object.entries(kit.refused))
    wanted[name] =
      `#!/bin/sh\necho ${quoted(`${name}: refused: ${why}. Say what you need to whoever gave you the work.`)} >&2\nexit 1\n`;
  mkdirSync(dir, { recursive: true });
  // The directory is the plugin's alone: a command the kit no longer refuses must run again.
  for (const name of readdirSync(dir)) if (!(name in wanted)) rmSync(join(dir, name), { force: true });
  for (const [name, text] of Object.entries(wanted)) {
    const file = join(dir, name);
    if (!existsSync(file) || readFileSync(file, "utf-8") !== text) writeConfigAtomic(file, text, 0o755);
  }
  return dir;
}
