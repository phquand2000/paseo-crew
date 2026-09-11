# Council routing

This file says which provider, model, and thinking level each council function runs on. Read
it when you set up a council's seats, or when `create_agent` rejects a configured value.

## The preferences file

Read `~/.paseo/orchestration-preferences.json` once per council, if it exists, and use its
`council` section. Each entry may set `provider`, `model`, `thinking`, and `mode`:

```json
{
  "council": {
    "reasoning":           { "provider": "pi-peer", "model": "PEER_MODEL",         "thinking": "high" },
    "challengerReasoning": { "provider": "pi-peer", "model": "OTHER_FAMILY_MODEL", "thinking": "high" },
    "highRiskReasoning":   { "provider": "pi-peer", "model": "STRONGEST_MODEL",    "thinking": "xhigh" },
    "verifier":            { "provider": "pi-peer", "model": "PEER_MODEL",         "thinking": "low" },
    "auditor":             { "provider": "pi-peer", "model": "PEER_MODEL",         "thinking": "medium" }
  }
}
```

Replace `PEER_MODEL`, `OTHER_FAMILY_MODEL`, and `STRONGEST_MODEL` with model IDs as
`list_models` shows them for the provider, for example `zai/glm-5.3`.

Map an entry to `create_agent` like this:

- `provider` and `model` become `provider: "PROVIDER/MODEL"`. If an entry has no `model`,
  resolve one with `list_models` for that provider.
- `thinking` becomes `settings.thinkingOptionId`.
- `mode` becomes `settings.modeId`, and only for a provider that isn't Pi: Pi has no modes, and
  `create_agent` fails when a Pi agent is given one.

Route seats to `pi-peer`, or to a provider that was set up for read-only seats. A provider
other than `pi-peer` doesn't load the Peer prompt, so the seat relies entirely on the council's
preamble and epilogue for its boundaries. Never route a seat to your own Lead provider: its
profile loads the Lead prompt and would turn the seat into a second Lead.

## Functions and fallbacks

| Function | Key | Falls back to | Without the file | Policy |
|---|---|---|---|---|
| Independent | `reasoning` | none | `pi-peer/PEER_MODEL`, `high` | strong reasoning seat |
| Challenger | `challengerReasoning` | `reasoning` | `pi-peer/PEER_MODEL`, `high` | a different strong model family from the Independent |
| High-risk Independent | `highRiskReasoning` | `reasoning` | `pi-peer/PEER_MODEL`, `xhigh` if offered, else `high` | the strongest configured seat |
| Specialist | `specialist` | `reasoning` | `pi-peer/PEER_MODEL`, `high` | only when domain semantics matter |
| Verifier | `verifier` | none | `pi-peer/PEER_MODEL`, `low` | cheap, bounded coverage |
| Deep verifier | `deepVerifier` | `reasoning` | `pi-peer/PEER_MODEL`, `high` | when reading the source takes judgment |
| Auditor | `auditor` | `verifier` | `pi-peer/PEER_MODEL`, `medium` | bounded audit of the draft verdict |
| Deep auditor | `deepAuditor` | `deepVerifier`, then `reasoning` | `pi-peer/PEER_MODEL`, `high` | semantic or high-risk audit |

Without the file, every seat uses the Peer model from the spawn recipe in the repository's
`WORKSPACE_PROTOCOL.md`; without a protocol, use the model `list_models` offers for `pi-peer`
that your Peers already run on. Check which thinking levels a model offers with `list_models`
before passing `xhigh`.

List providers or models only when a configured value is missing or rejected, or when the
Human overrides it. If `create_agent` rejects a value, pick the nearest valid one from
`list_models` and name the substitution in the verdict's limitations.

## Independence

Sealed prompts remove contamination, not correlation. Two seats that run the same model share
its training and its blind spots, so their agreement is weak evidence even when neither saw the
other's report. A Challenger on a different strong model family adds independence that sealing
can't: in Pi, that means another model your Pi login reaches, at `high` thinking or more.
Choosing a cheap model only to get a different family trades away the Challenger's depth, so
don't.

You already cross families when you adjudicate: you run on Claude, and Pi seats usually run on
other models. That protects the verdict from your own priors, but not the seats from sharing
theirs, which is why the Challenger's routing matters most.

In the high-risk tier, only the Independent moves to `highRiskReasoning`. The Challenger stays on
`challengerReasoning` at `high` or more, so the split between families survives.

## The law

```text
Cheap workers increase coverage.
Strong seats deliberate.
The Lead adjudicates.
```

Seat count never turns into decision weight, and a cheap worker never produces the binding
verdict.
