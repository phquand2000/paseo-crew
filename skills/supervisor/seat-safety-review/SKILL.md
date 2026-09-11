---
name: seat-safety-review
description: "Builds a seat by capability matrix of tools, credentials, private data, untrusted input, and network egress for every Paseo provider, flags any seat or message chain that combines private data, untrusted content, and an exfiltration path, and proposes the cheapest fix. Use when providers, deny lists, guards, Pi packages, MCP servers, or skills change, or when the Human asks how safe the seats are."
---

# Seat safety review

Use this skill to find where a prompt injection could leak private data or trigger a side
effect, and to propose which leg to break. An agent that holds private data, reads untrusted
content, and can send data out can be steered by that content into sending the data out; the
review looks for that combination in every seat and in every chain of seats that pass messages.

The skill produces `records/safety/seat-matrix.md` in the kit, updated in place so that git keeps the
history, built from [references/matrix-template.md](references/matrix-template.md). Any policy
changes it proposes go through the protocol-patch skill. Paths starting with `references/` or
`scripts/` are relative to this skill's directory; every other path is relative to the kit.

Print the names of credentials, never their values. The matrix is committed, and your transcript
lands in the shared `~/.claude/projects`. To list configuration, select keys with `jq`, or run
[scripts/inventory.sh](scripts/inventory.sh) from the kit, which prints only names and presence.

## Procedure

The steps follow the four threat-modeling questions: what are we working on (steps 1–3), what
can go wrong (4–5), what are we going to do about it (6), and did we do a good enough job (7–8).

1. **List every seat, including providers outside the kit.** Compare
   `examples/paseo-providers.json` (the intended setup) with `~/.paseo/config.json` (the actual
   one). Any enabled provider is a seat, because any agent with `create_agent` can launch it,
   whatever its prompt says. Run `sh skills/supervisor/seat-safety-review/scripts/inventory.sh`.
   **Done** when every provider in the live config is a row, including ones the kit didn't
   create.
2. **Fill in each seat's capabilities.** For each row, record:
   - Tools: the runtime's tools minus the provider's `disallowedTools` (for Claude seats) or
     minus the patterns in `pi/extensions/peer-guard.ts` (for the Peer); Paseo tools, from
     `paseoTools.enabled` and `daemon.mcp.injectIntoAgents`; MCP servers in each profile's
     `.claude.json` or `mcp.json`; the Pi packages in `~/.pi/profiles/pi-peer/settings.json`; and
     skills, including `~/.agents/skills`, which every Pi profile loads.
   - Credentials: the env var names on the provider; the linked `auth.json`; and what every seat
     with a shell inherits: `gh` login and scopes, keys in the ssh agent, cloud CLI config, npm
     and netrc tokens, and the git credential helper.
   - Private data: the repositories the seat works in, `~/.claude/projects` (every Claude seat
     links it), the notebook, and `.env` files.
   - Untrusted content: fetched web pages, issue and pull request text, dependency source and
     READMEs, bot or chat messages, and any agent output derived from these. Untrusted content
     stays untrusted when another agent passes it on.
   - Egress: web fetch tools, network commands in the shell (`curl`, `wget`, `nc`, `ssh`,
     `git push`, `gh`, `npm publish`), MCP servers that write, and Paseo messages to a seat that
     has egress.
   - Side effects without a Human gate: push, deploy, publish, email, and payments.
   - Enforcement: whether each limit is enforced (`disallowedTools`, peer guard) or written only
     in a prompt.

   **Done** when no cell is blank; write `none` or `unknown` where that's the answer.
3. **Trace the chains between seats.** List every edge: Supervisor to Lead (`send_agent_prompt`),
   Lead to Peer (`create_agent` with a brief), Peer handoff to Lead, Lead to Lead, and any bot or
   external channel. A chain counts as one seat for this check: if a Peer reads an untrusted
   README and its handoff reaches a Lead with egress, the chain holds both of those legs.
   **Done** when every edge is listed with its direction.
4. **Flag the trifectas.** For each seat and each chain, mark private data, untrusted content, and
   an exfiltration path. Flag every row that has all three, and rate it by what data could leave
   and through which path. A leg blocked only by prompt text still counts as open, because a
   prompt is guidance and a guard is a guard rail, not a sandbox (see `REFERENCE.md`). **Done**
   when every row has a yes or a no, and each yes names its three legs.

   In this kit, look first at these places. They're leads to check, not verdicts:
   - the peer guard blocks `git push` and agent CLIs, but not other network commands;
   - the Claude deny lists block `WebSearch` but not web fetch or network commands in the shell;
   - providers outside the kit may have no deny list and full Paseo tools;
   - every Claude seat shares `~/.claude/projects`, so any Claude seat can read the others'
     transcripts.
5. **Note the other threats.** Record, briefly: destructive commands that no gate covers (force
   push, data deletion, `rm` outside the owned scope); secrets that may reach logs or transcripts;
   prompt and protocol files a seat can write to; and anything else that could go wrong that
   doesn't fit the trifecta. **Done** when each item names the seat and the path involved.
6. **Choose a fix for each flag.** Prefer the cheapest fix that removes a whole leg:
   - Break a leg: remove the egress (deny a web fetch tool, add network commands to the peer
     guard, run the seat without network), remove the private data (separate credentials, an API
     key only for the Peer, no shared transcripts), or remove the untrusted input.
   - Narrow the tools: add a deny entry, remove an MCP server or a package, or set `enabled:
     false` on a provider nobody uses.
   - Put a Human gate on the side effect: list it under the repository's owner decisions, or
     require explicit permission in the brief.

   For each fix, record which leg it breaks, which surface changes, and whether the result is
   enforced or only guidance. Changes to the kit go through the protocol-patch skill. Changes to
   `~/.paseo/config.json` or a profile are for the Human to make: write the exact change for
   them. **Done** when every flag has a fix, or a line recording that the Human accepted the
   risk.
7. **Write the matrix.** Save `records/safety/seat-matrix.md` from the template: the date, the commands
   you ran, the matrix, the chains, the flags, the fixes, and what you didn't check. **Done** when
   the file is saved and its "Not checked" section is filled in.
8. **Report.** Tell the Human, in at most five lines, how many seats were flagged, the worst
   chain, the fixes that need a Human decision, and the proposals going through protocol-patch.
   **Done** when the report is sent.

Rerun the review after any change to providers, deny lists, the peer guard, Pi packages, MCP
servers, or skill allowlists, and when a project gains production credentials. The portfolio-review
skill flags a matrix older than the last such change.

The rule that matters most: count only enforced limits as closing a leg, and count a chain of
seats as one seat.
