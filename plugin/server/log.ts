import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type Log = (root: string, line: string) => void;

const pad = (value: number) => String(value).padStart(2, "0");

export function clock(date = new Date()): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function day(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function writeLog(root: string, line: string): void {
  const now = new Date();
  const dir = join(root, ".seatworks", "records", "attention");
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `${day(now)}.md`), `${clock(now)}  ${line}\n`);
  } catch (error) {
    console.error("seatworks attention log write failed:", error);
  }
}
