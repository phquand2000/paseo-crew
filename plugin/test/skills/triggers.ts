import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { skillSources } from "../../server/catalog/content.ts";
import type { Kit } from "../../server/catalog/kit.ts";

export type TriggerCase = { brief: string; expect: string[]; near?: string };

export const casesFile = join(dirname(fileURLToPath(import.meta.url)), "triggers.json");

export function loadCases(): Record<string, TriggerCase[]> {
  return JSON.parse(readFileSync(casesFile, "utf-8")) as Record<string, TriggerCase[]>;
}

export function skillCards(kit: Kit, role: string): Map<string, string> {
  const spec = kit.roles.find((one) => one.role === role);
  if (!spec) throw new Error(`the kit has no role ${role}`);
  const cards = new Map<string, string>();
  for (const [name, dir] of skillSources(kit, spec)) {
    const head = readFileSync(join(dir, "SKILL.md"), "utf-8").match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
    const description = head.match(/^description:\s*(.*)$/m)?.[1]?.trim().replace(/^"(.*)"$/, "$1").replaceAll('\\"', '"');
    if (!description) throw new Error(`skill ${name} has no description`);
    cards.set(name, description);
  }
  return cards;
}

export function triggerPrompt(role: string, cards: Map<string, string>, brief: string): string {
  const list = [...cards].map(([name, description]) => `- ${name}: ${description}`).join("\n");
  return [
    `You are the ${role} on a software project. These skills are available; each is a folder of instructions you can open before you start work:`,
    list,
    "",
    "Your brief:",
    brief,
    "",
    'Before starting, which of these skills, if any, would you open? Do not do the work. Answer with only JSON: {"skills": ["name", ...]}, or {"skills": []} for none.',
  ].join("\n");
}

export function openedSkills(answer: string): string[] | undefined {
  const matches = [...answer.matchAll(/\{[^{}]*"skills"\s*:\s*\[[^\]]*\][^{}]*\}/g)];
  const last = matches.at(-1)?.[0];
  if (!last) return undefined;
  try {
    const skills = (JSON.parse(last) as { skills: unknown }).skills;
    return Array.isArray(skills) ? skills.filter((one): one is string => typeof one === "string") : undefined;
  } catch {
    return undefined;
  }
}

export function rightRun(test: TriggerCase, opened: string[]): boolean {
  if (test.near && opened.includes(test.near)) return false;
  return test.expect.length === 0 ? opened.length === 0 : opened.some((one) => test.expect.includes(one));
}
