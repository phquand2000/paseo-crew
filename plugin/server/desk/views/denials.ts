import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, sep } from "node:path";
import { DAY_MS } from "../../core/time.ts";
import type { ProjectConfig } from "../project/project.ts";
import { recordLines } from "../store/records.ts";

type Denial = { at?: string; kind?: string; fact?: string; quote?: string };

const under = (path: string, dir: string): boolean =>
  path === dir || path.startsWith(dir.endsWith(sep) ? dir : dir + sep);

function deniedSince(lines: string[], since: number): string[] {
  return lines.flatMap((line) => {
    try {
      const event = JSON.parse(line) as Denial;
      const fresh =
        event.kind === "watch.fact" && event.fact === "sandbox-denied" && Date.parse(event.at ?? "") >= since;
      return fresh && event.quote ? [event.quote] : [];
    } catch {
      // A line cut short by a crash mid-write is not an event.
      return [];
    }
  });
}

/** Each refusal under the lowest directory that holds the most of them, short of home and the top of the disk. */
function grouped(paths: string[], home: string): Map<string, number> {
  const count = (dir: string) => paths.filter((path) => under(path, dir)).length;
  const groups = new Map<string, number>();
  for (const path of new Set(paths)) {
    let best = path;
    let most = count(path);
    for (let up = dirname(path); dirname(up) !== dirname(dirname(up)) && !under(home, up); up = dirname(up)) {
      const here = count(up);
      if (here > most) [best, most] = [up, here];
    }
    groups.set(best, most);
  }
  return groups;
}

/** The writes a sandbox refused this project's seats in the last day, where they repeat: the Human's grant to make, if the work needs it. */
export async function deniedLines(
  state: string,
  config: ProjectConfig,
  repeatsAt: number,
  now: number,
): Promise<string[]> {
  const granted = config.writableOutside.flatMap((path) => (existsSync(path) ? [path, realpathSync(path)] : [path]));
  const paths = deniedSince(await recordLines(state, "events", now - DAY_MS), now - DAY_MS).filter(
    (path) => !granted.some((dir) => under(path, dir)),
  );
  const home = existsSync(homedir()) ? realpathSync(homedir()) : homedir();
  const shown = [...grouped(paths, home)].filter(([, times]) => times >= repeatsAt);
  if (!shown.length) return [];
  return [
    "",
    "Writes the sandbox refused in the last day. Only the Human can grant one, in writableOutside of this project's project.json, and a seat started after it may write there; ask only if the work needs it:",
    ...shown.map(([path, times]) => `- ${path}: refused ${times} times`),
  ];
}
