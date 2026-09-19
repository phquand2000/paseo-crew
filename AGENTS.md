# AGENTS.md

A Paseo plugin that serves the **SLP** working concept (Supervisor / Lead / Peer).

**Nothing in this repository has shipped.** There are no external consumers, no supported versions
and nothing to stay compatible with. Take that literally — it is what licenses the hard cut below.

**Read `../REBUILD-TRACKER.md` before changing anything.** It is the context anchor: the concept,
the recovered architecture spec, the audit evidence, the plan, and the decisions already made. This
file holds only what you cannot derive by reading the code.

## The governing rule — the one thing to get right

> The plugin's only job is to **serve** the SLP concept so it works better with Paseo.
> It must **never constrain** how SLP works.

Every change gets one test: **does it remove a constraint on SLP, or add one?** A change that adds a
constraint is wrong by default and needs a recorded reason. And when a constraint must go, prefer
**removal over a switch to turn it off** — a switch is one more configuration combination with no
product meaning.

SLP is a **federated agent-governance graph**, not an orchestrator-worker hierarchy. Do not model it
as a tree, and do not assume `Supervisor > Lead > Peer` is a chain of command — authority runs on
different axes, not levels.

## The authority boundary — what this plugin may and may not decide

This plugin's authority is **session lifecycle, transport, routing, notification**, plus **durable
state and provenance**. That is all.

| Authority | Owner |
|---|---|
| Intent, priorities, external commitments | the Human |
| Intent interpretation, cross-boundary observation and intervention | a Supervisor |
| Room topology, sequencing, ownership, **integration and acceptance** | the Lead |
| Local engineering judgment within scope | the Peer |

So: **the plugin never decides acceptance** — that is the Lead's. A gate result, a test exit code or
a lint verdict is **evidence the Lead weighs**, never a veto on what the Lead may report. If you
find yourself writing a refusal, check it against this table first; if it is not lifecycle,
transport, routing, notification or provenance, it does not belong here.

The one constraint the concept *does* ask this plugin to enforce: a Supervisor may bypass the Lead
and intervene directly in a Peer, but it must never run a hidden command chain — every such
intervention **must** emit a durable notification to the Lead, or the room is split-brained.

## Commands

```bash
cd plugin && npm run check     # typecheck (both tsconfigs) + tests; run before every commit
```

`npm test` runs `node --test` over `test/**/*.test.ts` directly — there is no build step and no test
framework beyond the Node runner. `npm run typecheck` must be run as-is: it checks
`tsconfig.json` **and** `tsconfig.client.json`, and the client one is easy to forget.

## Conventions that differ from tool defaults

**One live contract, hard cut.** Breaking changes are mandatory. Never add a dual-read or dual-write
path, a version branch, a shim, a facade, an adapter for an old shape, a legacy parser, a read-time
upgrade, a migration path or a fallback. Protocol and schema `version` stays `1` — replace its
content rather than introducing v2. Fail fast and fail closed: a failed current path must not
activate alternate semantics. When a contract changes, update every producer and consumer in the
same change, and audit tests and fixtures rather than mechanically syncing them.

**Tests protect a settled contract; they do not choose architecture.** Add a unit test only for
money, state changes, permissions, migrations or concurrency. Prove everything else with one focused
check at the level a user sees it.

**A test that invents an API before its contract is settled is a defect** — not a style problem. If
the field or type does not exist yet, implement it or ask; do not write a test that mints it, because
the next agent will not hold your context, will read the red test as correct behaviour, and will bend
the implementation to satisfy it. The catalogue of them is
`plugin/content/skills/peer/test-first/references/test-antipatterns.md`; read it before writing tests.

**Do not keep dormant or speculative machinery.** No generic framework, plugin system or public
abstraction before a real second use case needs it, and no configurable policy without a named
consumer today.

**Write no docs, decision records or code comments unless asked.** Git history is the record, and
this repository deliberately has almost no prose.

**Commit subjects are a sentence saying what changed in behaviour**, in the imperative, sentence
case, no prefix and no ticket — often two clauses, frequently a contrast. Match the existing log:

```
Let the work decide how many agents run, not a quota
Reach Paseo through ports the plugin owns
Delete eight declarations nothing reaches
```

Never `fix:`, `feat:`, a scope prefix, or a subject naming the file you edited.

## Paseo 0.8 facts that are easy to get wrong

