import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tempDir } from "./tempdir.ts";
import { type Kit, loadKit } from "../server/catalog/kit.ts";

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
        can: ["supervise"],
        tools: "supervisor",
        defaults: { harness: "claude", model: "opus", thinking: "high" },
        prompt: "prompts/SUPERVISOR.md",
        skills: "supervisor",
        paseoTools: { disabledTools: ["update_agent"] },
      },
      {
        role: "lead",
        label: "Lead",
        can: ["lead"],
        tools: "lead",
        defaults: { harness: "claude", model: "opus", thinking: "medium" },
        prompt: "prompts/LEAD.md",
        skills: null,
        hidesWords: ["supervisor"],
      },
      {
        role: "peer",
        label: "Peer",
        can: ["work"],
        tools: "peer",
        defaults: { harness: "devin", model: "swe" },
        prompt: "prompts/PEER.md",
        skills: "peer",
        extraSkills: ["supervisor:plan-check"],
        paseoTools: { enabled: false },
        hidesWords: ["paseo", "seat"],
      },
      {
        role: "scribe",
        label: "Scribe",
        defaults: { harness: "devin", model: "swe" },
        prompt: "prompts/SCRIBE.md",
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
    stateWrites: { path: "settings.sandbox.filesystem.allowWrite", delivery: "launch" },
    projectContextOption: "additionalDirectories",
    settings: { file: "settings.json", source: "settings.json", roleSource: "settings/ROLE.settings.json" },
    links: [{ link: "projects", target: "HOME/.claude/projects" }],
    models: [
      { id: "opus", label: "Opus", thinkingOptions: [{ id: "medium", label: "M" }, { id: "high", label: "H" }] },
      { id: "haiku", label: "Haiku" },
    ],
    mcp: {
      file: ".claude.json",
      delivery: "launch",
      seed: { hasCompletedOnboarding: true },
      clear: { set: { mcpServers: {}, enabledMcpjsonServers: [] }, remove: ["enableAllProjectMcpServers"], setInEach: { projects: { mcpServers: {} } } },
      transports: ["stdio", "http"],
    },
    provider: { env: { CLAUDE_CODE_DISABLE_CRON: "1", SEATWORKS_HARNESS: "claude", SEATWORKS_AGENT_BIN: "claude" }, profileModeId: "bypassPermissions", command: ["KIT/bin/seat-room"] },
  });
  put(dir, "harness/claude/settings.json", { autoMemoryEnabled: false, permissions: { deny: ["WebSearch"] } });
  put(dir, "harness/claude/settings/supervisor.settings.json", { askUserQuestionTimeout: "never" });
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
    settings: { file: "devin/config.json", source: "settings.json", roleSource: "settings/ROLE.settings.json", ownedPaths: ["permissions", "read_config_from"] },
    links: [{ link: "git", target: "HOME/.config/git", optional: true }],
    models: [{ id: "swe", label: "SWE" }],
    modes: [{ id: "accept-edits", label: "Code" }, { id: "bypass", label: "Bypass Permissions" }],
    mcp: { file: "devin/mcp_config.json", delivery: "file", key: "mcpServers", rule: "List a server's tools once before your first call to it, so you can call them.", transports: ["stdio", "http"] },
    provider: { env: { SEATWORKS_HARNESS: "devin", SEATWORKS_AGENT_BIN: "devin" }, profileModeId: "bypass", command: ["KIT/bin/seat-room", "acp"] },
    checks: [{ path: "HOME/.devin/credentials.toml", help: "Log in to Devin once, outside any seat." }],
  });
  put(dir, "harness/devin/settings.json", { read_config_from: { claude: false }, notify: "never", permissions: { deny: ["Exec(git push)"] } });
  put(dir, "harness/devin/settings/lead.settings.json", {});
  put(dir, "harness/devin/settings/peer.settings.json", {});
  put(dir, "harness/devin/settings/scribe.settings.json", { permissions: { deny: ["exec"] } });
  put(dir, "catalog/mcp/ide/mcp.json", {
    id: "ide",
    label: "IDE",
    order: 10,
    kind: "proxy",
    proxy: {
      backend: { type: "http", url: "http://127.0.0.1:{port}/mcp" },
      pin: "project_path",
      gitExclude: [".idea/"],
      open: { tool: "ide_open_project", args: { path: "{root}" } },
    },
    instructions: "Prefer the IDE tools.",
    requires: [".idea"],
    settings: { port: { type: "number", label: "Port", default: 29170 } },
    defaults: { enabled: true },
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
  // The fixture carries tool sets like the real kit, because a role names one and the kit is asked for it.
  put(dir, "mcp/tools.json", {
    supervisor: [{ name: "open_lane" }, { name: "answer" }, { name: "status" }],
    lead: [{ name: "start_task" }, { name: "report" }, { name: "ask" }, { name: "status" }],
    peer: [{ name: "done" }, { name: "ask" }],
  });
  put(dir, "content/prompts/SUPERVISOR.md", "# Supervisor\n\nGuides live in {{guides}}; state in {{state}}.\n");
  put(dir, "content/prompts/LEAD.md", "# Lead\n\nRead {{guides}}/BRIEF.md.\n");
  put(dir, "content/prompts/PEER.md", "# Peer\n\nRead {{guides}}/BRIEF.md.\n");
  put(dir, "content/prompts/SCRIBE.md", "# Scribe\n\nKeep the notes.\n");
  put(dir, "catalog/sensor/probe/sensor.json", {
    id: "probe",
    url: "https://sensor.invalid/decisions",
    model: "probe-1",
    timeoutSeconds: 1,
    retries: 0,
    stateChars: 2000,
    debounceSeconds: 1,
    everySeconds: 5,
    unclear: 0.2,
    questions: { stuck: { instructions: "Is it stuck?", threshold: 0.8, confirms: ["stuck"] } },
  });
  put(dir, "content/guides/BRIEF.md", "# Brief\n");
  put(dir, "content/skills/supervisor/plan-check/SKILL.md", "---\nname: plan-check\ndescription: checks a plan\n---\n");
  put(dir, "content/skills/peer/test-first/SKILL.md", "---\nname: test-first\ndescription: tests\n---\n");
  return loadKit(dir);
}
