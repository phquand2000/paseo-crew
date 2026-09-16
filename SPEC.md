# Seatworks spec

What this kit guarantees, what a contribution must satisfy, and what a fork may change without
touching code. [DESIGN.md](DESIGN.md) says why the shape is this way; this file says what the shape
is.

## The one rule everything else serves

Code owns the SLPW concept: roles and their authority, lanes, tasks, hand-backs, asks, merges,
attention. Nothing else.

Which agent, model, tool or MCP server a role runs on is data. **If picking another agent, model,
tool or server would force an edit under `server/` or `mcp/`, that is a defect**, and the knowledge
belongs in the catalog instead. No file under `server/` or `mcp/` names a vendor, model, tool or
server.

## What a fork gets to change without code

| Change | Where |
|---|---|
| A role's agent, model or thinking option | settings, or `roles.json` defaults |
| A new coding agent | a directory `plugin/harness/<id>/` |
| A new MCP server | a directory `plugin/catalog/mcp/<id>/`, or a pasted snippet in settings |
| What a role reads | `content/prompts/`, `content/skills/`, `content/guides/` |
| Limits and timings | `roles.json`, or settings |

## Adding an agent: the harness contract

A harness is `plugin/harness/<id>/` holding `harness.json`, `settings.json`, one
`settings/<role>.settings.json` per role it can run (`{}` when that role adds nothing), and
`NOTES.md` recording how each fact was established.

`harness.json` is checked when the kit loads. An unknown field, a missing required one, or an id that
is not the directory name is refused by name, so a typo fails where it is written rather than in a
running lane. The check lives in `harnessProblems` in `server/catalog/kit.ts`, beside the type it
enforces.

### Required

| Field | Means |
|---|---|
| `id` | must equal the directory name |
| `label` | what a person sees |
| `baseProvider` | the **Paseo** provider this extends — see the boundary below |
| `configDirEnv` | the environment variable that relocates the agent's whole config directory |
| `profileRoot` | where seat directories live |
| `skillsDir` | where skills link inside a seat |
| `settings.file` / `.source` / `.roleSource` | the seat's settings file, the shared source, and the per-role source |
| `mcp.file` / `.delivery` / `.transports` | where servers are written, `launch` or `file`, and which transports the agent speaks |
| `provider` | how a seat starts |

### Optional

`promptFile`, `contextFile`, `systemPrompt` (`config` or `file`), `hasThinking`, `stateWrites`,
`refused`, `models[]`, `links[]`, `settings.ownedPaths`, `mcp.key`, `mcp.seed`,
`mcp.shape`, `mcp.clear`, `mcp.rule`, `provider.env`, `provider.command`, `provider.profileModeId`,
`provider.forceFlags`.

### Conditions the loader enforces

- `mcp.delivery: "file"` needs `mcp.key`.
- `systemPrompt: "file"` needs `promptFile`.
- `mcp.delivery` is `launch` or `file`; `systemPrompt` is `config` or `file`; `mcp.transports` is not
  empty.

### The boundary a fork has to know

`baseProvider` names a provider **Paseo** already has. Paseo builds clients only for its built-in
ids, so a custom provider cannot extend another custom one.

- The agent speaks **ACP** → `harness.json` alone, no code anywhere.
- It speaks something else → it needs a Paseo provider first, which is not in this repository.

`forceFlags` is applied by `bin/seat-room` at exec, not baked into `provider.command`: Paseo appends
its own arguments after the command, so a flag has to be replaced in argv rather than prepended.
`seat-room` and the type both read `harness.json`; keep them agreeing.

## Adding a server: the catalog contract

`plugin/catalog/mcp/<id>/` holds `mcp.json`, an optional `rule.md` and an optional `skills/`.

- `kind: "server"` is a plain stdio or http server.
- `kind: "proxy"` runs through `mcp/code.mjs`, which pins every call to the caller's own working
  copy. Its `proxy` spec carries the backend, the pinned argument, the tools that open, wait for and
  sync a working copy, error guidance and tool descriptions.
- `tools` per role decides what each role sees. A tool a role must not use is left out of its list,
  so the tool does not exist for it rather than being forbidden in prose.
- `rule.md` is rendered into the seat's rules file for roles that have the server on. It is the one
  place a behavioural rule about a server belongs, because that file reaches the model in the system
  channel.
- Entries ship switched off.

