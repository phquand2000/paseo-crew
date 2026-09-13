import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const ENV =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

const READ_ONLY = ENV.SEATWORKS_READ_ONLY === "1";
const ROLE = ENV.SEATWORKS_ROLE ?? "";

const ASSIGN = String.raw`(?:[A-Za-z_]\w*=\S*\s+)*`;
const OPTS = String.raw`(?:-\S+(?:\s+[^\s;&|<>()-]\S*)?\s+)*`;
const WRAPPER =
  String.raw`(?:(?:sudo|doas|env|exec|command|builtin|nohup|time|nice|timeout|stdbuf|xargs|eval|npx|bunx|pnpx)\s+` +
  OPTS +
  ASSIGN +
  String.raw`(?:\d[\w.]*\s+)?)*`;
const PREFIX = String.raw`(?:(?:[{!]|if|then|elif|else|do|while|until)\s+)*`;
const START =
  String.raw`(?:^|[\n;&|(\x60])\s*` + PREFIX + ASSIGN + WRAPPER + String.raw`(?:\S*/)?`;
const GITOPTS = String.raw`(?:\s+(?:-[Cc]\s+\S+|--(?:git-dir|work-tree|namespace|exec-path|config-env|super-prefix)\s+\S+|--?\S+))*`;
const GIT = START + "git" + GITOPTS + String.raw`\s+`;
const PASEO_CLI =
  String.raw`paseo(?![\w.-])` + (ROLE === "watcher" ? String.raw`(?!\s+logs(?![\w.-]))` : "");
const AGENT_CLI = String.raw`(?:claude|codex|opencode|omp|pi|claude-code|pi-coding-agent)(?![\w.-])`;

const RULES: { pattern: RegExp; reason: string }[] = [
  {
    pattern: new RegExp(GIT + String.raw`push\b`),
    reason:
      "Pushing is not available in this workspace. Commit locally and mention it in your handoff.",
  },
  {
    pattern: new RegExp(
      START + "git" + GITOPTS + String.raw`\s+(?:-c\s*alias\.|config\b[^;&|\n]*\salias\.)`,
    ),
    reason: "Git aliases are not available in this workspace. Run the git command itself.",
  },
  {
    pattern: new RegExp(START + String.raw`gh(?![\w.-])`),
    reason: "Calling GitHub is not available in this workspace. Say what you need in your handoff.",
  },
  {
    pattern: new RegExp(START + `(?:${PASEO_CLI}|${AGENT_CLI})`),
    reason:
      "Starting or controlling other agents is not available in this workspace. Do the work yourself, or say what you need in your handoff.",
  },
  {
    pattern: new RegExp(
      GIT + String.raw`worktree(?![\w.-])(?!\s+list(?![\w.-]))`,
    ),
    reason:
      "Adding or removing a worktree is not available in this workspace. Work in the checkout you were given, and say in your handoff if the task needs a second one.",
  },
];

const WRITES = [
  String.raw`(?:add|commit|reset|checkout|switch|restore|merge|rebase|cherry-pick|revert|clean|rm|mv|update-ref|pull)(?![\w.-])`,
  String.raw`am(?![\w.-])(?![^;&|\n]*--show-current-patch)`,
  String.raw`stash(?![\w.-])(?!\s+(?:list|show)(?![\w.-]))`,
  String.raw`apply(?![\w.-])(?:(?=[^;&|\n]*\s--apply(?![\w-]))|(?![^;&|\n]*\s--(?:check|stat|numstat|summary)(?![\w-])))`,
  String.raw`branch(?![\w.-])(?=[^;&|\n]*\s(?:-(?!-)[A-Za-z]*[dDfmMcCu]|--(?:delete|force|move|copy|set-upstream-to|unset-upstream|edit-description)(?![\w-])))`,
  String.raw`tag(?![\w.-])(?=[^;&|\n]*\s(?:-(?!-)[A-Za-z]*[dfasmF]|--(?:delete|force|annotate|sign|message|file)(?![\w-])))`,
  String.raw`notes(?![\w.-])(?!\s+(?:list|show)(?![\w.-]))`,
  String.raw`worktree(?![\w.-])(?!\s+list(?![\w.-]))`,
  String.raw`config(?![\w.-])(?!(?:\s+-\S+)*\s+(?:get|list)(?![\w.-]))(?![^;&|\n]*\s(?:--get(?:-all|-regexp|-urlmatch|-color|colorbool)?|--list|-l)(?![\w-]))`,
];

const READ_ONLY_RULES: { pattern: RegExp; reason: string }[] = [
  {
    pattern: new RegExp(GIT + `(?:${WRITES.join("|")})`),
    reason: "Changing the repository is not available in this role. Report it instead.",
  },
];

