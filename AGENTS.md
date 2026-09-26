# AGENTS.md

A Paseo plugin that serves the **SLP** working concept (Supervisor / Lead / Peer, plus a Reviewer).
This file holds only what the code does not tell you.

- **Nothing here has shipped.** No consumers, no versions, nothing to stay compatible with.
- **Context anchor:** `../v3/CONCEPT.md` holds the concept, the recovered spec and the KEEP list;
  `../v3/PLAN.md` is the only list of open work; `../v3/DECISIONS.md` holds settled decisions and
  the recorded exceptions to the conventions below. Read the parts your change touches before
  changing it.

## The governing rule

> The plugin **serves** SLP so it works better with Paseo. It must **never constrain** how SLP works.

- Test every change: does it remove a constraint on SLP, or add one? Adding one needs a recorded
  reason. When a constraint goes, remove it; don't add a switch to turn it off.
- SLP is a federated governance graph, not a tree: `Supervisor > Lead > Peer` is not a chain of
  command. Authority runs on different axes.

## What the plugin may decide

Only **session lifecycle, transport, routing, notification, durable state and provenance**.

| Authority | Owner |
|---|---|
| Intent, priorities, external commitments | the Human |
| Intent interpretation, cross-boundary observation and intervention | a Supervisor |
| Topology, sequencing, ownership, integration and **acceptance** | the Lead |
| Engineering judgment within scope | the Peer |

- The plugin never decides acceptance. A gate or test result is evidence the Lead weighs, never a
  veto. Writing a refusal? Check it against this table first.
- The one constraint the concept asks for: a Supervisor may reach a Peer directly, but the desk
  always tells the Lead. No hidden command chains.

## Commands

```bash
cd plugin && npm run check    # typecheck (both tsconfigs) + tests; before every commit
paseo plugin reload seatworks-v2   # after a client change, to see it in the panel
```

No build step; tests are `node --test` over `test/**/*.test.ts`, loaded after `test/setup.ts`: every test
runs in a HOME of its own, and a `console.error` the test did not ask for fails it.

## Working here

- **There is no CI.** `npm run check` before every commit is the whole net.
- **Never start the daemon or launch seats to test.** Seats are real agents with broad permissions
  and they cost money. The suite, your reading and `~/.paseo/daemon.log` are the evidence.
- **Never print or cat a file that can hold a key:** `settings.json` under
  `~/.local/share/seatworks-v3/`, any project `settings.json`, `~/.paseo/config.json`. Fake keys in
  tests never start with OpenRouter's real key prefix, so a scan for it before a push finds only a
  real key.
- **Before touching a file the KEEP list names** (prompts, skills, harness settings, some code), read
  its row in `../v3/CONCEPT.md` §6: `plugin/test/catalog/keep.test.ts` fails when one of its anchors
  goes.
- **Don't click settings in the user's live Paseo** to test the panel: it writes their config.

## Conventions that differ from the defaults

- **One live contract, hard cut.** No dual path, version branch, shim, facade, old-shape adapter,
  legacy parser, read-time upgrade or fallback. Fail closed. Change every producer and consumer
  together, and audit tests rather than syncing them.
- **Kept files have no format number before 3.0.0.** Until then a file the plugin keeps and cannot
  rebuild (ledger, incidents, project, meta, settings, outbox, content.json) changes shape with no
  step: v3 keeps its state in a root of its own and nothing has shipped. 3.0.0 locks the format as
  state 1 and brings back the steps, fixtures and shape test (`../v3/DECISIONS.md`, Q9). Logs are
  only appended to and never migrated. A change to `content/` raises the version in `package.json`.
- **Tests protect a settled contract.** Unit tests only for money, state changes, permissions,
  migrations or concurrency; everything else gets one focused check at the level a user sees it.
- **A test that invents an API before its contract exists is a defect:** the next agent will bend
  the code to it. See `plugin/content/skills/peer/test-first/references/test-antipatterns.md`.
- **Fail first.** For every fix, put the old behaviour back and watch the new test fail. Green suites
  here have agreed with bugs before: one compared tool names where schemas mattered.
- **No dormant machinery:** no framework, abstraction or setting without a real consumer today.
- **`test/architecture.test.ts` is a ratchet** on import layers, cycles, file and function sizes,
  unused exports, and agent or server names in code. Its lists of known breaches only shrink: split or
  move the code, never add an entry or raise a number.
