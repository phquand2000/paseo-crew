import { accessSync, constants, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, join, resolve } from "node:path";
import { getPath, isRecord } from "./json.ts";

export const PLUGIN_ID = "seatworks-v2";

export function home(): string {
  return process.env.HOME || homedir();
}

export function expandHome(value: string, homeDir = home()): string {
  if (value === "HOME" || value === "~") return homeDir;
  if (value.startsWith("HOME/")) return join(homeDir, value.slice(5));
  if (value.startsWith("~/")) return join(homeDir, value.slice(2));
  return value;
}

/** The home of the Paseo the plugin runs in, resolved as Paseo resolves it. */
export function paseoHome(): string {
  const raw = process.env.PASEO_HOME;
  return raw ? resolve(expandHome(raw)) : join(home(), ".paseo");
}

export function paseoConfigPath(): string {
  return join(paseoHome(), "config.json");
}

export const RECORDS = ["events", "attention", "assessments"] as const;

export const DESK_OWNED = new Set([
  "ledger.json",
  "incidents.json",
  "project.json",
  "meta.json",
  "settings.json",
  "status.md",
  ...RECORDS.map((name) => `${name}.log`),
  "handbacks",
  "gates",
  "archive",
]);

export function stateRoot(homeDir = home()): string {
  return join(homeDir, ".local", "share", "seatworks-v3");
}

export function guidesDir(homeDir = home()): string {
  return join(stateRoot(homeDir), "guides");
}

/** Copies of what seats read, one folder per version. Safe to delete whole: the next seat to start rebuilds what it needs. */
export function contentRoot(homeDir = home()): string {
  return join(stateRoot(homeDir), "content");
}

export function worktreeRoot(homeDir = home()): string {
  return join(stateRoot(homeDir), "worktrees");
}

/** Where seats' team servers reach the desk: beside the state it keeps, and open to this user alone. */
export function deskSocket(homeDir = home()): string {
  return join(stateRoot(homeDir), "desk.sock");
}

export function nodeBin(): string {
  if (basename(process.execPath) === "node") return process.execPath;
  return executableIn([...pathDirs(), "/opt/homebrew/bin", "/usr/local/bin"], "node") ?? "node";
}

/** The directories on this process's PATH, in order; an empty one is the working directory, as the shell reads it. */
export function pathDirs(): string[] {
  return (process.env.PATH ?? "").split(delimiter);
}

/** The first of `dirs` holding a `name` this process may run. */
export function executableIn(dirs: string[], name: string): string | undefined {
  for (const dir of dirs) {
    const file = join(dir, name);
    try {
      accessSync(file, constants.X_OK);
      return file;
    } catch {
      // Not there, or not ours to run: the next directory may have it.
    }
  }
  return undefined;
}

export function outboxPath(homeDir = home()): string {
  return join(stateRoot(homeDir), "outbox.json");
}

export function intentsPath(homeDir = home()): string {
  return join(stateRoot(homeDir), "intents.json");
}

export function pluginDir(configPath = paseoConfigPath()): string | undefined {
  if (process.env.SEATWORKS_PLUGIN_DIR) return process.env.SEATWORKS_PLUGIN_DIR;
  try {
    const entry = getPath(JSON.parse(readFileSync(configPath, "utf-8")) as unknown, ["plugins", PLUGIN_ID]);
    return isRecord(entry) && entry.source === "directory" && typeof entry.path === "string" ? entry.path : undefined;
  } catch {
    return undefined;
  }
}
