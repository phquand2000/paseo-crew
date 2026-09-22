import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Cleanliness, git, pristineState } from "../core/git.ts";

/**
 * The team's shared instructions, kept in the served project's own AGENTS.md so every agent that
 * works there reads them the way it reads the Human's: in a marked block the plugin owns and replaces
 * whole, beside whatever the Human wrote, which it never touches. CLAUDE.md gets a pointer to it.
 */
export const BEGIN = "<!-- seatworks:begin (written by Seatworks; edit outside this block, it is replaced whole) -->";
export const END = "<!-- seatworks:end -->";
const POINTER = "@AGENTS.md";

const block = (body: string) => `${BEGIN}\n${body.trim()}\n${END}\n`;

/** The text with the block cut out, so the Human's part can be compared on its own. */
export function withoutBlock(text: string): string {
  const start = text.indexOf(BEGIN.slice(0, 20));
  const end = text.indexOf(END);
  if (start < 0 || end < start) return text;
  return (text.slice(0, start).trimEnd() + "\n" + text.slice(end + END.length).replace(/^\n+/, "")).trim();
}

export function withBlock(text: string, body: string): string {
  const rest = withoutBlock(text);
  return rest ? `${rest}\n\n${block(body)}` : block(body);
}

function pointed(text: string): boolean {
  return text.split("\n").some((line) => line.trim() === POINTER);
}

/** CLAUDE.md is the Human's too: a pointer is added only where it does not already reach AGENTS.md. */
export function withPointer(text: string): string {
  const rest = withoutBlock(text);
  if (pointed(rest)) return rest === text ? text : `${rest}\n`;
  return withBlock(text, POINTER);
}

const read = (file: string) => (existsSync(file) ? readFileSync(file, "utf-8") : "");

/** The files whose text is not what this kit writes there, with the text it would write. */
export function staleProjectFiles(root: string, body: string): { name: string; file: string; wanted: string }[] {
  const stale: { name: string; file: string; wanted: string }[] = [];
  for (const [name, next] of [
    ["AGENTS.md", (text: string) => withBlock(text, body)],
    ["CLAUDE.md", withPointer],
  ] as const) {
    const file = join(root, name);
    const text = read(file);
    const wanted = next(text);
    if (wanted !== text) stale.push({ name, file, wanted });
  }
  return stale;
}

/** Writes only what changed, and returns the files it wrote. */
export function placeProjectFiles(root: string, body: string): string[] {
  const stale = staleProjectFiles(root, body);
  for (const { file, wanted } of stale) writeFileSync(file, wanted);
  return stale.map(({ name }) => name);
}

/**
 * Whether a change git reports in the project's copy is only the plugin's block: the Human's own text
 * in that file is what HEAD holds. A lane may take over a copy whose only uncommitted change is this,
 * because nothing of the Human's rides along with it.
 */
export async function onlyTheBlock(root: string, path: string): Promise<boolean> {
  if (path !== "AGENTS.md" && path !== "CLAUDE.md") return false;
  const head = await git(root, ["show", `HEAD:${path}`]);
  const before = head.code === 0 ? head.stdout : "";
  return withoutBlock(read(join(root, path))).trim() === withoutBlock(before).trim();
}

/** A working copy's state as a writer's work sees it: the plugin's block is nobody's uncommitted work. */
export function workState(cwd: string): Promise<Cleanliness> {
  return pristineState(cwd, (path) => onlyTheBlock(cwd, path));
}

/** Whether the plugin's block is in the project's copy but not in what it has committed, which a copy of its own is made from. */
export async function blockUncommitted(root: string): Promise<boolean> {
  const run = await git(root, ["status", "--porcelain", "--", "AGENTS.md", "CLAUDE.md"]);
  if (run.code !== 0) return false;
  const paths = run.stdout.split("\n").filter(Boolean).map((line) => line.slice(3));
  for (const path of paths) if (await onlyTheBlock(root, path)) return true;
  return false;
}