Verified against the installed SDK and the shipped daemon. Getting these wrong wastes hours.

- **A plugin CAN give an agent tools** — set `mcpServers` in `before('agent.create')`. It **cannot**
  change them afterwards. After creation, exactly four config fields are mutable: `modelId`,
  `modeId`, `thinkingOptionId`, `featureValues`.
- **`toolPolicy` is not an allow/deny list.** It is `{preapproved}` and only suppresses the
  permission prompt. `mcpServers` adds tools; `providers.<id>.paseoTools.disabledTools` removes
  built-in ones. Three different levers.
- **`before('agent.create')` cannot see agent `labels`** — its payload is validated
  `.pick({config, env}).strict()`, and `labels` is top-level. This is why a seat's role is encoded
  in its provider string. When creating seats from plugin code, pass `labels` to
  `paseo.agents.create()` instead of trying to reach them in the hook.
- **Agent labels are an open, server-side queryable `Record<string,string>`** and are the right place
  to attach role, concern and relationship data.
- **`systemPrompt` is creation-only.** An instruction change reaches a seat on its **next** creation.
  You cannot hot-swap a running agent's prompt.
- **The timeline can be read live, mid-turn**, via `paseo.agents.ref(id).timeline.subscribe()`, and
  it carries assistant prose and reasoning text. Turn-boundary is a choice this plugin made, not a
  platform limit.
- **`timeline.append` writes a durable, ordered item into an agent's own timeline.** It is the right
  channel for a notification that must survive the recipient being mid-turn, compacted or replaced.
- **SDK settings are host-scoped only**, enforced with a runtime throw. That is why this plugin owns
  its own machine/project settings store with revision-checked writes — keep it.
- **The three `before` hooks — `agent.create`, `agent.session_open`, `workspace.create` — are the
  only moments a plugin can refuse anything**, and they refuse by throwing. Everything else is
  observation. All hooks time out at **30 s**, and on those three a timeout **cancels the user's
  action**, so never do unbounded I/O there.
- **Paseo already ships a per-project `worktree.setup` / `worktree.teardown`, a cron
  `create_heartbeat` tool, a PTY API (`paseo.terminals`), and a `paseo.parent-agent-id` label.**
  Check for a native facility before building one.

## SLP is the preset, not the plugin

The plugin ships SLP and most people should take it. It is not the only thing the plugin can run,
and keeping that true is a standing requirement rather than an aspiration.

The pieces underneath it:

- **Roles are data.** `roles.json` declares each seat's `can` (an open list of capabilities the desk
  asks about — supervise, lead, work, write, review, watched), its `tools` (a set in `mcp/tools.json` that
  several roles may share), and its `concern`. Nothing in `server/` compares a role to a name.
- **A roles file in the state root replaces the shipped one**, and a role in it may give an absolute
  path for its prompt and skills — so a different arrangement is written beside its own prompts
  rather than by forking this package.
- **Capabilities, not names, decide everything downstream**: who a report reaches, who may accept,
  who is watched, which seat a tool call is allowed to make.
- **The desk's verbs are the interface**: `open_lane`, `start_task`, `accept`, `report`, `incidents`, `ack`,
  `message`, `answer`, `ask`, `done`. A seat reaches the ones its own tool set holds.

**The honest cost of going your own way**, because it should not be discovered later: the further
you get from the preset, the more of the support is yours. The prompts, the skills and the guides
are written for these seats and this flow; a different arrangement inherits the machinery and not
the wording, and the way you coordinate will be unique to your situation.

**The test that keeps this true:** if SLP were abandoned tomorrow for something else, would this
plugin survive? If a change would make the answer no, it is the wrong change.

## Where things live that you would not guess

- `plugin/content/**` is **not documentation** — it is the prompts, skills and guides shipped to
  agents at runtime. Editing it changes agent behaviour.
- `plugin/roles.json` is the SLP role preset; `plugin/harness/<harness>/settings/<role>.settings.json`
  carries that role's sandbox and approval policy.
- `plugin/mcp/code.mjs` is the model to copy: 283 lines with zero role names and zero workflow
  vocabulary, configured entirely by data passed at launch.
- The live Paseo daemon log is `~/.paseo/daemon.log`. The dated files beside it are dead, and their
  local-time names hide UTC contents.
- `NOTICE.md` is a license obligation, not a doc. Do not delete it.
