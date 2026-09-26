import { accessSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { delimiter, join } from "node:path";
import { writeConfigAtomic } from "../../core/config-file.ts";
import { nodeBin, stateRoot } from "../../core/paths.ts";
import type { AgentConfig, SessionOpen } from "../../core/ports.ts";
import type { HarnessSpec, Kit, McpServers, RoleSpec } from "../kit/kit.ts";
import { agentDefault } from "../kit/roles.ts";
import { seatOf } from "../kit/roles.ts";
import { preapprovedFor } from "./servers.ts";
import type { Team } from "../team/team.ts";

type RenderPrompt = (role: RoleSpec) => string;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function appendAt(options: unknown, path: string, value: string): Json {
  const root: Json = isObject(options) ? { ...options } : {};
  const parts = path.split(".");
  let cursor = root;
  for (const part of parts.slice(0, -1)) {
    cursor[part] = isObject(cursor[part]) ? { ...cursor[part] } : {};
    cursor = cursor[part] as Json;
  }
  const last = parts[parts.length - 1]!;
  const list = Array.isArray(cursor[last]) ? (cursor[last] as unknown[]) : [];
  cursor[last] = [...new Set([...list, value])];
  return root;
}

/** Only what the role declares it writes: state also holds the desk's record, whose `gate` runs unsandboxed in the daemon. */
export function stateWrites(role: RoleSpec, state: string): string[] {
  return (role.writes ?? []).map((entry) => join(state, entry.replace(/\/$/, "")));
}

export function applyRole(kit: Kit, team: Team, config: AgentConfig, render: RenderPrompt, state?: string, servers: McpServers = {}): AgentConfig {
  const seat = seatOf(kit, config.provider);
  if (!seat) return config;
  const { role, harness } = seat;
  const chosen = team.roles[role.role];
  const sameHarness = chosen?.harness.id === harness.id;
  const models = harness.models ?? [];
  const model =
    models.find((entry) => entry.id === config.model) ??
    (sameHarness ? chosen?.model : undefined) ??
    agentDefault(kit.roles, harness);
  const next: AgentConfig = { ...config };
  if (model) next.model = model.id;
  if (harness.provider.profileModeId) next.modeId = harness.provider.profileModeId;
  const options = model?.thinkingOptions ?? [];
  if (options.length === 0) {
    const owned = sameHarness && chosen?.model?.id === model?.id ? chosen?.thinking : undefined;
    if (owned) next.thinkingOptionId = owned;
    else delete next.thinkingOptionId;
  }
  else {
    const preferred = sameHarness && chosen?.model?.id === model?.id ? chosen?.thinking : undefined;
    const valid = (id: string | undefined) => Boolean(id) && options.some((option) => option.id === id);
    next.thinkingOptionId = [config.thinkingOptionId, preferred].find(valid) ?? (options.find((option) => option.isDefault) ?? options[0])!.id;
  }
  const prompt = render(role);
  next.systemPrompt = config.systemPrompt ? `${prompt}\n\n${config.systemPrompt}` : prompt;
  if (harness.mcp.delivery === "launch" && Object.keys(servers).length > 0) {
    next.mcpServers = { ...(config.mcpServers ?? {}), ...servers };
    if (harness.mcp.preapprove) next.toolPolicy = { preapproved: preapprovedFor(kit, team, role.role).filter((ref) => ref.server in servers || ref.server === "paseo") };
  }
  let providerOptions = config.providerOptions;
  if (harness.stateWrites?.delivery === "launch" && state) {
    for (const path of stateWrites(role, state)) providerOptions = appendAt(providerOptions, harness.stateWrites.path, path);
  }
  if (harness.projectContextOption && config.cwd) providerOptions = appendAt(providerOptions, harness.projectContextOption, config.cwd);
  if (providerOptions !== config.providerOptions) next.providerOptions = providerOptions;
  return next;
}

/** What a seat's rules file takes in of the project's own instructions that its agent reads nowhere else: only while the project has none it reads. */
export function projectImports(harness: HarnessSpec, root: string | undefined): string {
  const spec = harness.projectInstructions;
  if (!spec || !root || spec.reads.some((file) => existsSync(join(root, file)))) return "";
  return spec.otherwise.filter((file) => existsSync(join(root, file))).map((file) => `${spec.importAs.replace("{path}", join(root, file))}\n`).join("");
}

/**
 * The harness's own env goes in too: Paseo may run one agent server for every seat of a harness, built from its built-in provider.
 * `shim` is the directory `seatBin` writes, which goes first on the seat's PATH.
 */
export function seatEnv(kit: Kit, request: SessionOpen, seatPath: string, project: { root: string; state: string }, shim?: string): SessionOpen {
  const seat = seatOf(kit, request.provider);
  if (!seat) return request;
  return {
    ...request,
    env: {
      ...request.env,
      ...seat.harness.provider.env,
      [seat.harness.configDirEnv]: seatPath,
      ...(seat.harness.settings.overlayEnv ? { [seat.harness.settings.overlayEnv]: join(seatPath, seat.harness.settings.file) } : {}),
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
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir || dir === skip) continue;
    try {
      accessSync(join(dir, "git"), constants.X_OK);
      return join(dir, "git");
    } catch {}
  }
  return undefined;
}

/**
 * Writes the directory a seat's PATH starts at, and gives it: a git that runs the kit's git shim with node, the shim and the real
 * git by absolute path, and for each command the kit refuses one that says why and fails. Nothing where this machine has no git.
 */
export function seatBin(kit: Kit, root = stateRoot()): string | undefined {
  const dir = join(root, "bin");
  const git = realGit(dir);
  if (!git) return undefined;
  const wanted: Record<string, string> = { git: `#!/bin/sh\nexec ${quoted(nodeBin())} ${quoted(join(kit.dir, "bin", "git-shim.mjs"))} ${quoted(git)} "$@"\n` };
  for (const [name, why] of Object.entries(kit.refused)) wanted[name] = `#!/bin/sh\necho ${quoted(`${name}: refused: ${why}. Say what you need to whoever gave you the work.`)} >&2\nexit 1\n`;
  mkdirSync(dir, { recursive: true });
  // The directory is the plugin's alone: a command the kit no longer refuses must run again.
  for (const name of readdirSync(dir)) if (!(name in wanted)) rmSync(join(dir, name), { force: true });
  for (const [name, text] of Object.entries(wanted)) {
    const file = join(dir, name);
    if (!existsSync(file) || readFileSync(file, "utf-8") !== text) writeConfigAtomic(file, text, 0o755);
  }
  return dir;
}
