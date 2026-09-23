import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Cleanliness, git, pristineState, uncommittedPaths } from "../core/git.ts";

export const BEGIN = "<!-- paseo-crew:begin (written by Paseo Crew; edit outside this block, it is replaced whole) -->";
export const END = "<!-- paseo-crew:end -->";
const POINTER = "@AGENTS.md";

const block = (body: string) => `${BEGIN}\n${body.trim()}\n${END}\n`;

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

/** Without the pointer only the plugin's own block goes: a file left holding nothing else was the plugin's to begin with. */
function withoutPointer(text: string): string | undefined {
  const rest = withoutBlock(text);
  if (rest === text) return text;
  return rest ? `${rest}\n` : undefined;
}

const read = (file: string) => (existsSync(file) ? readFileSync(file, "utf-8") : "");

/** `wanted` undefined: the file goes. */
export type ProjectFile = { name: string; file: string; wanted: string | undefined };

export function staleProjectFiles(root: string, body: string, { claudePointer = true }: { claudePointer?: boolean } = {}): ProjectFile[] {
  const stale: ProjectFile[] = [];
  for (const [name, next] of [
    ["AGENTS.md", (text: string) => withBlock(text, body)],
    ["CLAUDE.md", claudePointer ? withPointer : withoutPointer],
  ] as const) {
    const file = join(root, name);
    const text = read(file);
    const wanted = next(text);
    if (wanted !== text) stale.push({ name, file, wanted });
  }
  return stale;
}

export function writeProjectFile({ file, wanted }: ProjectFile): void {
  if (wanted === undefined) rmSync(file, { force: true });
  else writeFileSync(file, wanted);
}

export function placeProjectFiles(root: string, body: string, options: { claudePointer?: boolean } = {}): string[] {
  const stale = staleProjectFiles(root, body, options);
  for (const entry of stale) writeProjectFile(entry);
  return stale.map(({ name }) => name);
}

/** A lane may take over a copy whose only uncommitted change is the plugin's block: none of the Human's text rides along. */
export async function onlyTheBlock(root: string, path: string): Promise<boolean> {
  if (path !== "AGENTS.md" && path !== "CLAUDE.md") return false;
  const head = await git(root, ["show", `HEAD:${path}`]);
  const before = head.code === 0 ? head.stdout : "";
  return withoutBlock(read(join(root, path))).trim() === withoutBlock(before).trim();
}

export function workState(cwd: string): Promise<Cleanliness> {
  return pristineState(cwd, (path) => onlyTheBlock(cwd, path));
}

/** The paths `workState` counts, so what the Supervisor is shown is what a lane takeover would refuse over. */
export function uncommittedWork(cwd: string): Promise<string[] | undefined> {
  return uncommittedPaths(cwd, (path) => onlyTheBlock(cwd, path));
}

/** A copy of its own is made from what is committed, so a block only in the working copy is missing there. */
export async function blockUncommitted(root: string): Promise<boolean> {
  const run = await git(root, ["status", "--porcelain", "--", "AGENTS.md", "CLAUDE.md"]);
  if (run.code !== 0) return false;
  const paths = run.stdout.split("\n").filter(Boolean).map((line) => line.slice(3));
  for (const path of paths) if (await onlyTheBlock(root, path)) return true;
  return false;
}
