# CLAUDE.md

**Read [AGENTS.md](AGENTS.md).** It holds the governing rule, the authority boundary, the commands,
the conventions and the Paseo facts — all of it applies here and is deliberately not repeated.

Then read `../REBUILD-TRACKER.md`, which is the context anchor for the work in progress.

Only the Claude Code specifics are below.

## Before you start changing code

`../REBUILD-TRACKER.md` records **five verified live defects** under "Stage 0 — Stop the bleeding",
one of them a security issue in `plugin/bin/seat-room`. Check that list before you debug something
odd — it may already be known, and its fix may already be planned.

## Working here

- **Run `cd plugin && npm run check` before every commit.** There is no CI in this repository, so
  that command is the whole safety net.
- **Do not start the Paseo daemon or launch seats to test a change.** Seats are real agents with
  `danger-full-access`-equivalent settings and they cost money. The unit tests cover the plugin's
  own logic; read `~/.paseo/daemon.log` for real behaviour instead of reproducing it.
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
