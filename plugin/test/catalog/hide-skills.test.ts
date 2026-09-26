import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";
import { loadKit } from "../../server/catalog/kit.ts";
import { hideSkillsSetting } from "../../server/catalog/hide-skills.ts";
import { materialize, seatDir } from "../../server/catalog/seats.ts";
import { resolveTeam, withHarness } from "../../server/catalog/team.ts";
import { makeKit } from "../kit.ts";
import { tempDir } from "../tempdir.ts";

const ownSkills = (home: string, names: string[]): string => {
  const own = join(home, ".agents", "skills");
  for (const name of names) {
    mkdirSync(join(own, name), { recursive: true });
    writeFileSync(join(own, name, "SKILL.md"), `---\nname: ${name}\ndescription: x\n---\n`);
  }
  mkdirSync(join(own, "notes"), { recursive: true });
  return own;
};

test("the shipped Codex harness turns off the owner's ~/.agents/skills, each by the path of its SKILL.md", () => {
  const real = loadKit(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
  const codex = real.harnesses.codex!;
  const home = tempDir("sw2-hide-home-");
  assert.deepEqual(hideSkillsSetting(codex, home), {}, "no own skills, nothing to turn off");
  const own = ownSkills(home, ["ultra-review", "tilth"]);
  assert.deepEqual(hideSkillsSetting(codex, home), { skills: { config: ["tilth", "ultra-review"].map((name) => ({ path: join(own, name, "SKILL.md"), enabled: false })) } }, "a folder without a SKILL.md is no skill");
  assert.deepEqual(hideSkillsSetting(real.harnesses.claude!, home), {});
});

test("a seat's hidden skills sit beside the kit's own skill settings, not in their place", () => {
  const kit = makeKit();
  const files: Record<string, string> = {
    "harness.json": JSON.stringify({ id: "cx", label: "Cx", baseProvider: "codex", configDirEnv: "CODEX_HOME", profileRoot: "HOME/.cx", contextFile: "AGENTS.md", skillsDir: "skills", hideSkills: { roots: ["HOME/.agents/skills"], setting: "skills.config" }, settings: { file: "config.toml", source: "settings.toml", roleSource: "settings/ROLE.settings.toml" }, mcp: { file: "config.toml", delivery: "launch", transports: ["stdio", "http"] }, provider: {} }),
    "settings.toml": "[skills.bundled]\nenabled = false\n",
    "settings/lead.settings.toml": "",
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(kit.dir, "harness", "cx", path)), { recursive: true });
    writeFileSync(join(kit.dir, "harness", "cx", path), text);
  }
  const cx = loadKit(kit.dir);
  const team = withHarness(resolveTeam(cx), "lead", cx.harnesses.cx!);
  const home = tempDir("sw2-hide-home-");
  const own = ownSkills(home, ["plan"]);
  materialize(cx, team, "lead", home, undefined, {});
  const config = parse(readFileSync(join(seatDir(cx, team.roles.lead!.role, cx.harnesses.cx!, home), "config.toml"), "utf-8")) as Record<string, any>;
  assert.equal(config.skills.bundled.enabled, false);
  assert.deepEqual(config.skills.config, [{ path: join(own, "plan", "SKILL.md"), enabled: false }]);
});
