import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A page a project may keep so that what it decided survives the context it was decided in.
 *
 * Nothing here is on by default and nothing requires it. Measured: a context file that restates the
 * repository does not improve an agent's results and costs over a fifth more to carry, and a curated
 * page makes some tasks worse rather than better. So the set is a shelf, the owner takes what its
 * project needs, and a page nobody activated does not exist as far as the desk is concerned.
 */
export type TemplateSpec = {
  name: string;
  owns: string;
  prevents: string;
  activate: string;
  ceremony: string;
  body: string;
};

function frontMatter(text: string): { fields: Record<string, string>; body: string } {
  if (!text.startsWith("---\n")) return { fields: {}, body: text };
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) return { fields: {}, body: text };
  const fields: Record<string, string> = {};
  for (const line of text.slice(4, end).split("\n")) {
    const at = line.indexOf(":");
    if (at > 0) fields[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return { fields, body: text.slice(end + 5) };
}

export function loadTemplates(dir: string): Record<string, TemplateSpec> {
  const root = join(dir, "content", "templates");
  if (!existsSync(root)) return {};
  const found: Record<string, TemplateSpec> = {};
  for (const file of readdirSync(root).filter((name) => name.endsWith(".md"))) {
    const { fields, body } = frontMatter(readFileSync(join(root, file), "utf-8"));
    const name = fields.name ?? file.replace(/\.md$/, "");
    found[name] = {
      name,
      owns: fields.owns ?? "",
      prevents: fields.prevents ?? "",
      activate: fields.activate ?? "",
      ceremony: fields.ceremony ?? "",
      body,
    };
  }
  return found;
}

export function docsDir(state: string): string {
  return join(state, "docs");
}

export function docFile(state: string, name: string): string {
  return join(docsDir(state), `${name}.md`);
}

/** Puts the skeleton where the project can reach it, and never over anything already written there. */
export function placeDoc(state: string, spec: TemplateSpec): { file: string; written: boolean } {
  const file = docFile(state, spec.name);
  if (existsSync(file)) return { file, written: false };
  mkdirSync(docsDir(state), { recursive: true });
  writeFileSync(file, spec.body);
  return { file, written: true };
}
