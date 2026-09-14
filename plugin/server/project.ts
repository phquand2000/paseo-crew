import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { stateRoot } from "./paths.ts";

export type Project = { root: string; slug: string; state: string };

const cache = new Map<string, Project>();

export function gitRoot(cwd: string): string {
  try {
    const out = execFileSync("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!out) return cwd;
    return basename(out) === ".git" ? dirname(out) : out;
  } catch {
    return cwd;
  }
}

export function slugFor(root: string): string {
  const name =
    basename(root)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "project";
  return `${name}-${createHash("sha1").update(root).digest("hex").slice(0, 6)}`;
}

export function projectOf(cwd: string, base = stateRoot(), rootOf: (cwd: string) => string = gitRoot): Project {
  const key = `${base}\n${cwd}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const root = rootOf(cwd);
  const slug = slugFor(root);
  const project = { root, slug, state: join(base, "projects", slug) };
  cache.set(key, project);
  return project;
}

export function clearProjects(): void {
  cache.clear();
}
