import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tempDir } from "../core/testing.ts";
import { type Kit, loadKit } from "./kit.ts";

function put(root: string, path: string, value: unknown): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
}


export function makeKit(): Kit {
  const dir = tempDir("sw2-kit-");
  put(dir, "roles.json", {
    providerPrefix: "sw2-",
    attention: { leadIdleMinutes: 15 },
    roles: [
      {
        role: "supervisor",
        label: "Supervisor",
        team: "supervisor",
        entry: true,
        defaults: { harness: "claude", model: "opus", thinking: "high" },
        prompt: "prompts/SUPERVISOR.md",
        skills: "supervisor",
        paseoTools: { disabledTools: ["update_agent"] },
      },
      {
        role: "lead",
        label: "Lead",
        team: "lead",
        defaults: { harness: "claude", model: "opus", thinking: "medium" },
        prompt: "prompts/LEAD.md",
        skills: null,
        hidesWords: ["supervisor"],
      },
      {
        role: "peer",
        label: "Peer",
        team: "peer",
        defaults: { harness: "devin", model: "swe" },
        prompt: "prompts/PEER.md",
        skills: "peer",
        extraSkills: ["supervisor:plan-check"],
        paseoTools: { enabled: false },
        hidesWords: ["paseo", "seat"],
      },
      {
        role: "watcher",
        label: "Watcher",
        headless: true,
        defaults: { harness: "devin", model: "swe" },
        prompt: "prompts/WATCHER.md",
        skills: null,
      },
    ],
  });
  put(dir, "harness/claude/harness.json", {
    id: "claude",
    label: "Claude Code",
    baseProvider: "claude",
    configDirEnv: "CLAUDE_CONFIG_DIR",
    profileRoot: "HOME/.claude/profiles",
    promptFile: "CLAUDE.md",
    contextFile: "CLAUDE.md",
    skillsDir: "skills",
    systemPrompt: "config",
    stateAccess: "sandboxAllowWrite",
    settings: { mode: "link", file: "settings.json", source: "settings/ROLE.settings.json" },
    links: [{ link: "projects", target: "HOME/.claude/projects" }],
    models: [
      { id: "opus", label: "Opus", thinkingOptions: [{ id: "medium", label: "M" }, { id: "high", label: "H" }] },
      { id: "haiku", label: "Haiku" },
    ],
    mcp: { file: ".claude.json", delivery: "launch", seed: "{\"hasCompletedOnboarding\": true}", isolateProjects: true, transports: ["stdio", "http"] },
    provider: { env: { CLAUDE_CODE_DISABLE_CRON: "1", SEATWORKS_HARNESS: "claude", SEATWORKS_AGENT_BIN: "claude" }, profileModeId: "bypassPermissions", command: ["KIT/bin/seat-room"] },
  });
  put(dir, "harness/claude/settings/supervisor.settings.json", { permissions: { deny: ["WebSearch"] } });
  put(dir, "harness/claude/settings/lead.settings.json", { permissions: { deny: ["Agent"] } });
  put(dir, "harness/devin/harness.json", {
    id: "devin",
    label: "Devin CLI",
    baseProvider: "acp",
    configDirEnv: "XDG_CONFIG_HOME",
    profileRoot: "HOME/.devin/seats",
    promptFile: "devin/AGENTS.md",
    skillsDir: "devin/skills",
    hasThinking: false,
    systemPrompt: "file",
    settings: { mode: "merge", file: "devin/config.json", source: "settings.json", roleSource: "settings/ROLE.settings.json", ownedPaths: ["permissions", "read_config_from"] },
    links: [{ link: "git", target: "HOME/.config/git", optional: true }],
    models: [{ id: "swe", label: "SWE" }],
    mcp: { file: "devin/mcp_config.json", delivery: "file", seed: "{}", needsListing: true, transports: ["stdio", "http"] },
    provider: { env: { SEATWORKS_HARNESS: "devin", SEATWORKS_AGENT_BIN: "devin" }, profileModeId: "bypass", command: ["KIT/bin/seat-room", "acp"] },
    headless: ["devin", "--model", "{model}", "-p", "--prompt-file", "{promptFile}"],
  });
  put(dir, "harness/devin/settings.json", { read_config_from: { claude: false }, notify: "never", permissions: { deny: ["Exec(git push)"] } });
  put(dir, "harness/devin/settings/lead.settings.json", {});
  put(dir, "harness/devin/settings/peer.settings.json", {});
  put(dir, "harness/devin/settings/watcher.settings.json", { permissions: { deny: ["exec"] } });
  put(dir, "catalog/mcp/ide/mcp.json", {
    id: "ide",
    label: "IDE",
    order: 10,
    kind: "proxy",
    proxy: "intellij",
    instructions: "Prefer the IDE tools.",
    url: "http://127.0.0.1:{port}/mcp",
    settings: { port: { type: "number", label: "Port", default: 29170 } },
    defaults: { enabled: true },
    internalTools: ["ide_open_project"],
    tools: { lead: ["ide_find_references"], peer: ["ide_find_references", "ide_refactor_rename"] },
    rule: "rule.md",
    roleNotes: { peer: "Check diagnostics before handing back." },
    skills: ["ide-guide"],
  });
  put(dir, "catalog/mcp/ide/rule.md", "Prefer the IDE for navigation.\n");
  put(dir, "catalog/mcp/ide/skills/ide-guide/SKILL.md", "---\nname: ide-guide\ndescription: using the IDE\n---\n");
  put(dir, "catalog/mcp/docs/mcp.json", {
    id: "docs",
    label: "Docs",
    order: 30,
    kind: "server",
    server: { type: "http", url: "https://docs.example/{path}" },
    settings: { path: { type: "string", label: "Path", default: "mcp" } },
    defaults: { enabled: false },
    roles: ["supervisor", "lead", "peer"],
    rule: "rule.md",
  });
  put(dir, "catalog/mcp/docs/rule.md", "Look library APIs up in the docs.\n");
  put(dir, "content/prompts/SUPERVISOR.md", "# Supervisor\n\nGuides live in {{guides}}; state in {{state}}.\n");
  put(dir, "content/prompts/LEAD.md", "# Lead\n\nRead {{guides}}/BRIEF.md.\n");
  put(dir, "content/prompts/PEER.md", "# Peer\n\nRead {{guides}}/BRIEF.md.\n");
  put(dir, "content/prompts/WATCHER.md", "# Watcher\n\nLabel each ending.\n");
  put(dir, "content/guides/BRIEF.md", "# Brief\n");
  put(dir, "content/skills/supervisor/plan-check/SKILL.md", "---\nname: plan-check\ndescription: checks a plan\n---\n");
  put(dir, "content/skills/peer/test-first/SKILL.md", "---\nname: test-first\ndescription: tests\n---\n");
  return loadKit(dir);
}
