# CLAUDE.md

**Read [AGENTS.md](AGENTS.md).** It holds the governing rule, the authority boundary, the commands,
the conventions and the Paseo facts — all of it applies here and is deliberately not repeated.

Then read `../REBUILD-TRACKER.md`, which is the context anchor for the work in progress.

Only the Claude Code specifics are below.

## Before you start changing code

Everything `../REBUILD-TRACKER.md` lists as a defect has been fixed — Stage 0's five, and three
rounds of hunting after it. Read the round tables anyway before you debug something odd: each row
says what the defect was, what the fix chose, and why, and several of them were fixed **twice**
because the first fix was wrong in a way the suite agreed with. If what you are looking at is in a
row, the reasoning you need is already there.

Two of those rows are about how a green suite lies: it once compared tool *names* where the schemas
were what mattered, and it once agreed about a lane working in place when that was the only
arrangement in which the code was accidentally right. So when you fix something, put the old
behaviour back and watch your new test fail before you keep it.

## Working here

- **Run `cd plugin && npm run check` before every commit.** There is no CI in this repository, so
  that command is the whole safety net.
- **Do not start the Paseo daemon or launch seats to test a change.** Seats are real agents with
  `danger-full-access`-equivalent settings and they cost money. Read `~/.paseo/daemon.log` for what
  the plugin really did — but know what is in it: seat-directory writes and errors, and as of
  2026-09-18 no errors at all, because **no lane has ever run outside the test suite** (there is no
  project state under `~/.local/share/seatworks-v2/projects/` and no `events.log` anywhere). The
  suite and your own reading are the evidence. What the field can still show is residue: four empty
  working-copy directories under `~/.local/share/seatworks-v2/worktrees/` are how one defect was
  found.
- **`plugin/content/**` is runtime content, not docs.** A one-word edit to a prompt there changes
  how every Lead or Peer behaves. Treat it with the care you would give code, and check the
  19-item KEEP list in the tracker before touching a role prompt — several lines there are
  load-bearing and were verified as such.
- **`hidesWords` in `roles.json` is a build-time lint that throws.** If `npm run check` fails with
  "the *role* prompt contains words that role must not see", you used a word that role's prompt may
  not contain — for example the Peer's prompt may not say "seat". Rephrase; do not remove the lint.

## Writing

This repository has almost no prose, on purpose. Match it: no new markdown files, no decision
records, no code comments unless asked. If a change needs explaining, the commit subject explains it.
