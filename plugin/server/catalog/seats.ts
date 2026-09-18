import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type PromptPaths, renderPrompt, renderText, skillProblems, skillSources } from "./content.ts";
import { type HarnessSpec, type Kit, type McpServers, type RoleSpec, roleSettingsFile } from "./kit.ts";
import { expandHome, guidesDir, home } from "../core/paths.ts";
import { configFault, formatConfig, readConfig, writeConfigAtomic } from "../core/config-file.ts";
import { sameJson } from "../core/store.ts";
import { type Team, rulesFor, skillDirsFor } from "./team.ts";

type Json = Record<string, unknown>;

export type SeatProject = { slug: string; state: string };

export function seatDir(kit: Kit, role: RoleSpec, harness: HarnessSpec, homeDir = home(), project?: SeatProject): string {
  const name = `${kit.prefix}${role.role}-${harness.id}${project ? `-${project.slug}` : ""}`;
  return join(expandHome(harness.profileRoot, homeDir), name);
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function present(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

export function ensureLink(path: string, target: string): boolean {
  if (isLink(path)) {
    if (readlinkSync(path) === target) return false;
    unlinkSync(path);
  } else if (present(path)) {
    // Something real is there — a directory the harness made for itself, most likely. Deleting it to
    // put a link in its place would take whatever it holds, and throwing left the rest of the seat
    // unbuilt, so it is left alone and said out loud.
    throw new LeftAlone(`${path} exists and is not a link, so it was left alone`);
  }
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path);
  return true;
}

export function writeReal(path: string, text: string): boolean {
  if (isLink(path)) unlinkSync(path);
  if (present(path) && readFileSync(path, "utf-8") === text) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return true;
}

function isPlain(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function deepMerge(base: unknown, over: unknown): unknown {
  if (!isPlain(base) || !isPlain(over)) return over === undefined ? base : over;
  const out: Json = { ...base };
  for (const [key, value] of Object.entries(over)) out[key] = deepMerge(base[key], value);
  return out;
}

export function layerSettings(base: unknown, over: unknown): unknown {
  if (Array.isArray(base) && Array.isArray(over)) return [...new Set([...base, ...over])];
  if (!isPlain(base) || !isPlain(over)) return over === undefined ? base : over;
  const out: Json = { ...base };
  for (const [key, value] of Object.entries(over)) out[key] = layerSettings(base[key], value);
  return out;
}

function getPath(value: unknown, path: string[]): unknown {
  let cursor = value;
  for (const part of path) cursor = isPlain(cursor) ? cursor[part] : undefined;
  return cursor;
}

function setPath(target: Json, path: string[], value: unknown): void {
  let cursor = target;
  for (const part of path.slice(0, -1)) {
    if (!isPlain(cursor[part])) cursor[part] = {};
    cursor = cursor[part] as Json;
  }
  const last = path[path.length - 1];
  if (last === undefined) return;
  if (value === undefined) delete cursor[last];
  else cursor[last] = value;
}

export function composeSettings(existing: Json, kitValue: Json, owned: string[]): Json {
  const merged = deepMerge(existing, kitValue) as Json;
  for (const dotted of owned) {
    const path = dotted.split(".");
    setPath(merged, path, getPath(kitValue, path));
  }
  return merged;
}

function writeConfigIfChanged(path: string, value: unknown): boolean {
  if (present(path) && !isLink(path) && sameJson(readConfig(path, null), value)) return false;
  mkdirSync(dirname(path), { recursive: true });
  if (isLink(path)) unlinkSync(path);
  writeConfigAtomic(path, formatConfig(path, value));
  return true;
}

export function seedRecords(kit: Kit, state: string): string[] {
  const templates = join(kit.dir, "content", "records");
  mkdirSync(state, { recursive: true });
  if (!existsSync(templates)) return [];
  const seeded: string[] = [];
  for (const name of readdirSync(templates)) {
    const target = join(state, name);
    if (present(target)) continue;
    writeFileSync(target, readFileSync(join(templates, name), "utf-8"));
    seeded.push(name);
  }
  return seeded;
}

function clearMcp(harness: HarnessSpec, current: Json): Json {
  const next = structuredClone(current);
  const clear = harness.mcp.clear;
  if (!clear) return next;
  for (const [path, value] of Object.entries(clear.set ?? {})) setPath(next, path.split("."), structuredClone(value));
  for (const path of clear.remove ?? []) setPath(next, path.split("."), undefined);
  for (const [path, fields] of Object.entries(clear.setInEach ?? {})) {
    const group = getPath(next, path.split("."));
    if (!isPlain(group)) continue;
    for (const [key, item] of Object.entries(group)) group[key] = { ...(isPlain(item) ? item : {}), ...structuredClone(fields) };
  }
  return next;
}

export function shapeServer(template: unknown, server: Json): unknown {
  if (typeof template === "string") {
    const whole = /^\{(\w+)\}$/.exec(template);
    if (whole) return server[whole[1]!];
    return template.replace(/\{(\w+)\}/g, (text, key: string) => (typeof server[key] === "string" ? String(server[key]) : text));
  }
  if (Array.isArray(template)) {
    return template.flatMap((item) => {
      const spread = typeof item === "string" ? /^\{\.\.\.(\w+)\}$/.exec(item) : null;
      if (spread) {
        const value = server[spread[1]!];
        return Array.isArray(value) ? value : [];
      }
      const value = shapeServer(item, server);
      return value === undefined ? [] : [value];
    });
  }
  if (!isPlain(template)) return template;
  const out: Json = {};
  for (const [key, item] of Object.entries(template)) {
    const value = shapeServer(item, server);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function mcpState(harness: HarnessSpec, current: Json, servers: McpServers): Json {
  const next = clearMcp(harness, current);
  const { delivery, key, shape } = harness.mcp;
  if (delivery !== "file" || !key) return next;
  const shaped = Object.fromEntries(
    Object.entries(servers).map(([name, server]) => {
      const config = server as Json;
      const template = shape?.[config.type as keyof typeof shape];
      return [name, template ? shapeServer(template, config) : config];
    }),
  );
  setPath(next, key.split("."), shaped);
  return next;
}

type Recorder = { changes: string[]; note(changed: boolean, what: string): void; removed(what: string): void };

function recorder(): Recorder {
  const changes: string[] = [];
  return {
    changes,
    note: (changed, what) => {
      if (changed) changes.push(what);
    },
    removed: (what) => changes.push(`${what} removed`),
  };
}

function writeRoleSettings(kit: Kit, harness: HarnessSpec, role: RoleSpec, dir: string, record: Recorder): void {
  const { file, source, ownedPaths } = harness.settings;
  const roleFile = roleSettingsFile(kit, harness, role);
  if (!existsSync(roleFile)) throw new Error(`${role.role}: ${roleFile} is missing`);
  const wanted = layerSettings(readConfig<Json>(join(kit.dir, "harness", harness.id, source), {}), readConfig<Json>(roleFile, {})) as Json;
  const settingsFile = join(dir, file);
  const next = ownedPaths ? composeSettings(isLink(settingsFile) ? {} : readConfig<Json>(settingsFile, {}), wanted, ownedPaths) : wanted;
  record.note(writeConfigIfChanged(settingsFile, next), file);
}

export class LeftAlone extends Error {}

function linkShared(harness: HarnessSpec, dir: string, homeDir: string, record: Recorder): void {
  for (const link of harness.links ?? []) {
    const target = expandHome(link.target, homeDir);
    const path = join(dir, link.link);
    if (existsSync(target)) {
      try {
        record.note(ensureLink(path, target), link.link);
      } catch (error) {
        if (!(error instanceof LeftAlone)) throw error;
        console.error(`seatworks-v2: ${error.message}`);
      }
    }
    else if (link.optional && isLink(path)) {
      unlinkSync(path);
      record.removed(link.link);
    }
  }
}

function writeMcpFile(harness: HarnessSpec, dir: string, servers: McpServers, record: Recorder): void {
  const file = join(dir, harness.mcp.file);
  const fault = configFault(file);
  // Whose document it is decides what to do with an unreadable one. A harness that takes its servers
  // at launch keeps its own things in that file — an account, a machine id, a project history — and
  // the plugin's three-key seed must not replace them. A harness that takes them from the file has
  // nothing else in it, and this file carries the seat's only two tools: leaving it unreadable is a
  // Peer that boots with no way to hand back or ask.
  if (fault && harness.mcp.delivery !== "file") {
    console.error(`seatworks-v2: ${fault}, so its MCP servers were left alone`);
    return;
  }
  if (fault) console.error(`seatworks-v2: ${fault}, and the plugin owns that file, so it was written again`);
  const current = fault ? structuredClone(harness.mcp.seed ?? {}) : readConfig<Json>(file, structuredClone(harness.mcp.seed ?? {}));
  record.note(writeConfigIfChanged(file, mcpState(harness, current, servers)), harness.mcp.file);
}

function removeIfPresent(path: string, what: string, record: Recorder): void {
  if (!present(path)) return;
  unlinkSync(path);
  record.removed(what);
}

function writeInstructions(kit: Kit, team: Team, roleName: string, dir: string, paths: PromptPaths, record: Recorder): void {
  const { role, harness } = team.roles[roleName]!;
  const rules = renderText(kit, role, rulesFor(team, roleName), paths);
  if (harness.systemPrompt === "file" && harness.promptFile) {
    const promptPath = join(dir, harness.promptFile);
    const prompt = renderPrompt(kit, role, paths);
    record.note(writeReal(promptPath, rules ? `${prompt.trimEnd()}\n\n${rules}` : prompt), harness.promptFile);
    return;
  }
  if (!harness.contextFile) return;
  const contextPath = join(dir, harness.contextFile);
  if (rules) record.note(writeReal(contextPath, rules), harness.contextFile);
  else removeIfPresent(contextPath, harness.contextFile, record);
}

function linkSkills(kit: Kit, team: Team, roleName: string, dir: string, record: Recorder): void {
  const { role, harness } = team.roles[roleName]!;
  const skillsDir = join(dir, harness.skillsDir);
  mkdirSync(skillsDir, { recursive: true });
  const wanted = skillSources(kit, role, skillDirsFor(team, roleName));
  for (const [name, source] of wanted) {
    const problems = skillProblems(role, name, source);
    if (problems.length > 0) throw new Error(problems.join("; "));
    record.note(ensureLink(join(skillsDir, name), source), `skill ${name}`);
  }
  for (const name of readdirSync(skillsDir)) {
    const path = join(skillsDir, name);
    if (!wanted.has(name) && isLink(path)) {
      unlinkSync(path);
      record.removed(`skill ${name}`);
    }
  }
}

/**
 * What a seat cannot be built from, said before anything is written.
 *
 * Rendering refuses for a placeholder nothing fills in and for a word the role must not see — and
 * the owner's own rules are folded into that text, so an ordinary line like "leave the Paseo config
 * alone" refuses every Peer. It used to refuse in the middle of building the seat, after the config
 * and the MCP file were written and before the instructions were, which is a seat that boots with no
 * instructions at all. Either the seat is rebuilt or it is left exactly as it was.
 */
export function seatProblems(kit: Kit, team: Team, roleName: string, paths: PromptPaths): string[] {
  const seat = team.roles[roleName];
  if (!seat) return [`the team has no ${roleName} seat`];
  const problems: string[] = [];
  const say = (error: unknown) => problems.push(error instanceof Error ? error.message : String(error));
  try {
    renderText(kit, seat.role, rulesFor(team, roleName), paths);
    if (seat.harness.systemPrompt === "file" && seat.harness.promptFile) renderPrompt(kit, seat.role, paths);
  } catch (error) {
    say(error);
  }
  for (const [name, source] of skillSources(kit, seat.role, skillDirsFor(team, roleName))) {
    problems.push(...skillProblems(seat.role, name, source));
  }
  return problems;
}

export function materialize(kit: Kit, team: Team, roleName: string, homeDir = home(), project?: SeatProject, servers: McpServers = {}): string[] {
  const seat = team.roles[roleName];
  if (!seat) throw new Error(`the team has no ${roleName} seat`);
  const dir = seatDir(kit, seat.role, seat.harness, homeDir, project);
  const paths = { guides: guidesDir(homeDir), state: project?.state ?? "$SEATWORKS_STATE" };
  const problems = seatProblems(kit, team, roleName, paths);
  if (problems.length > 0) throw new Error(problems.join("; "));
  const record = recorder();
  mkdirSync(dir, { recursive: true });
  writeRoleSettings(kit, seat.harness, seat.role, dir, record);
  linkShared(seat.harness, dir, homeDir, record);
  writeMcpFile(seat.harness, dir, servers, record);
  writeInstructions(kit, team, roleName, dir, paths, record);
  linkSkills(kit, team, roleName, dir, record);
  return record.changes;
}
