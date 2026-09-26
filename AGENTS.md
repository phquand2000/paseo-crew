# AGENTS.md

Seatworks is a Paseo plugin that runs a team of coding agents the **SLP** way: a Supervisor works
with the Human, a Lead owns each lane of work, and Peers each do one task, with a Reviewer, a Watcher
and a Pager beside them. This file holds what the code will not tell you before you change it. How
the parts fit is in `docs/ARCHITECTURE.md`; every name and value is in `docs/REFERENCE.md`.

**Nothing has shipped.** No users, no releases, nothing to stay compatible with.

## The governing rule

> The plugin **serves** SLP so it works better with Paseo. It must **never constrain** how SLP works.

- Ask of every change: does it take a constraint off SLP, or add one? Adding one needs a reason,
  written in its commit message. When a constraint goes, delete it; never add a switch to turn it
  off.
- SLP is a federated governance graph, not a tree. `Supervisor > Lead > Peer` is not a chain of
  command: each role holds authority on its own axis.
- The test that keeps this true: if SLP were dropped tomorrow, would the plugin survive? A change that
  makes the answer no is the wrong change.

## What the plugin may decide

Only **session lifecycle, transport, routing, notification, durable state and provenance**.

| Authority | Owner |
|---|---|
| Intent, priorities, external commitments | the Human |
| Intent interpretation, cross-boundary observation and intervention | the Supervisor |
| Topology, sequencing, ownership, integration and **acceptance** | the Lead |
| Engineering judgment within scope | the Peer |

- The plugin never decides acceptance. A gate or test result is evidence the Lead weighs, never a
  veto. Writing a refusal? Check it against this table first.
- The one constraint the concept asks for: the Supervisor may reach a Peer directly, but the desk
  always tells the Lead first. No hidden command chains.

## How the design decides

These eight rules settle most questions about where a behaviour belongs.

1. **Code owns only the SLP concept.** Agents, models, tools, MCP servers, thresholds and the watch's
   questions are data or settings; changing them never needs a code change. The name of an agent, an
   MCP server or a sensor in the plugin's code is a defect, and a test fails on it.
2. **One door to the Human.** Only the Supervisor puts a question to the Human, on their queue. What
   the panel shows is the desk's record and the Supervisor's words. When the Human types into a Lead's
   or Peer's chat, the desk tells whoever supervises.
3. **Driven by events.** No heartbeat. A letter that asks nothing waits for one that does, so it
   never wakes a seat on its own.
4. **Evidence, not claims.** Accepting, reporting ready and landing always carry the desk's facts:
   gate, rehearsals, reviews. A seat saying "done" is a claim to check.
5. **Layered by what can be undone.** What can be undone goes ahead; what cannot waits for the Human,
   or is held and paged.
6. **What code can check is code.** A prompt keeps only judgement. An instruction that depends on the
   situation is the `Next:` line of the letter that brings the situation, not a table in a prompt.
7. **No switch that turns a constraint off.** Two exceptions: a watch question's `mode`, which
   calibration decides, and the Human's own standing orders.
8. **A signal earns its way.** A new question or incident ships in shadow, recorded and acted on by
   nothing, until labels show it is worth someone's attention.

## Commands

```bash
cd plugin && npm run check                                 # typechecks and every test: before every commit
cd plugin && node --test --import ./test/setup.ts <file>   # one test file, set up as the suite is
paseo plugin reload seatworks-v2                           # after a client change, to see it in the panel
```

There is no build step. `test/setup.ts` runs before every test file: each test gets a HOME of its
own, git's own binary goes first on PATH, Node keeps compiled code between runs, and a `console.error`
the test did not ask for fails it.

## Working here

- **There is no CI.** `npm run check` before every commit is the whole net.
- **Never start the daemon or launch seats to test.** Seats are real agents with broad permissions,
  and they cost money. The suite, your reading and `~/.paseo/daemon.log` are the evidence.
- **Never print or cat a file that can hold a key:** `settings.json` under
  `~/.local/share/seatworks-v3/`, the `settings.json.bak-*` copies Migrate keeps beside it, any
  project's `settings.json`, `~/.paseo/config.json`. Fake keys in tests never start with OpenRouter's
  real key prefix, so a scan for that prefix before a push finds only a real key.
- **Some lines must stay word for word.** `plugin/test/catalog/keep.test.ts` names each one (in
  prompts, skills, harness settings and some code) and what it keeps, and fails when one goes. Such a
  line is SLP's or Paseo's need, not style: change it only when that need changed, and say so in the
  commit.
- **Don't click settings in the owner's live Paseo** to test the panel: it writes their config.

## Conventions that differ from the defaults

- **One live contract, hard cut.** No dual path, version branch, shim, facade, old-shape adapter,
  legacy parser, read-time upgrade or fallback. Fail closed. Change every producer and consumer
  together, and audit the tests rather than syncing them.
- **Kept files have no format number before 3.0.0.** Until then a file the plugin keeps and cannot
  rebuild (ledger, incidents, project, meta, settings, outbox, intents, keys, `content.json`) changes
  shape with no upgrade step, since nothing has shipped. 3.0.0 locks the format as state 1 and brings
  back the upgrade steps, their fixtures and a shape test. Logs are only appended to, never migrated.
- **What a seat reads or is held to raises the version.** A change to `content/`, `harness/`, `mcp/`,
  `roles.json`, the desk's letters, briefs or directive, the git shim or `catalog/refused.json` raises
  `version` in `package.json`; `test/release.test.ts` checks it.
