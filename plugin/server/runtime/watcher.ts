import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Ending = { n: number; agent: string; role: string; title: string; text: string };
export type Label = "unheard-wait" | "wrong-premise" | "destructive" | "drift" | "struggle" | "normal";
export type Verdict = { n: number; label: Label; quote: string };

export const URGENT: Label[] = ["unheard-wait", "wrong-premise", "destructive", "drift"];
const LABELS: Label[] = ["unheard-wait", "wrong-premise", "destructive", "drift", "struggle", "normal"];

export function watcherPrompt(instructions: string, endings: Ending[]): string {
  const body = endings.map((ending) => `${ending.n}. [${ending.role}] ${ending.text.replace(/\s+/g, " ").trim()}`).join("\n\n");
  return `${instructions.trim()}\n\n${body}\n`;
}

export function parseVerdicts(output: string, count: number): Verdict[] {
  const verdicts = new Map<number, Verdict>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(\d+)[.)]?\s+([a-z-]+)\s*(?:\|\s*(.*))?$/i.exec(line.replace(/[*`]/g, ""));
    if (!match) continue;
    const n = Number(match[1]);
    const label = match[2]!.toLowerCase() as Label;
    if (n < 1 || n > count || !LABELS.includes(label) || verdicts.has(n)) continue;
    verdicts.set(n, { n, label, quote: (match[3] ?? "").trim().replace(/^"|"$/g, "") });
  }
  return [...verdicts.values()].sort((a, b) => a.n - b.n);
}

export function fillCommand(template: string[], values: Record<string, string>): string[] {
  return template.map((part) => part.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole));
}

export function runWatcher(command: string[], prompt: string, model: string, timeoutMs: number, env: Record<string, string> = {}): Promise<{ ok: boolean; output: string }> {
  const dir = mkdtempSync(join(tmpdir(), "sw2-watch-"));
  const promptFile = join(dir, "prompt.txt");
  const work = join(dir, "work");
  mkdirSync(work);
  writeFileSync(promptFile, prompt);
  const argv = fillCommand(command, { promptFile, model, prompt });
  const [bin, ...args] = argv;
  return new Promise((resolve) => {
    if (!bin) {
      resolve({ ok: false, output: "no watcher command" });
      return;
    }
    execFile(bin, args, { cwd: work, env: { ...process.env, ...env }, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      rmSync(dir, { recursive: true, force: true });
      resolve({ ok: !error, output: error ? `${String(stdout)}\n${String(stderr) || error.message}` : String(stdout) });
    });
  });
}
