import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Gate = { seat: string; skill: string; on: string; because: string };

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

const WRITE_TOOLS = new Set(["write", "edit"]);
const MERGE = /(^|[;&|(]|&&)\s*([A-Za-z_]\w*=\S*\s+)*(sudo\s+|env\s+|command\s+)*(\S*\/)?git(\s+(-[Cc]\s+\S+|--(git-dir|work-tree|exec-path|namespace)\s+\S+|--?\S+))*\s+(merge|cherry-pick)(\s|$)/;

export function gatesFor(seatsPath: string, role: string): Gate[] {
  try {
    const parsed = JSON.parse(readFileSync(seatsPath, "utf-8")) as { skillGates?: Gate[] };
    return (parsed.skillGates ?? []).filter((gate) => gate.seat === role);
  } catch {
    return [];
  }
}

export function skillFromPath(path: string): string | undefined {
  return /(?:^|\/)([a-z0-9][a-z0-9-]*)\/SKILL\.md$/.exec(path)?.[1];
}

export function gateFor(gates: Gate[], toolName: string, command: string): Gate | undefined {
  const on = WRITE_TOOLS.has(toolName) ? "write" : toolName === "bash" && MERGE.test(command) ? "merge" : undefined;
  return on ? gates.find((gate) => gate.on === on) : undefined;
}

export default function (pi: ExtensionAPI) {
  const role = env.SEATWORKS_ROLE ?? "";
  const seatsPath = env.SEATWORKS_SEATS ?? (env.SEATWORKS_KIT ? `${env.SEATWORKS_KIT}/seats.json` : "");
  const gates = role && seatsPath ? gatesFor(seatsPath, role) : [];
  if (gates.length === 0) return;

  const loaded = new Set<string>();

  pi.on("tool_call", async (event) => {
    const input = event.input as { path?: unknown; file_path?: unknown; command?: unknown };
    const path = String(input.path ?? input.file_path ?? "");
    if (path) {
      const name = skillFromPath(path);
      if (name) loaded.add(name);
    }
    const command = String(input.command ?? "");
    if (command) {
      for (const match of command.matchAll(/(?:^|[\s"'=])([a-z0-9][a-z0-9-]*)\/SKILL\.md/g)) {
        loaded.add(match[1]);
      }
    }
    const gate = gateFor(gates, event.toolName, command);
    if (!gate || loaded.has(gate.skill)) return;
    return {
      block: true,
      reason: `Read the ${gate.skill} skill's SKILL.md before this step, because ${gate.because}. Its description is in your available skills; open the file, then make this call again.`,
    };
  });
}
