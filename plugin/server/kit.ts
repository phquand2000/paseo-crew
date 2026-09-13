import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type Seat = { role: string; entry?: boolean; mayStart?: string[]; sweepMinutes?: number };
export type Profile = { provider: string; model?: string; modeId?: string; thinkingOptionId?: string };
type ProviderEntry = { env?: Record<string, string>; models?: { id: string }[] };
type PaseoConfig = {
  daemon?: { agentProfiles?: Profile[] };
  agents?: { providers?: Record<string, ProviderEntry> };
};

export type Kit = { seats: Seat[]; profiles: Profile[]; providers: Record<string, ProviderEntry> };

const home = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.HOME ?? "";

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return undefined;
  }
}

export function loadKit(): Kit | undefined {
  const config = readJson<PaseoConfig>(join(home, ".paseo", "config.json"));
  const providers = config?.agents?.providers ?? {};
  const kitPath = Object.values(providers)
    .map((provider) => provider.env?.SEATWORKS_KIT)
    .find((path): path is string => Boolean(path));
  if (!kitPath) return undefined;
  const seats = readJson<{ seats?: Seat[] }>(join(kitPath, "seats.json"))?.seats;
  if (!seats) return undefined;
  return { seats, profiles: config?.daemon?.agentProfiles ?? [], providers };
}

export function roleOf(provider: string): string {
  return provider.split("/")[0];
}

export function seatFor(kit: Kit, provider: string): Seat | undefined {
  const role = roleOf(provider);
  return kit.seats.find((seat) => seat.role === role);
}

export function projectRoot(cwd: string): string | undefined {
  let dir = cwd.replace(/^~(?=\/|$)/, home);
  for (;;) {
    if (existsSync(join(dir, ".seatworks"))) return dir;
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}
