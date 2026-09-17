import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readSync, statSync, writeSync } from "node:fs";
import { dirname } from "node:path";

export type GateResult = { ok: boolean; code: number | null; timedOut: boolean; seconds: number; tail: string };

export function tailOf(text: string, lines = 40, chars = 3000): string {
  const kept = text.trimEnd().split(/\r?\n/).slice(-lines).join("\n");
  return kept.length > chars ? kept.slice(-chars) : kept;
}

/**
 * The end of a log, read from the end of it.
 *
 * A gate may write for as long as it runs, and reading the whole file back to keep three thousand
 * characters allocates all of it — past half a gigabyte the read throws outright and the failure
 * arrives with nothing to explain it. A partial first line is dropped rather than shown mangled.
 */
function lastBytes(file: string, limit = 64 * 1024): string {
  try {
    const size = statSync(file).size;
    const from = Math.max(0, size - limit);
    const buffer = Buffer.alloc(Math.min(size, limit));
    const fd = openSync(file, "r");
    try {
      readSync(fd, buffer, 0, buffer.length, from);
    } finally {
      closeSync(fd);
    }
    const text = buffer.toString("utf-8");
    return from === 0 ? text : text.slice(text.indexOf("\n") + 1);
  } catch {
    return "";
  }
}

export function runGate(command: string, cwd: string, logFile: string, timeoutMs: number): Promise<GateResult> {
  mkdirSync(dirname(logFile), { recursive: true });
  const started = Date.now();
  const fd = openSync(logFile, "w");
  writeSync(fd, `$ ${command}\n`);
  return new Promise((resolve) => {
    // The gate writes to the log file itself. Piping it through this process put a copy of that pipe
    // in every process the gate leaves running, and "close" — which is what the verdict used to wait
    // for — comes after the pipes end, not after the command does: a suite that passed in seconds and
    // left a watcher behind was reported as a timeout half an hour later, and one whose leftover
    // process escaped the group kill was never answered at all. A write that fails is also the
    // child's problem now, rather than an unhandled stream error in the process holding the desk.
    const child = spawn("/bin/sh", ["-c", command], { cwd, env: { ...process.env, CI: "1" }, detached: true, stdio: ["ignore", fd, fd] });
    let timedOut = false;
    let answered = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {}
    }, timeoutMs);
    const finish = (code: number | null) => {
      if (answered) return;
      answered = true;
      clearTimeout(timer);
      try {
        closeSync(fd);
      } catch {}
      resolve({ ok: code === 0 && !timedOut, code, timedOut, seconds: Math.round((Date.now() - started) / 1000), tail: tailOf(lastBytes(logFile)) });
    };
    child.on("error", () => finish(127));
    // exit, not close: the command's own answer, whatever it left running behind it.
    child.on("exit", (code, signal) => finish(code ?? (signal ? null : 0)));
  });
}
