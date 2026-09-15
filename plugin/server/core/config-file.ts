import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { parse, stringify } from "smol-toml";

const isToml = (path: string): boolean => extname(path).toLowerCase() === ".toml";

export function readConfig<T>(path: string, fallback: T): T {
  try {
    const text = readFileSync(path, "utf-8");
    return (isToml(path) ? parse(text) : JSON.parse(text)) as T;
  } catch {
    return fallback;
  }
}

export function formatConfig(path: string, value: unknown): string {
  return isToml(path) ? `${stringify(value as Record<string, unknown>).trimEnd()}\n` : `${JSON.stringify(value, null, 2)}\n`;
}
