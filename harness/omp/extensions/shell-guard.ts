import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

type Seat = { role: string; guards?: string[] };

const env =
  (globalThis as { process?: { env: Record<string, string | undefined>; cwd(): string } }).process;
const vars = env?.env ?? {};

const TOOL_NAMES: Record<string, string> = {
  bash: "Bash",
  write: "Write",
  edit: "Edit",
  notebook: "NotebookEdit",
  ast_edit: "Write",
};

const EDIT_SECTION = /^\[([^\]\n#]+)#[0-9A-Fa-f]{4}\]/gm;

export function shellGuardsFor(seatsPath: string, role: string): string[] {
  try {
    const parsed = JSON.parse(readFileSync(seatsPath, "utf-8")) as { seats?: Seat[] };
    const seat = (parsed.seats ?? []).find((entry) => entry.role === role);
    return (seat?.guards ?? []).filter((name) => name.endsWith(".sh"));
  } catch {
    return [];
  }
}

export function editPaths(input: string): string[] {
  const paths: string[] = [];
  for (const match of input.matchAll(EDIT_SECTION)) {
    if (!paths.includes(match[1])) paths.push(match[1]);
  }
  return paths;
}

export function hookInputs(toolName: string, input: Record<string, unknown>, cwd: string): string[] {
  const name = TOOL_NAMES[toolName] ?? toolName;
  const frame = (toolInput: Record<string, unknown>) =>
    JSON.stringify({ tool_name: name, tool_input: toolInput, cwd });
  switch (toolName) {
    case "bash":
      return [frame({ command: String(input.command ?? "") })];
    case "write":
    case "ast_edit":
      return [frame({ file_path: String(input.path ?? "") })];
    case "notebook":
      return [frame({ notebook_path: String(input.path ?? "") })];
    case "edit": {
      const paths = editPaths(String(input.input ?? ""));
      return paths.length > 0 ? paths.map((path) => frame({ file_path: path })) : [frame({})];
    }
    default:
      return [frame(input)];
  }
}

export default function (pi: ExtensionAPI) {
  const role = vars.SEATWORKS_ROLE ?? "";
  const kit = vars.SEATWORKS_KIT ?? "";
  const seatsPath = vars.SEATWORKS_SEATS ?? (kit ? `${kit}/seats.json` : "");
  const guards = role && seatsPath ? shellGuardsFor(seatsPath, role) : [];
  if (guards.length === 0 || !kit) return;

  pi.on("tool_call", async (event) => {
    const input = (event.input ?? {}) as Record<string, unknown>;
    const cwd = String(input.cwd ?? env?.cwd() ?? "");
    const frames = hookInputs(event.toolName, input, cwd);
    for (const guard of guards) {
      const path = `${kit}/harness/common/guards/${guard}`;
      for (const frame of frames) {
        const run = spawnSync("bash", [path], { input: frame, encoding: "utf-8" });
        if (run.error) {
          return {
            block: true,
            reason: `${guard} could not run (${run.error.message}), so this call was not checked.`,
          };
        }
        if (run.status === 0) continue;
        const said = (run.stderr ?? "").trim();
        return {
          block: true,
          reason: said || `${guard} refused this call (exit ${run.status}).`,
        };
      }
    }
  });
}
