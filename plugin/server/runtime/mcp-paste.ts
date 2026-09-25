import type { Connect } from "../../shared/settings.ts";
import type { Parsed } from "../../shared/views.ts";
import { errorText } from "../core/errors.ts";

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Pasted snippets write ports and flags as numbers; a value with no text form is named back, not dropped. */
const scalar = (value: unknown): string | undefined =>
  typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : undefined;

/** The words, or — as a string — the one that is not a word. */
const words = (value: unknown): string[] | string | undefined => {
  if (value === undefined || value === null) return undefined;
  const out: string[] = [];
  for (const item of Array.isArray(value) ? value : [value]) {
    const text = scalar(item);
    if (text === undefined) return JSON.stringify(item);
    out.push(text);
  }
  return out;
};

/** The names and their values, or — as a string — the name whose value has no text form. */
const table = (value: unknown): Record<string, string> | string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) return JSON.stringify(value);
  const out: Record<string, string> = {};
  for (const [name, item] of Object.entries(value)) {
    const text = scalar(item);
    if (text === undefined) return name;
    out[name] = text;
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

function connectFrom(value: unknown): Connect | string {
  if (!isRecord(value)) return "A server needs a JSON object with its connection details.";
  const raw = typeof value.type === "string" ? value.type.toLowerCase() : "";
  const run = words(value.command);
  if (typeof run === "string") return `The server's command has ${run} in it, which is not text.`;
  const rest = words(value.args);
  if (typeof rest === "string") return `The server's args have ${rest} in them, which is not text.`;
  const command = [...(run ?? []), ...(rest ?? [])];
  const url = typeof value.url === "string" ? value.url : undefined;
  const type = raw === "local" || raw === "stdio" ? "stdio" : raw === "sse" ? "sse" : raw === "remote" || raw === "http" ? "http" : command.length > 0 ? "stdio" : url ? "http" : undefined;
  if (!type) return "Give the server a command to run or a url to reach.";
  if (type === "stdio") {
    if (command.length === 0) return "A local server needs a command to run.";
    const env = table(value.env);
    if (typeof env === "string") return `The server's env gives ${env} a value that is not text.`;
    return { type, command, ...(env ? { env } : {}) };
  }
  if (!url) return "A remote server needs a url.";
  const headers = table(value.headers);
  if (typeof headers === "string") return `The server's headers give ${headers} a value that is not text.`;
  return { type, url, ...(headers ? { headers } : {}) };
}

/** A server pasted as the Human's agents write one: a bare entry, or one under `mcp` or `mcpServers`; one at a time. */
export function parseMcp(text: string): Parsed {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { error: `That is not JSON: ${errorText(error)}` };
  }
  if (!isRecord(parsed)) return { error: "Paste a JSON object, not a list or a bare value." };
  const map = isRecord(parsed.mcp) ? parsed.mcp : isRecord(parsed.mcpServers) ? parsed.mcpServers : undefined;
  if (map) {
    const names = Object.keys(map);
    if (names.length !== 1) return { error: `Paste one server at a time; this one names ${names.length}.` };
    const id = names[0]!;
    const connect = connectFrom(map[id]);
    return typeof connect === "string" ? { error: connect } : { id, label: id, connect };
  }
  const direct = connectFrom(parsed);
  if (typeof direct === "string") {
    const names = Object.keys(parsed);
    if (names.length === 1 && isRecord(parsed[names[0]!])) {
      const id = names[0]!;
      const nested = connectFrom(parsed[id]);
      return typeof nested === "string" ? { error: nested } : { id, label: id, connect: nested };
    }
    return { error: direct };
  }
  return { id: "", label: "", connect: direct };
}
