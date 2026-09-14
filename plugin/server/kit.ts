import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export type Seat = { role: string; harness: string; entry?: boolean; mayStart?: string[]; sweepMinutes?: number };
export type Profile = { provider: string; model?: string; modeId?: string; thinkingOptionId?: string };
export type Harness = { profileRoot?: string; configDirEnv?: string };
export type ProviderEntry = { env?: Record<string, string>; models?: { id: string }[] };
export type Kit = {
  seats: Seat[];
  profiles: Profile[];
  providers: Record<string, ProviderEntry>;
  harnesses: Record<string, Harness>;
};
export type Project = { root: string; slug: string; models: Record<string, string> };

type PaseoConfig = {
  daemon?: { agentProfiles?: Profile[] };
  agents?: { providers?: Record<string, ProviderEntry> };
};

export const home = process.env.HOME ?? "";

export function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return undefined;
  }
}

function stamp(path: string): string {
  try {
    return String(statSync(path).mtimeMs);
  } catch {
    return "missing";
  }
}

export function readKit(configPath: string): { kit?: Kit; files: string[] } {
  const files = [configPath];
  const config = readJson<PaseoConfig>(configPath);
  const providers = config?.agents?.providers ?? {};
  const kitPath = Object.values(providers)
    .map((provider) => provider.env?.SEATWORKS_KIT)
    .find((path): path is string => Boolean(path));
  if (!kitPath) return { files };
  const seatsPath = join(kitPath, "seats.json");
  files.push(seatsPath);
  const seats = readJson<{ seats?: Seat[] }>(seatsPath)?.seats;
  if (!seats) return { files };
  const harnesses: Record<string, Harness> = {};
  for (const id of new Set(seats.map((seat) => seat.harness))) {
    const path = join(kitPath, "harness", id, "harness.json");
    files.push(path);
    harnesses[id] = readJson<Harness>(path) ?? {};
  }
  return { kit: { seats, profiles: config?.daemon?.agentProfiles ?? [], providers, harnesses }, files };
}

export function kitLoader(configPath = join(home, ".paseo", "config.json")): () => Kit | undefined {
  let files: string[] = [];
  let stamps = "";
  let kit: Kit | undefined;
  return () => {
    if (files.length === 0 || files.map(stamp).join("|") !== stamps) {
      const read = readKit(configPath);
      files = read.files;
      kit = read.kit;
      stamps = files.map(stamp).join("|");
    }
    return kit;
  };
}

export function roleOf(provider: string): string {
  return provider.split("/")[0] ?? provider;
}

export function seatFor(kit: Kit, provider: string): Seat | undefined {
  const role = roleOf(provider);
  return kit.seats.find((seat) => seat.role === role);
}

export function entrySeat(kit: Kit): Seat | undefined {
  return kit.seats.find((seat) => seat.entry);
}

export function watcherSeat(kit: Kit): Seat | undefined {
  return kit.seats.find((seat) => seat.sweepMinutes);
}

export function sweepMs(kit: Kit): number {
  return (watcherSeat(kit)?.sweepMinutes ?? 10) * 60_000;
}

export function expandHome(path: string): string {
  return path.replace(/^(?:HOME|~)(?=\/|$)/, home);
}

export function projectRoot(cwd: string): string | undefined {
  let dir = expandHome(cwd);
  for (;;) {
    if (existsSync(join(dir, ".seatworks"))) return dir;
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

export function projectAt(root: string): Project {
  const project = readJson<{ slug?: string; models?: Record<string, string> }>(join(root, ".seatworks", "project.json"));
  return { root, slug: project?.slug || basename(root), models: project?.models ?? {} };
}
