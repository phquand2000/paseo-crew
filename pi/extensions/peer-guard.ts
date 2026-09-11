// peer-guard: block bash commands the Peer seat must not run.
//
// Pi has no permission system, and Paseo's `disallowedTools` doesn't apply to Pi, so this
// `tool_call` hook is the only enforcement point for the Peer. The block reasons are neutral
// on purpose: the Peer prompt never mentions the orchestration layer.
//
// This is a guard rail against accidents, not a sandbox. Quoted strings are ignored to avoid
// blocking commit messages, so `sh -c 'git push'` still gets through.
//
// A read-only seat (the Reviewer) sets SEATWORKS_READ_ONLY=1 in its provider's env. For it the
// guard also blocks Pi's file tools and git commands that change the repository. Shell
// redirection still works, which keeps temporary files under $TMPDIR possible.
//
// The file has no runtime imports, so it doesn't depend on how Pi resolves modules.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// A command word starts at the beginning of the line or after a shell separator, subshell, or
// backtick, optionally behind VAR=value assignments, wrappers such as sudo or npx, and a path.
const ASSIGN = String.raw`(?:[A-Za-z_]\w*=\S*\s+)*`;
const WRAPPER =
  String.raw`(?:(?:sudo|env|exec|command|nohup|time|npx|bunx)\s+(?:-\S+\s+)*` + ASSIGN + `)*`;
const START = String.raw`(?:^|[\n;&|(\x60])\s*` + ASSIGN + WRAPPER + String.raw`(?:\S*/)?`;

const RULES: { pattern: RegExp; reason: string }[] = [
  {
    // git push, including `git -C dir push` and `git --no-pager push`.
    pattern: new RegExp(START + String.raw`git(?:\s+(?:-[Cc]\s+\S+|--?\S+))*\s+push\b`),
    reason:
      "Pushing is not available in this workspace. Commit locally and mention it in your handoff.",
  },
  {
    // GitHub CLI: pushes, pull requests, and API calls all leave this machine.
    pattern: new RegExp(START + String.raw`gh(?![\w.-])`),
    reason: "Calling GitHub is not available in this workspace. Say what you need in your handoff.",
  },
  {
    // Agent and orchestration CLIs: the Peer does its own work instead of starting agents.
    pattern: new RegExp(START + String.raw`(?:paseo|claude|codex|opencode|omp|pi)(?![\w.-])`),
    reason:
      "Starting or controlling other agents is not available in this workspace. Do the work yourself, or say what you need in your handoff.",
  },
];

const READ_ONLY_RULES: { pattern: RegExp; reason: string }[] = [
  {
    // git subcommands that change the index, the working tree, or history. Whole names only, so
    // read-only commands such as `git merge-base` still run.
    pattern: new RegExp(
      START +
        String.raw`git(?:\s+(?:-[Cc]\s+\S+|--?\S+))*\s+` +
        String.raw`(?:add|commit|stash|reset|checkout|switch|restore|merge|rebase|cherry-pick|revert|am|apply|clean|rm|mv)(?![\w.-])`,
    ),
    reason: "Changing the repository is not available in a review. Report it as a finding.",
  },
];

const READ_ONLY_TOOLS = new Set(["write", "edit"]);
const READ_ONLY_TOOL_REASON =
  "Editing files is not available in a review. Put temporary notes under $TMPDIR with the shell, and report fixes in your findings.";

const READ_ONLY =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
    .SEATWORKS_READ_ONLY === "1";

// Blank out quoted strings so that words inside them don't count as commands.
function unquoted(command: string): string {
  return command.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, "''");
}

export function blockReason(command: string, readOnly = READ_ONLY): string | undefined {
  const text = unquoted(command);
  const rules = readOnly ? RULES.concat(READ_ONLY_RULES) : RULES;
  return rules.find((rule) => rule.pattern.test(text))?.reason;
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event) => {
    if (READ_ONLY && READ_ONLY_TOOLS.has(event.toolName)) {
      return { block: true, reason: READ_ONLY_TOOL_REASON };
    }
    if (event.toolName !== "bash") return;
    const reason = blockReason(String((event.input as { command?: unknown }).command ?? ""));
    if (reason) return { block: true, reason };
  });
}
