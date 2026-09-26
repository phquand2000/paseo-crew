import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { DESK_OWNED } from "../core/paths.ts";
import { hiddenWordsIn } from "./hidden-words.ts";
import { type Kit, type RoleSpec, ownOr } from "./kit.ts";

export type PromptPaths = { guides: string; state: string };

/** What under the project's state a text names that the role neither writes nor reads as the desk's own record. */
function unwritten(role: RoleSpec, text: string): string[] {
  const writes = new Set((role.writes ?? []).map((entry) => entry.replace(/\/$/, "")));
  const named = [...text.matchAll(/(?:\{\{state\}\}|\$SEATWORKS_STATE)\/([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)/g)].map((match) => match[1]!);
  return [...new Set(named)].filter((segment) => !writes.has(segment) && !DESK_OWNED.has(segment));
}

export function renderText(role: RoleSpec, source: string, paths: PromptPaths): string {
  const text = source.replaceAll("{{guides}}", paths.guides).replaceAll("{{state}}", paths.state);
  const leftover = text.match(/\{\{[^}]*\}\}/);
  if (leftover) throw new Error(`the ${role.role} prompt still holds the placeholder ${leftover[0]}`);
  // Checked in the source, not the rendered text: a repo or home path holding a hidden word made the seat unbuildable.
  const hidden = hiddenWordsIn(source, role.hidesWords ?? []);
  if (hidden.length > 0) {
    throw new Error(`the ${role.role} prompt contains words that role must not see: ${hidden.join(", ")}`);
  }
  const loose = unwritten(role, source);
  if (loose.length > 0) throw new Error(`the ${role.role} prompt names ${loose.join(", ")} under the project's state, which the role does not write: add it to the role's writes`);
  return text;
}

/** The role's prompt, then what the harness it sits on needs said against that agent's own instructions, when it ships any. */
export function renderPrompt(kit: Kit, role: RoleSpec, harness: string, paths: PromptPaths): string {
  const prompt = renderText(role, readFileSync(contentPath(kit, role.prompt), "utf-8"), paths);
  const delta = join(kit.dir, "harness", harness, "delta", `${role.role}.md`);
  return existsSync(delta) ? `${prompt.trimEnd()}\n\n${renderText(role, readFileSync(delta, "utf-8"), paths)}` : prompt;
}

function markdownIn(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...markdownIn(path));
    else if (name.endsWith(".md")) found.push(path);
  }
  return found;
}

/** The words a role must not see, looked for in everything of the tools it is given: names, titles, descriptions, and what the server says of them. */
export function toolProblems(kit: Kit, role: RoleSpec): string[] {
  const file = join(kit.dir, "mcp", "tools.json");
  if (!role.tools || !existsSync(file)) return [];
  const tools = (JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown[]>)[role.tools] ?? [];
  const told = join(kit.dir, "mcp", "instructions.json");
  const instructions = existsSync(told) ? ((JSON.parse(readFileSync(told, "utf-8")) as Record<string, string>)[role.tools] ?? "") : "";
  const hidden = hiddenWordsIn(`${JSON.stringify(tools)}\n${instructions}`, role.hidesWords ?? []);
  return hidden.length > 0 ? [`the ${role.tools} tools the ${role.role} is given show words it must not see: ${hidden.join(", ")}`] : [];
}

export function skillProblems(role: RoleSpec, name: string, dir: string): string[] {
  const problems: string[] = [];
  for (const file of markdownIn(dir)) {
    const text = readFileSync(file, "utf-8");
    const leftover = text.match(/\{\{[^}]*\}\}/);
    if (leftover) problems.push(`skill ${name} holds ${leftover[0]} in ${basename(file)}, and a skill is read as written, so nothing fills it in`);
    const hidden = hiddenWordsIn(text, role.hidesWords ?? []);
    if (hidden.length > 0) problems.push(`skill ${name} shows the ${role.role} words it must not see in ${basename(file)}: ${hidden.join(", ")}`);
    const loose = unwritten(role, text);
    if (loose.length > 0) problems.push(`skill ${name} names ${loose.join(", ")} under the project's state in ${basename(file)}, which the ${role.role} does not write: add it to the role's writes`);
  }
  return problems;
}

function skillDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((name) => statSync(join(root, name)).isDirectory());
}

/** A preset outside this package names its own files, so an absolute path is taken as given. */
function contentPath(kit: Kit, path: string): string {
  return isAbsolute(path) ? path : ownOr(kit, path);
}

export function skillSources(kit: Kit, role: RoleSpec, extra: Map<string, string> = new Map()): Map<string, string> {
  const root = join(kit.dir, "content", "skills");
  const found = new Map<string, string>();
  if (role.skills) {
    const own = isAbsolute(role.skills) ? role.skills : join(root, role.skills);
    for (const name of skillDirs(own)) found.set(name, isAbsolute(role.skills) ? join(own, name) : ownOr(kit, `skills/${role.skills}/${name}`));
  }
  for (const extra of role.extraSkills ?? []) {
    const [set, name] = extra.split(":") as [string, string];
    const dir = ownOr(kit, `skills/${set}/${name}`);
    if (!existsSync(join(dir, "SKILL.md"))) throw new Error(`role ${role.role} names extra skill ${extra}, but ${dir}/SKILL.md is missing`);
    found.set(name, dir);
  }
  for (const [name, dir] of extra) found.set(name, dir);
  return found;
}
