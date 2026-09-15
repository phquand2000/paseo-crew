import { callTool } from "../core/jsonrpc.ts";
import type { IdeClient } from "../desk/context.ts";

export type Ide = IdeClient;

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
      const first = await callTool(url, "ide_open_project", args, 930_000);
      const route = routeHint(first.text);
      return route ? callTool(url, "ide_open_project", { ...args, project_path: route }, 930_000) : first;
    },
    sync: (path) => callTool(url, "ide_sync_files", { project_path: path }, 60_000),
  };
}
