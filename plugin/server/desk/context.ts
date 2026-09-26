import type { RoleSpec } from "../catalog/kit.ts";
import type { Project } from "./project.ts";

export type ToolRequest = {
  id: string;
  agent: string;
  role: string;
  tool: string;
  args: Record<string, unknown>;
  cwd: string;
  at: number;
};
export type ToolReply = { ok: boolean; text: string };
export type Args = Record<string, unknown>;
export type Caller = { id: string; role: RoleSpec; title: string; project: Project };

export const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
export const strs = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : typeof value === "string" && value.trim()
      ? [value.trim()]
      : [];
/** Only the fields the call names, read as text or as a list: an amendment changes what it is given and nothing else. */
export const given = (args: Args, texts: string[], lists: string[]): Record<string, string | string[]> =>
  Object.fromEntries(
    [
      ...texts.map((key) => [key, str(args[key])] as const),
      ...lists.map((key) => [key, strs(args[key])] as const),
    ].filter(([key]) => args[key] !== undefined),
  );
export const ok = (text: string): ToolReply => ({ ok: true, text });
export const no = (text: string): ToolReply => ({ ok: false, text });

export type CodeIndex = {
  id: string;
  gitExclude: string[];
  open(path: string): Promise<{ ok: boolean; text: string }>;
  sync(path: string): Promise<{ ok: boolean; text: string }>;
  close(path: string): Promise<{ ok: boolean; text: string }>;
};

/** "duplicate": dropped as a repeat of a letter already sent. */
export type Posted = "sent" | "held" | "duplicate";

export type Mailer = { post(letter: { to: string; key: string; text: string; wakes?: false }): Promise<Posted> };
