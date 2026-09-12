---
name: seat-safety-review
description: "Maps what every seat in this kit can reach, flags each seat and chain that holds private data, untrusted content, and an exfiltration path, and proposes the cheapest fix that removes a whole leg. Use when providers, deny lists, guards, packages, MCP servers, or skills change, or the Human asks how safe the seats are."
disable-model-invocation: true
---

# Seat safety review

Use this skill to find where a prompt injection could leak private data or trigger a side effect.
A seat that holds private data, reads untrusted content, and can send data out (the trifecta) can
be steered by that content into sending the data out; look for it in every seat and every chain of
seats that pass messages.

It reviews the kit and the machine, not one project: the six providers and six profiles are
global, so a per-project inventory would say nothing a global one doesn't. `references/` and
`scripts/` paths are relative to this directory; the rest to the kit root.

It produces a seat matrix from [references/matrix-template.md](references/matrix-template.md),
saved by default at `maintenance/records/seat-matrix.md` and replaced in place on each review so
git keeps the history. Every change it proposes is the Human's: a kit diff, or an edit to
`~/.paseo/config.json` or a profile.

Print credential names, never values: the matrix is committed, and an agent's transcript lands in
a directory its harness shares with every seat on it. Select config keys with `jq`, or use
[scripts/inventory.sh](scripts/inventory.sh), which prints only names and presence.

## Procedure

Steps 1–3 map what exists, 4–5 what can go wrong, 6 the response, and 7–8 the record.

1. **List every seat, including providers outside the kit.** Compare `seats.json` and
   `harness/*/harness.json` (intended) with `~/.paseo/config.json` (actual). Any enabled provider
   is a seat, because any agent with `create_agent` can launch it, whatever its prompt says. Run
   `sh scripts/inventory.sh`. **Done** when every provider in the live config is a row, including
   any the kit didn't create.
2. **Fill in each seat's capabilities.** For each row, record:
   - Tools: the harness's own tools, minus whatever its manifest's `deny.mechanism` names (a Paseo
     `disallowedTools` list, guard hooks, or a guard extension) and minus the guards `seats.json`
     gives that seat; more is blocked with `SEATWORKS_READ_ONLY=1`. Paseo tools from
     `daemon.mcp.injectIntoAgents`, minus the ones the seat's `paseo` or `paseo-write` intent
     denies; MCP servers in the profile file the manifest's `state.file` names, and the deny map
     in the settings file its `settings.file` names; skills, including
     every directory in the manifest's `sharedSkillDirs`, which all of that harness's profiles
     load.
   - Credentials: env var names on the provider, the linked auth file, and what any shell
     inherits. The script reports the paths in
     [references/inventory-sources.json](references/inventory-sources.json) and probes the git
     hosting CLI, the ssh agent, and the git credential helper; a credential this list would name
     goes in that file instead.
   - Private data: the repositories a seat works in, every shared directory in the manifest's
     `links` (a transcript directory there is readable by every seat on that harness), the
     notebooks, `.env` files.
   - Untrusted content: web pages, issue and pull request text, dependency source and READMEs, bot
     or chat messages, and agent output derived from these; it stays untrusted when passed on.
   - Egress: web fetch tools, the shell network commands the same sources file lists, MCP servers
     that write, Paseo messages to a seat with egress.
   - Side effects with no Human gate: push, deploy, publish, email, payments.
   - Enforcement: for each intent `seats.json` asks for, whether this harness maps it to a tool
     name (`deny.intents`), holds it in a guard (`deny.enforcedByGuard`), or neither, in which
     case it is prompt only. `setup-seats.fish` prints the neither list per seat on every run.

   **Done** when no cell is blank; write `none` or `unknown` where that's the answer.
3. **Trace the chains between seats.** List every edge with its direction: Supervisor to Lead
   (`send_agent_prompt`), Lead to Peer (`create_agent` with a brief), Peer handoff to Lead, Lead
   to Lead, and any bot or external channel. A chain counts as one seat: a Peer that reads an
   untrusted README and hands off to a Lead with egress holds both legs. **Done** when every edge
   is listed.
4. **Flag the trifectas.** Mark each seat and chain for private data, untrusted content, and an
   exfiltration path; flag every row with all three, rated by what could leave and through which
   path. A leg blocked only by prompt text still counts as open, because a guard is a guard rail,
   not a sandbox (see "Command guards are guard rails, not sandboxes" in `REFERENCE.md`). **Done**
   when every row has a yes or no, and each yes names its three legs.

   Look first at these places; they're leads, not verdicts:
   - the peer guard blocks `git push` and agent CLIs, not other network commands;
   - a deny list blocks the harness's own web-search tool, not web fetch or shell network
     commands, and Paseo applies `disallowedTools` only to some harnesses: the manifest's
     `deny.mechanism` says which;
   - providers outside the kit may have no deny list and full Paseo tools;
   - seats on one harness share the directories in its `links`, so each can read the others'
     transcripts.
5. **Note the other threats.** Briefly: destructive commands no gate covers (force push, data
   deletion, `rm` outside the owned scope), secrets that may reach logs or transcripts, prompt and
   protocol files a seat can write, plus anything outside the trifecta. **Done** when each item
   names the seat and the path.
6. **Choose a fix for each flag.** Prefer the cheapest fix that removes a whole leg:
   - Break a leg: remove the egress (deny a web fetch tool, add network commands to the peer
     guard, run the seat without network), the private data (separate credentials, a Peer-only API
     key, no shared transcripts), or the untrusted input.
   - Narrow the tools: a deny entry, removing an MCP server or package, or `enabled: false` on a
     provider nobody uses.
   - Gate the side effect: list it under a repository's owner decisions, or require explicit
     permission in the brief.

   Record which leg each fix breaks, which surface changes, and whether it's enforced or only
   guidance. **Done** when every flag has a fix, or a line recording that the Human accepted the
   risk.
7. **Write the matrix** from the template: the date, the commands you ran, the matrix, chains,
   flags, fixes, and what you didn't check. **Done** when the file is saved with its "Not checked"
   section filled in.
8. **Report** to the Human in at most five lines: how many seats were flagged, the worst chain,
   the fixes needing a Human decision, and the kit diffs you propose. **Done** when the report is
   sent.

Rerun after any change to providers, `seats.json`, a harness manifest or its guards, profile
packages, MCP servers, or skill allowlists, and when a project gains production credentials.


The rule that matters most: count only enforced limits as closing a leg, and count a chain of
seats as one seat.
