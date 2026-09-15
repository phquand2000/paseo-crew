# Seatworks

Seatworks runs an SLPW agent team (Supervisor, Lead, Peer, Watcher) on [Paseo](https://getpaseo.com)
as one plugin. You talk to the Supervisor. It opens a lane per outcome, each Lead splits its lane into
tasks, each Peer works on its own branch, and the plugin merges accepted work through a gated queue.

- **Supervisor** decides everything short of the project's concept for you, and steps in when a lane
  goes wrong.
- **Lead** owns one lane: tasks, Peers, reviews, acceptance and integration.
- **Peer** does one task on its own branch and hands it back. A **Reviewer** is a read-only Peer.
- **Watcher** is a cheap model the plugin runs on flagged turn endings; it raises attention.

Coordination is code, not chat: every hand-back, ask, merge and report is a tool call the plugin
records, mail waits until the recipient's turn ends, and silence is detected. See
[DESIGN.md](DESIGN.md) for how and why.

## Install

You need Paseo 0.8, Node 22 or later, git, and the coding agents `plugin/roles.json` names (Claude
Code for Supervisor and Lead, Devin CLI for Peer, Reviewer and Watcher by default), logged in.

```bash
cd plugin && npm install && npm run check
```

```bash
paseo plugin install ./plugin
```

The plugin writes one Paseo provider and profile per role (`sw2-supervisor`, `sw2-lead`, `sw2-peer`,
`sw2-reviewer`) and builds each role's seat directory. After editing server code, run
`paseo plugin reload seatworks-v2`.

## Use

Start an agent from the `sw2-supervisor` profile in your repository and tell it what you want. Project
state (ledger, status, hand-backs, gate logs, notebook) lives in
`~/.local/share/seatworks-v2/projects/<repo>-<hash>/`, never in your repository; `status.md` there is
the one-screen view. Lanes land on your base branch when the Supervisor closes them; pushing is yours.

## Change a role's coding agent

Set the role's `harness` in `plugin/roles.json` to another directory under `plugin/harness/`, make
sure the role lists models for it under `byHarness`, and reload the plugin. Prompts and skills stay
as they are.