- **Tests protect a settled contract.** Unit tests only for money, state changes, permissions,
  migrations or concurrency; everything else gets one focused check at the level a user sees it.
- **A test that invents an API before its contract exists is a defect:** the next agent will bend the
  code to it. See `plugin/content/skills/peer/test-first/references/test-antipatterns.md`.
- **Fail first.** For every fix, put the old behaviour back and watch the new test fail. Green suites
  here have agreed with bugs before: one compared tool names where schemas mattered.
- **No dormant machinery.** No framework, abstraction or setting without a real consumer today.
- **`test/architecture.test.ts` is a ratchet** on import layers, cycles, file and function sizes,
  unused exports, and agent or server names in code. Its lists of known breaches only shrink: split or
  move the code, never add an entry or raise a number.
- **No docs or decision records unless asked.** Git history is the record. No new markdown files
  either: plans stay outside the repository, and a change that needs explaining is explained in its
  commit message. The docs name nothing outside the repository but the paths the plugin itself uses.
- **Comments are few and short.** At most one docstring per function, method, class or type, one or
  two lines, saying what the name and code don't: why, a hidden constraint, a platform quirk. None on
  a field, member, constant or single line, and none that restates the code. Inside a body, a `//`
  only where the reason is invisible in the code, one line. A comment cleanup changes comments only:
  the code with comments stripped must print the same before and after.
- **Commit subjects:** one imperative sentence on what changed in behaviour, sentence case, no
  prefix, often two clauses, such as "Let the work decide how many agents run, not a quota". Never
  `fix:`/`feat:` or a file name.

## Paseo 0.9 facts that are easy to get wrong

- A plugin gives an agent tools through `mcpServers` in `before('agent.create')` and cannot change
  which servers it has later; a server can still change the tools it lists (`list_changed`), as both
  of the plugin's do. Afterwards only the model, mode, thinking option and feature values change, and
  the name and labels through `update_agent`.
- `toolPolicy` is `{preapproved}` only, which suppresses prompts. `mcpServers` adds tools;
  `providers.<id>.paseoTools.disabledTools` removes built-ins.
- `before('agent.create')` can't see `labels` (its payload is `.pick({config, env}).strict()`), so a
  seat's role lives in its provider string. Pass `labels` to `paseo.agents.create()` instead. Labels
  are an open, server-side queryable `Record<string,string>`.
- `systemPrompt` is set only at creation: a prompt change reaches a seat the next time one is created.
- History comes back projected whatever the request asks: a tool call is one entry in its latest
  state, and a run of text chunks one message. An entry's `seqEnd` can run past the entries after it,
  and an `after` page returns whole entries, restating rows before its cursor.
- Every message sent into a chat carries a `clientMessageId`; the client makes one when the sender
  gives none. A daemon restart, or a read of an archived agent, rebuilds the history from the agent's
  own transcript with none, so a user message without one has no known sender.
- `timeline.subscribe()` delivers live events only, prose and reasoning included. After a reconnect
  it sends `subscription_restored` and none of what was missed; a failed one sends `error` and is
  released. `timeline.append` writes a durable item into an agent's own timeline.
- The plugin's own client reconnects by itself, and its socket holds no lease. A plugin gets that
  client only with a hook or a panel call: after a reload, a seat's desk call waits for one, and its
  answer window starts then.
- SDK settings are host-scoped only (a runtime throw), hence the plugin's own revision-checked store.
- Only `before` hooks (`agent.create`, `agent.session_open`, `workspace.create`) can refuse, by
  throwing. Every hook call times out at 30 s, and on those three the timeout fails the user's action:
  no unbounded I/O there.
- The daemon and the app both check `requirements.paseo` in `paseo-plugin.json` and refuse to load a
  plugin whose range leaves them out.
- Paseo already ships `worktree.setup`/`teardown`, `create_heartbeat`, a PTY API and a
  `paseo.parent-agent-id` label. Look for a native facility before building one.

## SLP is the preset, not the plugin

- **Roles are data** in `roles.json`: `can` (capabilities: `supervise`, `lead`, `work`, `write`,
  `review`, `watched`, `judge`, `page`), `tools` (a set in `mcp/tools.json`), prompt, skills,
  defaults, `writes`, `follows`. Nothing in `server/` compares a role to a name; capabilities decide
  routing, acceptance, watching, judging and paging.
- **A `roles.json` in the state root replaces the shipped one**, and may point at its own prompts and
  skills, so another arrangement needs no fork. Going your own way inherits the machinery, not the
  wording.

## Where things live that you would not guess

- `plugin/content/**` is runtime content, not docs: prompts, skills and guides. An edit there changes
  what agents do. Keep prompts short and complete: one line per rule, an example only where a rule is
  subtle.
- `roles.json` `hidesWords` is a lint that throws: a Peer's prompt may not say "seat". Rephrase the
  text; never remove the lint.
- `plugin/harness/<agent>/settings/<role>.*` holds each role's sandbox and approval policy, and
  `plugin/harness/<agent>/delta/<role>.md` is runtime text added after that role's prompt on that
  agent: only what the agent's own instructions would lead the role wrong on.
- `plugin/mcp/code.mjs` is the shape to copy: no role names or workflow words, configured by data.
- `~/.paseo/daemon.log` is the live daemon log; the dated files beside it are dead.
- `NOTICE.md` is a license obligation. Never delete it.
