import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MigrateStep, MigrateView } from "../../shared/views.ts";
import type { Kit } from "../catalog/kit/kit.ts";
import { digest } from "../core/fs.ts";
import { LayerSchema } from "../../shared/settings.ts";
import { stateRoot } from "../core/paths.ts";
import { readJson, writeJson } from "../core/store.ts";
import type { Project } from "../desk/project.ts";

export const BACKUP = /^settings\.json\.bak-\d{8}-\d{6}$/;

export type LiveSeat = { provider: string; slug: string; createdAt?: string; name: string };

export type MigrateContext = {
  kit: Kit;
  home: string;
  known: Project[];
  settings: { where: string; file: string }[];
  live: LiveSeat[];
  now: number;
};

type Stamp = { stamp: string; since: string };
type Step = MigrateStep & { apply?: () => void };

const stampFile = (homeDir: string) => join(stateRoot(homeDir), "kit.json");

/** Which kit this machine runs, and since when: a seat started earlier runs an older one. */
export function stampKit(kit: Kit, homeDir: string, now = Date.now()): Stamp {
  const stamp = digest(["content", "harness", "mcp", "roles.json"].map((name) => join(kit.dir, name)));
  const held = readJson<Partial<Stamp>>(stampFile(homeDir), {});
  if (held.stamp === stamp && typeof held.since === "string") return { stamp, since: held.since };
  const next = { stamp, since: new Date(now).toISOString() };
  writeJson(stampFile(homeDir), next);
  return next;
}

type Path = (string | number)[];

function at(root: unknown, path: Path): unknown {
  let node = root;
  for (const key of path)
    node = node && typeof node === "object" ? (node as Record<string | number, unknown>)[key] : undefined;
  return node;
}

/** Drops the value at `path`, or the nearest parent that holds it when the value is not there. */
function drop(root: unknown, path: Path): Path | undefined {
  for (let end = path.length; end > 0; end--) {
    const parent = at(root, path.slice(0, end - 1));
    const key = path[end - 1]!;
    if (!parent || typeof parent !== "object") continue;
    if (Array.isArray(parent) && typeof key === "number" && key < parent.length) {
      parent.splice(key, 1);
      return path.slice(0, end);
    }
    if (!Array.isArray(parent) && key in parent) {
      delete (parent as Record<string, unknown>)[String(key)];
      return path.slice(0, end);
    }
  }
  return undefined;
}

function repairLayer(raw: unknown): { values: unknown; dropped: string[] } | undefined {
  const values = structuredClone(raw);
  const dropped: string[] = [];
  for (let round = 0; round < 50; round++) {
    const parsed = LayerSchema.safeParse(values);
    if (parsed.success) return { values, dropped };
    // One issue a round: dropping an array element moves every index an issue after it names.
    const issue = parsed.error.issues[0]!;
    const path = issue.path.map((key) => (typeof key === "symbol" ? String(key) : key));
    const taken = issue.code === "unrecognized_keys" ? drop(values, [...path, issue.keys[0]!]) : drop(values, path);
    if (!taken) return undefined;
    dropped.push(taken.join(".") || "(whole file)");
  }
  return undefined;
}

const unreadable = (file: string) => {
  try {
    const held = JSON.parse(readFileSync(file, "utf-8"));
    return !held || typeof held !== "object" || Array.isArray(held);
  } catch {
    return true;
  }
};

function settingsSteps(ctx: MigrateContext): Step[] {
  return ctx.settings.flatMap<Step>(({ where, file }) => {
    if (!existsSync(file)) return [];
    if (unreadable(file))
      return [
        {
          kind: "settings",
          where,
          what: `${file} is not a settings object`,
          detail: ["Repair it by hand; Migrate does not guess at what it held."],
          auto: false,
        },
      ];
    const raw = readJson<unknown>(file, {});
    if (LayerSchema.safeParse(raw).success) return [];
    const repaired = repairLayer(raw);
    if (!repaired)
      return [
        {
          kind: "settings",
          where,
          what: `${file} does not fit this version`,
          detail: ["Repair it by hand."],
          auto: false,
        },
      ];
    const stamp = new Date(ctx.now).toISOString().replace(/\D/g, "").slice(0, 14);
    const backup = `${file}.bak-${stamp.slice(0, 8)}-${stamp.slice(8)}`;
    return [
      {
        kind: "settings",
        where,
        what: `Drop the settings this version does not read, keeping a copy as ${backup}`,
        detail: repaired.dropped,
        auto: true,
        apply: () => {
          copyFileSync(file, backup);
          writeJson(file, repaired.values);
        },
      },
    ];
  });
}

function seatSteps(ctx: MigrateContext, since: string): MigrateStep[] {
  const old = ctx.live.filter(
    (seat) => seat.provider.startsWith(ctx.kit.prefix) && seat.createdAt && seat.createdAt < since,
  );
  const bySlug = new Map<string, LiveSeat[]>();
  for (const seat of old) bySlug.set(seat.slug, [...(bySlug.get(seat.slug) ?? []), seat]);
  return [...bySlug].map(([slug, seats]) => ({
    kind: "seat" as const,
    where: slug,
    what: `${seats.length} seat${seats.length === 1 ? "" : "s"} started before this version`,
    detail: [
      ...seats.map((seat) => seat.name),
      "They keep the old prompts and tools until they are started again. Let each finish its work; the next seat started runs this version.",
    ],
    auto: false,
  }));
}

function plan(ctx: MigrateContext): { stamp: Stamp; steps: Step[] } {
  const stamp = stampKit(ctx.kit, ctx.home, ctx.now);
  return { stamp, steps: [...settingsSteps(ctx), ...seatSteps(ctx, stamp.since)] };
}

const view = (stamp: Stamp, steps: MigrateStep[], done: string[]): MigrateView => ({
  ...stamp,
  steps: steps.map(({ kind, where, what, detail, auto }) => ({ kind, where, what, detail, auto })),
  done,
  content: [],
});

export function migrationPlan(ctx: MigrateContext): MigrateView {
  const { stamp, steps } = plan(ctx);
  return view(stamp, steps, []);
}

export function migrate(ctx: MigrateContext): MigrateView {
  const done: string[] = [];
  for (const step of plan(ctx).steps) {
    if (!step.apply) continue;
    step.apply();
    done.push(`${step.where}: ${step.what}`);
  }
  const { stamp, steps } = plan(ctx);
  return view(stamp, steps, done);
}
