import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Ide = {
  open(path: string): Promise<{ ok: boolean; text: string }>;
  sync(path: string): Promise<{ ok: boolean; text: string }>;
};

async function call(url: string, name: string, args: Record<string, unknown>, timeoutMs: number): Promise<{ ok: boolean; text: string }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.text();
    const parsed = JSON.parse(body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1));
    const result = parsed.result as { isError?: boolean; content?: { text?: string }[] } | undefined;
    const text = (result?.content ?? []).map((part) => part.text ?? "").join("\n") || parsed.error?.message || "";
    return { ok: !parsed.error && !result?.isError, text };
  } catch (error) {
    return { ok: false, text: error instanceof Error ? error.message : String(error) };
  }
}

export function excludeIdeFiles(repo: string): void {
  try {
    const common = execFileSync("git", ["-C", repo, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const file = join(common, "info", "exclude");
    const current = existsSync(file) ? readFileSync(file, "utf-8") : "";
    if (current.split(/\r?\n/).includes(".idea/")) return;
    mkdirSync(join(common, "info"), { recursive: true });
    appendFileSync(file, `${current && !current.endsWith("\n") ? "\n" : ""}.idea/\n`);
  } catch {}
}

function routeHint(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as { error?: string; available_projects?: { path?: string }[] };
    return parsed.error === "multiple_projects_open" ? parsed.available_projects?.find((project) => project.path)?.path : undefined;
  } catch {
    return undefined;
  }
}

export function ideClient(url: string): Ide {
  return {
    async open(path) {
      const args = { path, timeoutSeconds: 900 };
      const first = await call(url, "ide_open_project", args, 930_000);
      const route = routeHint(first.text);
      return route ? call(url, "ide_open_project", { ...args, project_path: route }, 930_000) : first;
    },
    sync: (path) => call(url, "ide_sync_files", { project_path: path }, 60_000),
  };
}