const READ_ONLY_TOOLS = new Set(["write", "edit", "ast_edit", "notebook"]);
const READ_ONLY_TOOL_REASON =
  "Editing files is not available in this role. Put temporary notes under $TMPDIR with the shell, and report what you would change.";
const LSP_WRITE_REASON =
  "Renaming or applying fixes through the language server changes files, which this role does not do. Report the change instead.";

const WEB_PATH = /^(?:https?|pr|ssh):\/\//i;
const WEB_READ_REASON =
  "Reading from the web is not available in this role. Work from the activity and your log.";

const DENIED = new Set(
  (ENV.SEATWORKS_DENIED_TOOLS ?? "")
    .split(":")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0),
);

const HIDDEN = (ENV.SEATWORKS_HIDDEN_PATHS ?? "")
  .split(":")
  .map((entry) => entry.trim().replace(/\/+$/, ""))
  .filter((entry) => entry.length > 0);
const HIDDEN_REASON =
  "That path is not part of this workspace. Everything this task needs is in your brief and in the repository instruction file; name what is missing in your report instead.";

export function deniedIntents(seatsPath: string, role: string): Set<string> {
  try {
    const parsed = JSON.parse(readFileSync(seatsPath, "utf-8")) as {
      denyCommonIntents?: string[];
      seats?: { role: string; denyIntents?: string[] }[];
    };
    const seat = (parsed.seats ?? []).find((entry) => entry.role === role);
    return new Set([...(parsed.denyCommonIntents ?? []), ...(seat?.denyIntents ?? [])]);
  } catch {
    return new Set();
  }
}

const SEATS = ENV.SEATWORKS_SEATS ?? (ENV.SEATWORKS_KIT ? `${ENV.SEATWORKS_KIT}/seats.json` : "");
const INTENTS = ROLE && SEATS ? deniedIntents(SEATS, ROLE) : new Set<string>();

export function lspWrites(input: { action?: unknown; apply?: unknown }): boolean {
  const action = String(input.action ?? "");
  if (action === "request") return true;
  if (action === "rename" || action === "rename_file") return input.apply !== false;
  return action === "code_actions" && input.apply === true;
}

function hidden(path: string): boolean {
  const clean = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return HIDDEN.some(
    (entry) =>
      clean === entry ||
      clean.startsWith(entry + "/") ||
      clean.endsWith("/" + entry) ||
      clean.includes("/" + entry + "/"),
  );
}

function unquoted(command: string): string {
  return command.replace(
    /\\([\s\S])|'[^']*'|"(?:[^"\\]|\\[\s\S])*"|(^|[\s;&|()])#[^\n]*/g,
    (_match, escaped: string | undefined, before: string | undefined) => {
      if (escaped !== undefined) return /[\w./-]/.test(escaped) ? escaped : escaped === "\n" ? " " : "_";
      if (before !== undefined) return before;
      return "''";
    },
  );
}

export function blockReason(command: string, readOnly = READ_ONLY): string | undefined {
  const text = unquoted(command);
  const rules = readOnly ? RULES.concat(READ_ONLY_RULES) : RULES;
  const hit = rules.find((rule) => rule.pattern.test(text))?.reason;
  if (hit) return hit;
  if (HIDDEN.length > 0 && text.split(/[\s;&|()'"><]+/).some(hidden)) return HIDDEN_REASON;
  return undefined;
}

export default function (pi: ExtensionAPI) {
  if (DENIED.size > 0) {
    pi.on("session_start", () => {
      const active = pi.getActiveTools();
      const keep = active.filter((name) => !DENIED.has(name));
      if (keep.length !== active.length) pi.setActiveTools(keep);
    });
  }

  pi.on("tool_call", async (event) => {
    if (READ_ONLY && READ_ONLY_TOOLS.has(event.toolName)) {
      return { block: true, reason: READ_ONLY_TOOL_REASON };
    }
    if (READ_ONLY && event.toolName === "lsp" && lspWrites(event.input as { action?: unknown; apply?: unknown })) {
      return { block: true, reason: LSP_WRITE_REASON };
    }
    const input = event.input as { command?: unknown; path?: unknown; file_path?: unknown };
    const path = String(input.path ?? input.file_path ?? "");
    if (path && hidden(path)) return { block: true, reason: HIDDEN_REASON };
    if (event.toolName === "read" && INTENTS.has("web-fetch") && WEB_PATH.test(path)) {
      return { block: true, reason: WEB_READ_REASON };
    }
    if (event.toolName !== "bash") return;
    const reason = blockReason(String(input.command ?? ""));
    if (reason) return { block: true, reason };
  });
}
