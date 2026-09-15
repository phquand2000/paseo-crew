import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Ide = {
  open(path: string): Promise<{ ok: boolean; text: string }>;
  sync(path: string): Promise<void>;
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

export function ideClient(url: string): Ide {
  return {
    open: (path) => call(url, "ide_open_project", { path, timeoutSeconds: 900 }, 930_000),
    async sync(path) {
      await call(url, "ide_sync_files", { project_path: path }, 60_000);
    },
  };
}