- **No docs or decision records unless asked.** Git history is the record; the owner's decisions,
  and the exceptions to these conventions, live in `../v3/DECISIONS.md`. No new markdown files
  either: plans go outside the repository, and a change that needs explaining is explained in its
  commit message.
- **Comments are few and short.** At most one docstring per function, method, class or type, one or
  two lines, saying what the name and code don't: why, a hidden constraint, a platform quirk. None on
  a field, member, constant or single line, and none that restates the code. Inside a body, a `//`
  only where the reason is invisible in the code, one line. A comment cleanup changes comments only:
  the code with comments stripped must print the same before and after.
- **Commit subjects:** one imperative sentence on what changed in behaviour, sentence case, no
  prefix, often two clauses. E.g. "Let the work decide how many agents run, not a quota". Never
  `fix:`/`feat:` or a file name.

## Paseo 0.9 facts that are easy to get wrong

- A plugin gives an agent tools via `mcpServers` in `before('agent.create')`, and cannot change them
  later. Afterwards only the model, mode, thinking option and feature values change, and the name
  and labels through `update_agent`.
- `toolPolicy` is `{preapproved}` only (suppresses prompts). `mcpServers` adds tools;
  `providers.<id>.paseoTools.disabledTools` removes built-ins.
- `before('agent.create')` can't see `labels` (payload is `.pick({config, env}).strict()`): a seat's
  role lives in its provider string. Pass `labels` to `paseo.agents.create()` instead. Labels are an
  open, server-side queryable `Record<string,string>`.
- `systemPrompt` is creation-only: a prompt change reaches a seat on its next creation.
- History comes back projected whatever the request asks: a tool call is one entry in its latest
  state and a run of text chunks one message. An entry's `seqEnd` can run past the entries after it,
  and an `after` page returns whole entries, restating rows before its cursor.
- Every message sent into a chat carries a `clientMessageId`: the client makes one when the sender gives none. A
  daemon restart, or a read of an archived agent, rebuilds the history from the agent's own transcript with none, so
  a user message without one has no known sender.
- `timeline.subscribe()` delivers live events only, prose and reasoning included. After a reconnect
  it sends `subscription_restored` and none of what was missed; a failed one sends `error` and is
  released. `timeline.append` writes a durable item into an agent's own timeline.
- The plugin's own client reconnects by itself, and its socket holds no lease.
- SDK settings are host-scoped only (runtime throw), hence the plugin's own revision-checked store.
- Only `before` hooks (`agent.create`, `agent.session_open`, `workspace.create`) can refuse, by
  throwing. Every hook call times out at 30 s, and on those three the timeout fails the user's
  action: no unbounded I/O there.
- The daemon and the app both check `requirements.paseo` in `paseo-plugin.json`, and refuse to load a
  plugin whose range leaves them out.
- Paseo already ships `worktree.setup`/`teardown`, `create_heartbeat`, a PTY API and a
  `paseo.parent-agent-id` label. Look for a native facility before building one.

## SLP is the preset, not the plugin

- **Roles are data** in `roles.json`: `can` (capabilities: supervise, lead, work, write, review,
  watched), `tools` (a set in `mcp/tools.json`), prompt, skills, defaults, `writes`, `follows`.
  Nothing in `server/` compares a role to a name; capabilities decide routing, acceptance and
  watching.
- **A roles file in the state root replaces the shipped one**, and may point at its own prompts and
  skills, so another arrangement needs no fork. Going your own way inherits the machinery, not the
  wording.
- **The test that keeps this true:** if SLP were dropped tomorrow, would the plugin survive? If a
  change makes the answer no, it is the wrong change.

## Where things live that you would not guess

- `plugin/content/**` is runtime content, not docs: prompts, skills and guides. An edit there
  changes agent behaviour. Keep prompts short and complete: one line per rule, an example
  only where a rule is subtle.
- `roles.json` `hidesWords` is a lint that throws: a Peer's prompt may not say "seat". Rephrase the
  text; never remove the lint.
- `plugin/harness/<agent>/settings/<role>.*` holds each role's sandbox and approval policy, and
  `plugin/harness/<agent>/delta/<role>.md` is runtime text added after that role's prompt on that
  agent: only what the agent's own instructions would lead the role wrong on.
- `plugin/mcp/code.mjs` is the shape to copy: no role names or workflow words, configured by data.
- `~/.paseo/daemon.log` is the live daemon log; the dated files beside it are dead.
- `NOTICE.md` is a license obligation. Never delete it.
