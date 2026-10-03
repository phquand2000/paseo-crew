import { spawn } from "node:child_process";
import {
  chmodSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { daemonLog } from "./logger.ts";

type GateResult = {
  ok: boolean;
  code: number | null;
  timedOut: boolean;
  stopped: boolean;
  seconds: number;
  tail: string;
};

const TAIL_LINES = 40;
const TAIL_CHARS = 3000;

function tailOf(text: string): string {
  const kept = text.trimEnd().split(/\r?\n/).slice(-TAIL_LINES).join("\n");
  return kept.length > TAIL_CHARS ? kept.slice(-TAIL_CHARS) : kept;
}

/** Kills the gate's whole process group: a leftover watcher, dev server or `&` job would keep writing into the lane's copy and the log. */
function killGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // Nothing of the group was left to kill.
  }
}

/** Reads only the tail: a gate log can grow past what a whole-file read survives. Drops a partial first line. */
export function lastBytes(file: string, limit = 64 * 1024): string {
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

function openUp(dir: string): void {
  chmodSync(dir, 0o700);
  for (const entry of readdirSync(dir, { withFileTypes: true })) if (entry.isDirectory()) openUp(join(dir, entry.name));
}

/** Test suites lock directories to test what cannot be read, and leave them locked: those are opened before removal. */
function dropTemp(dir: string): void {
  try {
    openUp(dir);
    rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    daemonLog.error(`could not remove the gate's temp directory ${dir}:`, error);
  }
}

function closeLog(fd: number): void {
  try {
    closeSync(fd);
  } catch {
    // Closed already: the log holds what was written.
  }
}

function start(command: string, cwd: string, logFile: string, scratch: string) {
  mkdirSync(dirname(logFile), { recursive: true });
  const fd = openSync(logFile, "w");
  writeSync(fd, `$ ${command}\n`);
  // Straight to the log fd: a pipe would be inherited by leftover processes and hold "close" open indefinitely.
  const child = spawn("/bin/sh", ["-c", command], {
    cwd,
    env: { ...process.env, CI: "1", TMPDIR: scratch },
    detached: true,
    stdio: ["ignore", fd, fd],
  });
  return { child, fd };
}

/**
 * `stop` kills the gate's group when the plugin stops: a gate left running would write into a copy nobody watches.
 * Each run gets a TMPDIR of its own under `temp`, removed when it ends, so what its scripts leave there never piles up.
 */
export function runGate(
  command: string,
  cwd: string,
  logFile: string,
  timeoutMs: number,
  temp: string,
  stop?: AbortSignal,
): Promise<GateResult> {
  const scratch = mkdtempSync(join(temp, "gate-"));
  const started = Date.now();
  const { child, fd } = start(command, cwd, logFile, scratch);
  return new Promise((resolve) => {
    let ended: "timedOut" | "stopped" | undefined;
    let answered = false;
    const end = (why: "timedOut" | "stopped") => {
      ended ??= why;
      killGroup(child.pid);
    };
    const timer = setTimeout(() => end("timedOut"), timeoutMs);
    const stopped = () => end("stopped");
    if (stop?.aborted) stopped();
    else stop?.addEventListener("abort", stopped, { once: true });
    const finish = (code: number | null) => {
      if (answered) return;
      answered = true;
      clearTimeout(timer);
      stop?.removeEventListener("abort", stopped);
      killGroup(child.pid);
      dropTemp(scratch);
      closeLog(fd);
      resolve({
        ok: code === 0 && !ended,
        code,
        timedOut: ended === "timedOut",
        stopped: ended === "stopped",
        seconds: Math.round((Date.now() - started) / 1000),
        tail: tailOf(lastBytes(logFile)),
      });
    };
    child.on("error", () => finish(127));
    // exit, not close: the command's own answer, whatever it left running behind it.
    child.on("exit", (code, signal) => finish(code ?? (signal ? null : 0)));
  });
}
