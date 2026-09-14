import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type Kit, loadKit } from "./kit.ts";

function put(root: string, path: string, value: unknown): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
}

export function tempDir(prefix = "sw2-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function makeKit(): Kit {
  const dir = tempDir("sw2-kit-");
  put(dir, "roles.json", {
    providerPrefix: "sw2-",
    attention: { leadIdleMinutes: 15 },
    mcpServers: { search: { type: "stdio", command: "search-mcp" } },
    seats: [
      {
        role: "supervisor",
        label: "Supervisor",
        harness: "claude",
        entry: true,
        byHarness: { claude: { models: [{ id: "opus", label: "Opus", isDefault: true, thinkingOptions: [{ id: "medium", label: "M" }, { id: "high", label: "H", isDefault: true }] }] } },
        prompt: "prompts/SUPERVISOR.md",
        skills: "supervisor",
        extraMcpServers: { figma: { type: "http", url: "https://figma.example/mcp" } },
        paseoTools: { disabledTools: ["update_agent"] },
        mayStart: ["lead"],
      },
      {
        role: "lead",
        label: "Lead",
        harness: "claude",
        reports: "blocks",
        byHarness: { claude: { models: [{ id: "opus", label: "Opus", isDefault: true, thinkingOptions: [{ id: "medium", label: "M", isDefault: true }, { id: "high", label: "H" }] }, { id: "haiku", label: "Haiku" }] } },
        prompt: "prompts/LEAD.md",
        skills: null,
        mayStart: ["peer"],
        hidesWords: ["supervisor"],
      },
      {
        role: "peer",
        label: "Peer",
        harness: "devin",
        reports: "handback",
        byHarness: { devin: { models: [{ id: "swe", label: "SWE", isDefault: true }] } },
        prompt: "prompts/PEER.md",
        skills: "peer",
        extraSkills: ["supervisor:plan-check"],
        paseoTools: { enabled: false },
        mayStart: [],
        hidesWords: ["paseo", "seat"],
      },
    ],
  });
  put(dir, "harness/claude/harness.json", {
    id: "claude",
    label: "Claude Code",
    baseProvider: "claude",
    configDirEnv: "CLAUDE_CONFIG_DIR",
    profileRoot: "HOME/.claude/profiles",
    skillsDir: "skills",
    systemPrompt: "config",
    settings: { mode: "link", file: "settings.json", source: "settings/ROLE.settings.json" },
    links: [{ link: "projects", target: "HOME/.claude/projects" }],
    state: { file: ".claude.json", seed: "{\"hasCompletedOnboarding\": true}" },
    provider: { env: { CLAUDE_CODE_DISABLE_CRON: "1", SEATWORKS_HARNESS: "claude" }, profileModeId: "bypassPermissions", command: ["KIT/bin/seat-room"] },
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
    state: { file: "devin/mcp_config.json", seed: "{}" },
    provider: { env: { SEATWORKS_HARNESS: "devin" }, profileModeId: "bypass", command: ["KIT/bin/seat-room", "acp"] },
  });
  put(dir, "harness/devin/settings.json", { read_config_from: { claude: false }, notify: "never", permissions: { deny: ["Exec(git push)"] } });
  put(dir, "harness/devin/settings/peer.settings.json", {});
  put(dir, "content/prompts/SUPERVISOR.md", "# Supervisor\n\nGuides live in {{guides}}; state in {{state}}.\n");
  put(dir, "content/prompts/LEAD.md", "# Lead\n\nRead {{guides}}/BRIEF.md.\n");
  put(dir, "content/prompts/PEER.md", "# Peer\n\nRead {{guides}}/BRIEF.md.\n");
  put(dir, "content/guides/BRIEF.md", "# Brief\n");
  put(dir, "content/skills/supervisor/plan-check/SKILL.md", "---\nname: plan-check\ndescription: checks a plan\n---\n");
  put(dir, "content/skills/peer/test-first/SKILL.md", "---\nname: test-first\ndescription: tests\n---\n");
  return loadKit(dir);
}
