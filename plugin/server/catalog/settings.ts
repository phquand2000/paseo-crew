import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { readJson, sortKeys, writeJson } from "../core/store.ts";
import { errorText } from "../core/errors.ts";
import { KEPT, type Layer, LayerSchema } from "../../shared/settings.ts";
import type { LayerRead, WriteResult } from "../../shared/views.ts";

export function revisionOf(values: unknown): string {
  return createHash("sha1").update(JSON.stringify(sortKeys(values ?? {}))).digest("hex").slice(0, 16);
}

/** Only the position: V8 quotes the file's own text, which can hold pasted tokens. */
function placeOf(error: unknown): string {
  const said = errorText(error);
  const where = /at position \d+(?: \(line \d+ column \d+\))?/.exec(said);
  return where ? `, ${where[0]}` : "";
}

/** `readJson` reads a broken file as `{}`, a valid empty layer, so the next save would overwrite all the owner wrote. */
function faultOf(file: string): string | undefined {
  if (!existsSync(file)) return undefined;
  let held: unknown;
  try {
    held = JSON.parse(readFileSync(file, "utf-8"));
  } catch (error) {
    return `${file} is there but is not JSON${placeOf(error)}`;
  }
  return !held || typeof held !== "object" || Array.isArray(held) ? `${file} does not hold a settings object` : undefined;
}

export function readLayer(file: string): LayerRead {
  const fault = faultOf(file);
  if (fault) return { status: "invalid", revision: revisionOf(readJson<unknown>(file, {})), error: `${fault}\nRepair the file by hand, then read it again.` };
  const raw = readJson<unknown>(file, {});
  const revision = revisionOf(raw);
  const parsed = LayerSchema.safeParse(raw);
  return parsed.success ? { status: "ready", revision, values: parsed.data } : { status: "invalid", revision, error: z.prettifyError(parsed.error) };
}

/** A sensor's key buys paid calls, so the screen never reads it back: it sees KEPT in its place. */
export function withoutKeys(layer: Layer): Layer {
  if (!layer.sensor) return layer;
  return { ...layer, sensor: Object.fromEntries(Object.entries(layer.sensor).map(([id, kept]) => [id, kept.key ? { ...kept, key: KEPT } : kept])) };
}

/** A save carrying KEPT keeps the key on disk; KEPT for a key no longer there saves no key. */
export function withKeys(values: unknown, stored: Layer): unknown {
  const asked = values as { sensor?: Record<string, { key?: unknown } | undefined> } | null;
  if (!asked || typeof asked !== "object" || !asked.sensor || typeof asked.sensor !== "object") return values;
  const sensor = Object.entries(asked.sensor).map(([id, entry]): [string, unknown] => {
    if (entry?.key !== KEPT) return [id, entry];
    const { key: _shown, ...rest } = entry;
    const key = stored.sensor?.[id]?.key;
    return [id, key ? { ...rest, key } : rest];
  });
  return { ...asked, sensor: Object.fromEntries(sensor) };
}

export function readShown(file: string): LayerRead {
  const read = readLayer(file);
  return read.status === "ready" ? { ...read, values: withoutKeys(read.values) } : read;
}

export function layerValues(file: string): Layer {
  const read = readLayer(file);
  return read.status === "ready" ? read.values : {};
}

export function writeLayer(file: string, revision: string, values: unknown, check: (values: Layer) => string[]): WriteResult {
  const fault = faultOf(file);
  if (fault) {
    return { status: "invalid", error: `${fault}, and saving over it would throw away what it holds.\nRepair the file by hand, then save again.` };
  }
  const current = readJson<unknown>(file, {});
  if (revisionOf(current) !== revision) {
    return { status: "conflict", error: "The settings changed after they were read; read them again and reapply the change." };
  }
  const held = LayerSchema.safeParse(current);
  if (!held.success) {
    return {
      status: "invalid",
      error: `${file} could not be read, and saving over it would throw away what it holds:\n${z.prettifyError(held.error)}\nRepair the file by hand, then save again.`,
    };
  }
  const parsed = LayerSchema.safeParse(values);
  if (!parsed.success) return { status: "invalid", error: z.prettifyError(parsed.error) };
  const problems = check(parsed.data);
  if (problems.length > 0) return { status: "invalid", error: problems.join("\n") };
  mkdirSync(dirname(file), { recursive: true });
  writeJson(file, parsed.data);
  return { status: "saved", revision: revisionOf(parsed.data), values: parsed.data };
}
