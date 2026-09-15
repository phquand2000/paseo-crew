import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { renderContent, renderPrompt, skillSources } from "./content.ts";
import { type Kit, type McpServers, type RoleSpec, harnessOf, mcpServersFor } from "./kit.ts";
import { expandHome, guidesDir, home } from "./paths.ts";
import { readJson, sameJson } from "./store.ts";

type Json = Record<string, unknown>;

export function seatDir(kit: Kit, role: RoleSpec, homeDir = home()): string {
  return join(expandHome(harnessOf(kit, role).profileRoot, homeDir), `${kit.prefix}${role.role}`);
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
    throw new Error(`${path} exists and is not a link, so it was left alone`);
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

function writeJsonIfChanged(path: string, value: unknown): boolean {
  if (present(path) && sameJson(readJson(path, null), value)) return false;
  mkdirSync(dirname(path), { recursive: true });
  if (isLink(path)) unlinkSync(path);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
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

export function materialize(kit: Kit, role: RoleSpec, homeDir = home(), team: McpServers = {}): string[] {
  const harness = harnessOf(kit, role);
  const dir = seatDir(kit, role, homeDir);
  const changes: string[] = [];
  const note = (changed: boolean, what: string) => {
    if (changed) changes.push(what);
  };
  mkdirSync(dir, { recursive: true });

  const harnessDir = join(kit.dir, "harness", harness.id);
  const settingsFile = join(dir, harness.settings.file);
  if (harness.settings.mode === "link") {
    const source = join(harnessDir, harness.settings.source.replace("ROLE", role.role));
    if (!existsSync(source)) throw new Error(`${role.role}: ${source} is missing`);
    note(ensureLink(settingsFile, source), harness.settings.file);
  } else {
    const base = readJson<Json>(join(harnessDir, harness.settings.source), {});
    const overlayFile = harness.settings.roleSource?.replace("ROLE", role.role);
    const overlay = overlayFile ? readJson<Json>(join(harnessDir, overlayFile), {}) : {};
    const kitValue = deepMerge(base, overlay) as Json;
    const next = composeSettings(readJson<Json>(settingsFile, {}), kitValue, harness.settings.ownedPaths ?? []);
    note(writeJsonIfChanged(settingsFile, next), harness.settings.file);
  }

  for (const link of harness.links ?? []) {
    const target = expandHome(link.target, homeDir);
    const path = join(dir, link.link);
    if (existsSync(target)) note(ensureLink(path, target), link.link);
    else if (link.optional && isLink(path)) {
      unlinkSync(path);
      changes.push(`${link.link} removed`);
    }
  }

  if (harness.state?.file) {
    const stateFile = join(dir, harness.state.file);
    const servers = mcpServersFor(kit, role, harness.systemPrompt === "config" ? {} : team);
    if (harness.state.file === ".claude.json") {
      const seed = JSON.parse(harness.state.seed ?? "{}") as Json;
      const current = readJson<Json>(stateFile, seed);
      const next: Json = { ...current, mcpServers: servers, enabledMcpjsonServers: [] };
      delete next.enableAllProjectMcpServers;
      if (isPlain(next.projects)) {
        next.projects = Object.fromEntries(
          Object.entries(next.projects).map(([key, value]) => [key, { ...(isPlain(value) ? value : {}), mcpServers: {} }]),
        );
      }
      note(writeJsonIfChanged(stateFile, next), harness.state.file);
    } else {
      note(writeJsonIfChanged(stateFile, { mcpServers: servers }), harness.state.file);
    }
  }

  const paths = { guides: guidesDir(homeDir), state: "$SEATWORKS_STATE" };
  const rules = !role.headless && kit.rules ? renderContent(kit, role, kit.rules, paths) : "";
  if (harness.systemPrompt === "file" && harness.promptFile) {
    const promptPath = join(dir, harness.promptFile);
    if (role.headless) {
      if (present(promptPath)) {
        unlinkSync(promptPath);
        changes.push(`${harness.promptFile} removed`);
      }
    } else {
      const prompt = renderPrompt(kit, role, paths);
      note(writeReal(promptPath, rules ? `${prompt.trimEnd()}\n\n${rules}` : prompt), harness.promptFile);
    }
  } else if (harness.contextFile && rules) {
    note(writeReal(join(dir, harness.contextFile), rules), harness.contextFile);
  }

  const skillsDir = join(dir, harness.skillsDir);
  mkdirSync(skillsDir, { recursive: true });
  const wanted = skillSources(kit, role);
  for (const [name, source] of wanted) note(ensureLink(join(skillsDir, name), source), `skill ${name}`);
  for (const name of readdirSync(skillsDir)) {
    const path = join(skillsDir, name);
    if (!wanted.has(name) && isLink(path)) {
      unlinkSync(path);
      changes.push(`skill ${name} removed`);
    }
  }
  return changes;
}
