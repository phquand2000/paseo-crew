import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export type GateResult = { ok: boolean; code: number | null; timedOut: boolean; seconds: number; tail: string };

export function tailOf(text: string, lines = 40, chars = 3000): string {
  const kept = text.trimEnd().split(/\r?\n/).slice(-lines).join("\n");
  return kept.length > chars ? kept.slice(-chars) : kept;
}

export function runGate(command: string, cwd: string, logFile: string, timeoutMs: number): Promise<GateResult> {
  mkdirSync(dirname(logFile), { recursive: true });
  const started = Date.now();
  return new Promise((resolve) => {
    const log = createWriteStream(logFile);
    log.write(`$ ${command}\n`);
    const child = spawn("/bin/sh", ["-c", command], { cwd, env: { ...process.env, CI: "1" }, detached: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {}
    }, timeoutMs);
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    const finish = (code: number | null) => {
      clearTimeout(timer);
      log.end(() => {
        let text = "";
        try {
          text = readFileSync(logFile, "utf-8");
        } catch {}
        resolve({ ok: code === 0 && !timedOut, code, timedOut, seconds: Math.round((Date.now() - started) / 1000), tail: tailOf(text) });
      });
    };
    child.on("error", () => finish(127));
    child.on("close", (code) => finish(code));
  });
}
