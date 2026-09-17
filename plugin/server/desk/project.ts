import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { gitCommonDir } from "../core/git.ts";
import { stateRoot } from "../core/paths.ts";
import { SERIAL_ONLY } from "../core/scope.ts";
import { readJson, writeJson } from "../core/store.ts";

export type Project = { root: string; slug: string; state: string };

export type GateOn = "lane" | "task";

export type ProjectConfig = { base?: string; gate?: string; gateTimeoutMinutes: number; gateOn: GateOn; serialOnly: string[]; docs: string[] };

const cache = new Map<string, Project>();

export function gitRoot(cwd: string): string {
  const common = gitCommonDir(cwd);
  if (!common) return cwd;
  return basename(common) === ".git" ? dirname(common) : common;
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

export function detectGate(root: string): string | undefined {
  const has = (name: string) => existsSync(join(root, name));
  if (has("package.json")) {
    try {
      const scripts = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"))?.scripts ?? {};
      if (typeof scripts.test === "string" && !/no test specified/.test(scripts.test)) {
        if (has("pnpm-lock.yaml")) return "pnpm test";
        if (has("yarn.lock")) return "yarn test";
        if (has("bun.lock") || has("bun.lockb")) return "bun run test";
        return "npm test";
      }
    } catch {}
  }
  if (has("mvnw")) return "./mvnw -q test";
  if (has("pom.xml")) return "mvn -q test";
  if (has("gradlew")) return "./gradlew test";
  if (has("Cargo.toml")) return "cargo test";
  if (has("go.mod")) return "go test ./...";
  if (has("pyproject.toml") || has("pytest.ini")) return "pytest -q";
  return undefined;
}

export function configFile(state: string): string {
  return join(state, "project.json");
}

export function loadConfig(state: string): ProjectConfig {
  const stored = readJson<Partial<ProjectConfig>>(configFile(state), {});
  const minutes = Number(stored.gateTimeoutMinutes);
  return {
    base: typeof stored.base === "string" && stored.base ? stored.base : undefined,
    gate: typeof stored.gate === "string" && stored.gate ? stored.gate : undefined,
    gateTimeoutMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 30,
    gateOn: stored.gateOn === "task" ? "task" : "lane",
    serialOnly: Array.isArray(stored.serialOnly) ? stored.serialOnly.map(String) : SERIAL_ONLY,
    docs: Array.isArray(stored.docs) ? stored.docs.map(String) : [],
  };
}

export function saveConfig(state: string, config: ProjectConfig): void {
  writeJson(configFile(state), config);
}
