// A seat's git, first on its PATH: refuses what only the desk does to branches and working copies, however the command
// is spelled (-C, -c, --git-dir, an alias), and runs everything else as the real git would. Run as: git-shim.mjs <git> <args>.
import { spawnSync } from "node:child_process";

const [git, ...argv] = process.argv.slice(2);

const VALUED = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix", "--config-env", "--list-cmds", "--attr-source"]);

const DESKS = new Set(["push", "pull", "merge", "checkout", "switch", "reset", "rebase", "cherry-pick", "update-ref", "stash"]);

const OWN = new Set([...DESKS, "add", "blame", "branch", "commit", "config", "diff", "fetch", "grep", "log", "ls-files", "rev-parse", "show", "status", "worktree"]);

/** The options git reads before its command, the command, and what follows it. */
function split(args) {
  let at = 0;
  while (at < args.length && args[at].startsWith("-")) at += VALUED.has(args[at]) ? 2 : 1;
  return { globals: args.slice(0, at), command: args[at], rest: args.slice(at + 1) };
}

/** Whether `arg` asks git branch to force, delete, rename or overwrite: git takes a long option cut short, as `--del`, and a value such as `-committerdate` is no cluster of flags. */
function rewritesBranch(arg) {
  if (arg.startsWith("--")) {
    const long = arg.slice(2).split("=")[0];
    return long !== "" && ["force", "delete", "move"].some((name) => name.startsWith(long));
  }
  return /^-[acCdDfhilmMqrtuv]+$/.test(arg) && /[fdDmMC]/.test(arg);
}

/** Why `command` with `rest` is the desk's to run, not a seat's; nothing when it is the seat's. */
function refusal(command, rest) {
  if (DESKS.has(command)) return `git ${command} moves branches or working copies, and that is the desk's to do`;
  if (command === "worktree" && rest[0] !== "list") return "git worktree changes working copies, and that is the desk's to do";
  if (command === "branch" && rest.some(rewritesBranch)) return "git branch that forces, deletes, renames or overwrites a branch is the desk's to do";
  return undefined;
}

/** The command an alias stands for, read with the same options, so `git -c alias.p=push p` is read as a push; git ignores an alias named for a command of its own. */
function expanded(globals, command) {
  if (OWN.has(command)) return undefined;
  const run = spawnSync(git, [...globals, "config", "--get", `alias.${command}`], { encoding: "utf-8" });
  const alias = run.status === 0 ? run.stdout.trim() : "";
  // A shell alias runs git again through this same PATH, so what it starts is judged there.
  return alias && !alias.startsWith("!") ? alias.split(/\s+/) : undefined;
}

const { globals } = split(argv);
let { command, rest } = split(argv);
for (let depth = 0; command && depth < 10; depth++) {
  const why = refusal(command, rest);
  if (why) {
    process.stderr.write(`git: refused: ${why}. Say what you need to whoever gave you the work.\n`);
    process.exit(1);
  }
  const words = expanded(globals, command);
  if (!words) break;
  rest = [...words.slice(1), ...rest];
  command = words[0];
}

const ran = spawnSync(git, argv, { stdio: "inherit" });
if (ran.error) {
  process.stderr.write(`git: ${ran.error.message}\n`);
  process.exit(127);
}
process.exit(ran.status ?? 1);
