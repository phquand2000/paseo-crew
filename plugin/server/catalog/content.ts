import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import type { Kit, RoleSpec } from "./kit.ts";

export type PromptPaths = { guides: string; state: string };

export function hiddenWordsIn(text: string, words: string[]): string[] {
  return words.filter((word) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
}

export function renderText(kit: Kit, role: RoleSpec, source: string, paths: PromptPaths): string {
  const text = source.replaceAll("{{guides}}", paths.guides).replaceAll("{{state}}", paths.state);
  const leftover = text.match(/\{\{[^}]*\}\}/);
  if (leftover) throw new Error(`the ${role.role} prompt still holds the placeholder ${leftover[0]}`);
  const hidden = hiddenWordsIn(text, role.hidesWords ?? []);
  if (hidden.length > 0) {
    throw new Error(`the ${role.role} prompt contains words that role must not see: ${hidden.join(", ")}`);
  }
  return text;
}

export function renderPrompt(kit: Kit, role: RoleSpec, paths: PromptPaths): string {
  return renderText(kit, role, readFileSync(contentPath(kit, role.prompt), "utf-8"), paths);
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

export function skillProblems(role: RoleSpec, name: string, dir: string): string[] {
  const problems: string[] = [];
  for (const file of markdownIn(dir)) {
    const text = readFileSync(file, "utf-8");
    const leftover = text.match(/\{\{[^}]*\}\}/);
    if (leftover) problems.push(`skill ${name} holds ${leftover[0]} in ${basename(file)}, and a skill is read as written, so nothing fills it in`);
    const hidden = hiddenWordsIn(text, role.hidesWords ?? []);
    if (hidden.length > 0) problems.push(`skill ${name} shows the ${role.role} words it must not see in ${basename(file)}: ${hidden.join(", ")}`);
  }
  return problems;
}

function skillDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((name) => statSync(join(root, name)).isDirectory());
}

/** A preset outside this package names its own files, so an absolute path is taken as given. */
export function contentPath(kit: Kit, path: string): string {
  return isAbsolute(path) ? path : join(kit.dir, "content", path);
}

export function skillSources(kit: Kit, role: RoleSpec, extra: Map<string, string> = new Map()): Map<string, string> {
  const root = join(kit.dir, "content", "skills");
  const found = new Map<string, string>();
  if (role.skills) {
    const own = isAbsolute(role.skills) ? role.skills : join(root, role.skills);
    for (const name of skillDirs(own)) found.set(name, join(own, name));
  }
  for (const extra of role.extraSkills ?? []) {
    const [set, name] = extra.split(":");
    if (!set || !name) throw new Error(`role ${role.role} names extra skill "${extra}"; write it as set:name`);
    const dir = join(root, set, name);
    if (!existsSync(join(dir, "SKILL.md"))) throw new Error(`role ${role.role} names extra skill ${extra}, but ${dir}/SKILL.md is missing`);
    found.set(name, dir);
  }
  for (const [name, dir] of extra) found.set(name, dir);
  return found;
}

/**
 * What the desk writes under a project's state itself. Content names some of these for a seat to
 * read — the event log, the hand-back files — and none of them is a seat's to write.
 */
export const DESK_OWNED = new Set(["ledger.json", "watching.json", "project.json", "meta.json", "settings.json", "status.md", "events.log", "attention.log", "handbacks", "gates"]);

/**
 * Every place under the project's state this role's own content tells it to write: its prompt and
 * every skill the seat is given, read for `{{state}}/…` and `$SEATWORKS_STATE/…`.
 *
 * Derived rather than listed, because the list drifted the moment it was written by hand: it named
 * the two places the prompts mention, while the skills in the same seats run scripts that write under
 * `ultra-review/`, `council/`, `repo-refresh/`, `pre-mortem/` — and a sandboxed shell refused every one.
 */
export function stateTargets(kit: Kit, role: RoleSpec, extra: Map<string, string> = new Map()): string[] {
  const texts: string[] = [];
  const prompt = contentPath(kit, role.prompt);
  if (existsSync(prompt)) texts.push(readFileSync(prompt, "utf-8"));
  for (const dir of skillSources(kit, role, extra).values()) for (const file of markdownIn(dir)) texts.push(readFileSync(file, "utf-8"));
  const found = new Set<string>();
  for (const text of texts) for (const match of text.matchAll(/(?:\{\{state\}\}|\$SEATWORKS_STATE)\/([A-Za-z0-9_.-]+)/g)) found.add(match[1]!);
  return [...found].filter((segment) => !DESK_OWNED.has(segment)).sort();
}
