import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Kit, RoleSpec } from "./kit.ts";

export type PromptPaths = { guides: string; state: string };

export function hiddenWordsIn(text: string, words: string[]): string[] {
  return words.filter((word) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
}

export function renderPrompt(kit: Kit, role: RoleSpec, paths: PromptPaths): string {
  const source = readFileSync(join(kit.dir, "content", role.prompt), "utf-8");
  const text = source
    .replaceAll("{{guides}}", paths.guides)
    .replaceAll("{{state}}", paths.state)
    .replace(/\{\{profile:([a-z0-9-]+)\}\}/g, (_match, name: string) => {
      if (!kit.roles.some((entry) => entry.role === name)) {
        throw new Error(`the ${role.role} prompt names the profile of unknown role ${name}`);
      }
      return `${kit.prefix}${name}`;
    });
  const hidden = hiddenWordsIn(text, role.hidesWords ?? []);
  if (hidden.length > 0) {
    throw new Error(`the ${role.role} prompt contains words that role must not see: ${hidden.join(", ")}`);
  }
  return text;
}

function skillDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((name) => statSync(join(root, name)).isDirectory());
}

export function skillSources(kit: Kit, role: RoleSpec): Map<string, string> {
  const root = join(kit.dir, "content", "skills");
  const found = new Map<string, string>();
  if (role.skills) {
    for (const name of skillDirs(join(root, role.skills))) found.set(name, join(root, role.skills, name));
  }
  for (const extra of role.extraSkills ?? []) {
    const [set, name] = extra.split(":");
    if (!set || !name) throw new Error(`role ${role.role} names extra skill "${extra}"; write it as set:name`);
    const dir = join(root, set, name);
    if (!existsSync(join(dir, "SKILL.md"))) throw new Error(`role ${role.role} names extra skill ${extra}, but ${dir}/SKILL.md is missing`);
    found.set(name, dir);
  }
  return found;
}
