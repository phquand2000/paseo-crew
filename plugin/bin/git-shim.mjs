// A seat's git, first on its PATH: refuses what only the desk does to branches and working copies, however the command
// is spelled (-C, -c, --git-dir, an alias), and runs everything else as the real git would. Moving the branch checked out
// (merge, rebase, reset, cherry-pick) is left to a seat that writes ($CREW_WRITES), which stands on its task's branch since
// none checks out or switches. Run as: git-shim.mjs <git> <args>.
// It works only in the seat's own copy of the project ($CREW_WORKTREE): the Human's checkout and every other seat's copy
// of the same repository are refused, which on an agent with no sandbox is all that keeps them apart; a repository of
// any other making, as a test suite builds, is not.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";

const [git, ...argv] = process.argv.slice(2);

const VALUED = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix", "--config-env", "--list-cmds", "--attr-source"]);

const DESKS = new Set(["push", "pull", "checkout", "switch", "update-ref", "stash"]);

const MOVES = new Set(["merge", "rebase", "reset", "cherry-pick"]);

const INSTEAD = {
  checkout: "for one file, run git restore --source=<commit> -- <path>, or git show <commit>:<path> to read it",
  stash: "to read a stash, run git log -g refs/stash or git show stash@{<n>}",
  worktree: 'to read a whole revision, run git archive <commit> | tar -x -C "$(mktemp -d)"',
};

const OWN = new Set([...DESKS, ...MOVES, "add", "blame", "branch", "commit", "config", "diff", "fetch", "grep", "log", "ls-files", "rev-parse", "show", "status", "worktree"]);

const DEPTH = 10;

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

/** Where a fetch refspec writes what it fetches; nothing for one that writes nowhere or leaves a ref out. */
function landing(spec) {
  const at = spec.indexOf(":");
  return at < 0 || spec.startsWith("^") ? "" : spec.slice(at + 1);
}

/** Whether a fetch or remote writes what it fetches outside remote-tracking branches and tags, moving a branch as update-ref does. */
function fetchMoves(globals, command, rest) {
  if (rest.some((arg) => arg === "--stdin" || arg === "--refmap" || /^--refmap=./.test(arg))) return true;
  const named = command === "fetch" ? rest.filter((arg) => !arg.startsWith("-")).slice(1) : [];
  const run = spawnSync(git, [...globals, "config", "--get-regexp", "^remote\\..*\\.fetch$"], { encoding: "utf-8" });
  const configured = run.status === 0 ? run.stdout.split(/\r?\n/).map((line) => line.slice(line.indexOf(" ") + 1)) : [];
  return [...named, ...configured].some((spec) => {
    const to = landing(spec);
    return to !== "" && !/^refs\/(remotes|tags)\//.test(to);
  });
}

/** Why `command` with `rest` is the desk's to run, not a seat's; nothing when it is the seat's. */
function refusal(globals, command, rest) {
  if (DESKS.has(command))
    return [`git ${command} moves branches or working copies, and that is the desk's to do`, INSTEAD[command]].filter(Boolean).join("; ");
  if (MOVES.has(command) && !process.env.CREW_WRITES)
    return `git ${command} moves the branch checked out, and only a seat that writes moves one, its own task's`;
  if (command === "worktree" && rest[0] !== "list")
    return ["git worktree changes working copies, and that is the desk's to do", INSTEAD.worktree].join("; ");
  if ((command === "fetch" || command === "remote") && fetchMoves(globals, command, rest))
    return "a fetch that writes outside refs/remotes/ or refs/tags/ moves a branch, and that is the desk's to do; fetch into refs/remotes/ and read it from there";
  if (command === "branch" && rest.some(rewritesBranch)) return "git branch that forces, deletes, renames or overwrites a branch is the desk's to do";
  return undefined;
}

/** The words an alias stands for, read with the same options, so `git -c alias.p=push p` is read as a push; a shell alias comes back as its text. */
function expanded(globals, command) {
  if (OWN.has(command)) return undefined;
  const run = spawnSync(git, [...globals, "config", "--get", `alias.${command}`], { encoding: "utf-8" });
  const alias = run.status === 0 ? run.stdout.trim() : "";
  if (!alias) return undefined;
  return alias.startsWith("!") ? alias : alias.split(/\s+/);
}

/** The copy git works in for these options and the repository it is a copy of; nothing where it works in none. */
function copyOf(globals) {
  const run = spawnSync(git, [...globals, "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"], {
    encoding: "utf-8",
  });
  const [top, common] = run.status === 0 ? run.stdout.trim().split(/\r?\n/) : [];
  if (!top || !common) return undefined;
  try {
    return { top: realpathSync.native(top), common: realpathSync.native(common) };
  } catch {
    // A path gone since git named it is no copy to compare.
    return undefined;
  }
}

function refuse(why) {
  process.stderr.write(`git: refused: ${why}. Say what you need to whoever gave you the work.\n`);
  process.exit(1);
}

let { globals, command, rest } = split(argv);
const own = process.env.CREW_WORKTREE;
if (own && command) {
  const [here, mine] = [copyOf(globals), copyOf(["-C", own])];
  if (here && mine && here.common === mine.common && here.top !== mine.top)
    refuse(`this git works in ${here.top}, not in your own copy ${mine.top}; read another copy's work by its branch from yours`);
}
for (let depth = 0; command; depth++) {
  const why = refusal(globals, command, rest);
  if (why) refuse(why);
  const words = expanded(globals, command);
  if (!words) break;
  if (depth === DEPTH) refuse(`git ${command} is an alias more than ${DEPTH} deep, past what this check reads; run what it stands for`);
  // git puts its own exec-path first on a shell alias's PATH, so the git inside it would run past this check unread.
  if (typeof words === "string") refuse(`git ${command} is a shell alias, which runs git out of this check's sight; run its commands directly`);
  // An alias may open with options of git's own, as `-p push` does: its command is read after them.
  const again = split([...words, ...rest]);
  globals = [...globals, ...again.globals];
  ({ command, rest } = again);
}

const ran = spawnSync(git, argv, { stdio: "inherit" });
if (ran.error) {
  process.stderr.write(`git: ${ran.error.message}\n`);
  process.exit(127);
}
process.exit(ran.status ?? 1);
