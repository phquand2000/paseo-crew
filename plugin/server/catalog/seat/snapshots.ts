import { cpSync, existsSync, readdirSync, renameSync, rmSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { digest, ensureLink } from "../../core/fs.ts";
import { contentRoot, guidesDir, home } from "../../core/paths.ts";
import { DAY_MS } from "../../core/time.ts";
import type { Kit } from "../kit/kit.ts";

const SNAPSHOT_DAYS = 14;

/** Copied under the state root, never linked, so it resolves outside every repo: an agent may load the AGENTS.md above a file's real path. */
export function snapshot(source: string, name: string, homeDir = home()): string {
  const target = join(contentRoot(homeDir), `${name}-${digest([source])}`);
  if (!existsSync(target)) {
    const building = `${target}.${process.pid}.building`;
    rmSync(building, { recursive: true, force: true });
    cpSync(source, building, { recursive: true, dereference: true });
    try {
      renameSync(building, target);
    } catch (error) {
      rmSync(building, { recursive: true, force: true });
      if (!existsSync(target)) throw error;
    }
  }
  const now = new Date();
  utimesSync(target, now, now);
  return target;
}

/** Every seat that starts touches the copies it links, so one untouched for two weeks has no reader left. */
export function sweepSnapshots(homeDir = home(), now = Date.now()): void {
  const root = contentRoot(homeDir);
  if (!existsSync(root)) return;
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (now - statSync(path).mtimeMs > SNAPSHOT_DAYS * DAY_MS) rmSync(path, { recursive: true, force: true });
  }
}

export function placeGuides(kit: Kit, homeDir = home()): void {
  ensureLink(guidesDir(homeDir), snapshot(join(kit.dir, "content", "guides"), "guides", homeDir));
}