## Roles

`roles.json` holds each role's default harness, model and thinking option, its prompt, its skill
set, its Paseo tool policy, and `hidesWords`.

`hidesWords` is enforced, not advised. `renderText` refuses to build a seat whose prompt or MCP rule
carries a word that role must not see, and `skillProblems` does the same for every `.md` in a skill
the role gets. A Peer never reads Paseo, seat, Supervisor or Watcher; a Lead never reads Supervisor
or Watcher.

## Writing rules for every `.md` a seat reads

These govern prompts, skills and guides. They are rules about wording, and they are why a change
here is a rewrite rather than an addition.

### Prompts

1. Open with one sentence stating the role, then behavior; restate the rule that matters most at the end.
2. Every line must prevent a real mistake; cut what the model knows or can read in the code.
3. Write calm, plain instructions with their reason; no capitals or "MUST".
4. Say what to do, not what to avoid, and name the tool, field or command instead of "verify".
5. A limit a setting, the plugin or a tool schema can hold lives there, not in a prompt.
6. Add a rule only after an observed failure, by rewriting a line rather than appending one.
7. Keep a prompt under 100 lines and static for a session.

### Skills

1. Frontmatter holds `name` (the directory name) and one quoted `description` with "Use when…", at most 400 characters.
2. Add only procedure the prompt lacks, end in a named artifact, and keep `SKILL.md` under 200 lines with details one level down in `references/`.
3. Deterministic work goes in `scripts/`, without comments.

### Every `.md` a seat reads

- No HTML comments and no coding agent's tool names; the team tools (`start_task`, `done`, …) are fine.
- No word from the role's `hidesWords` in `roles.json`.
- Harness-specific facts live only in `harness/<id>/NOTES.md`.

Rule 5 is the one that decides where work goes. A limit a JSON schema can hold is written there and
refused by the server, not asked for in a paragraph: a required field is a contract, a sentence is a
suggestion with a compliance rate.

## What the machine checks

A contribution is wrong if any of these throws, and `npm run check` runs all of them:

| Check | Where |
|---|---|
| Harness fields, required and unknown | `harnessProblems`, `server/catalog/kit.ts` |
| A role's default harness exists | `loadKit` |
| A hidden word or leftover placeholder in a prompt or rule | `renderText`, `server/catalog/content.ts` |
| A hidden word or placeholder in a skill's markdown | `skillProblems`, same file |
| Every shipped role's seat builds, for all five roles | `kit.real.test.ts` |
| Every shipped harness satisfies the contract | `kit.test.ts` |
| A task brief carries a goal, acceptance, owned paths and out of scope | `start_task`, `server/desk/tools/lead.ts` |
| A lane carries an outcome, acceptance and out of scope | `open_lane`, `server/desk/tools/supervisor.ts` |
| Two tasks never hold overlapping write sets | `placementProblem`, same file |

## Layout

```
plugin/
  index.server.ts        wires Runtime
  index.client.tsx       the Seatworks screen in Paseo's sidebar
  roles.json             roles, defaults, limits, attention
  harness/<id>/          one coding agent
  catalog/mcp/<id>/      one MCP server
  content/prompts/       one prompt per role
  content/guides/        guides a role reads on demand
  content/skills/<set>/  skills linked into seats
  mcp/team.mjs           the team tool server, no dependencies
  mcp/tools.json         each role's tools and their schemas
  mcp/code.mjs           the generic working-copy proxy
  bin/seat-room          launcher that forces harness flags at exec
  server/core/           leaf helpers that know nothing of the plugin
  server/catalog/        catalog, settings, team, providers, seats
  server/desk/           the desk: tool routing, ledger, mail, merges
  server/runtime/        wiring, turns, outbox, patrol, RPC, doctor
  test/<layer>/          tests, one directory per layer of server/
```

Dependencies point one way: `runtime` → `desk` → `catalog` → `core`, and `core` uses nothing of the
plugin. `test/` mirrors `server/`, and its tests follow the same direction.

## Contributing

- `cd plugin && npm run check` must be green. It typechecks both sides and runs every test above.
- A behaviour change arrives with a test that fails without it. A test you never saw fail proves
  nothing.
- Prompts, skills and guides follow the writing rules above; a new rule needs an observed failure.
- Third-party material goes in [NOTICE.md](NOTICE.md) with its licence before it is used.
