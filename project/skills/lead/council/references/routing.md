# Council routing

Which profile and thinking level each council function runs on. Read it when you set up a
council's seats, or when `create_agent` rejects a value.

## Profiles, not models

Launch every seat from a profile `list_profiles` shows, copying its provider and model into
`provider: "PROVIDER/MODEL"` and passing `settings.thinkingOptionId` and no `settings.modeId`.
The profile guard blocks any launch whose model or mode differs from its profile, and any launch
on a provider with no profile, so never pick a model outside a profile.

- Every seat (Independent, Challenger, Specialist, Verifier, Auditor) launches from the
  project's read-only Peer profile, provider `pi-peer-ro`: it loads the Peer prompt and blocks
  every write. Give it the disposition Architect.
- Never route a seat to `pi-peer`, which can write, or to your own Lead provider, whose profile
  loads the Lead prompt and would turn the seat into a second Lead.
- A Verifier or Auditor that the preferences file routes to `pi-reviewer` loads the Reviewer
  prompt, which expects a change review: give it the disposition Reviewer, and add
  `Target: SNAPSHOT_SHA`, `Machine pass: skip`, and the Verifier or audit shape from
  `report-format.md` to its prompt, asking for that shape instead of findings by axis.

## The preferences file

Read `~/.paseo/orchestration-preferences.json` once per council, if it exists, and use its
`council` section. Each entry may set `provider`, `model`, and `thinking`; every provider and
model pair must match a profile, or the guard blocks the launch:

```json
{
  "council": {
    "reasoning":           { "provider": "pi-peer-ro", "model": "PEER_MODEL",         "thinking": "high" },
    "challengerReasoning": { "provider": "pi-peer-ro", "model": "OTHER_FAMILY_MODEL", "thinking": "high" },
    "highRiskReasoning":   { "provider": "pi-peer-ro", "model": "STRONGEST_MODEL",    "thinking": "xhigh" },
    "verifier":            { "provider": "pi-peer-ro", "model": "PEER_MODEL",         "thinking": "low" },
    "auditor":             { "provider": "pi-peer-ro", "model": "PEER_MODEL",         "thinking": "medium" }
  }
}
```

Replace `PEER_MODEL`, `OTHER_FAMILY_MODEL`, and `STRONGEST_MODEL` with the models of profiles
`list_profiles` shows for that provider, for example `zai/glm-5.3`; with no `model`, use the
profile's.

One file serves every project, while a provider belongs to one: use only entries naming this
project's `pi-peer-ro` or `pi-reviewer`. Another project's provider carries that project's
repository and prompts, so skip such an entry and take the fallback below.

## Functions and fallbacks

| Function | Key | Falls back to | Without the file | Policy |
|---|---|---|---|---|
| Independent | `reasoning` | none | `pi-peer-ro`, `high` | strong reasoning seat |
| Challenger | `challengerReasoning` | `reasoning` | `pi-peer-ro` on another family if a profile has one, `high` | a different strong model family from the Independent |
| High-risk Independent | `highRiskReasoning` | `reasoning` | `pi-peer-ro`, `xhigh` if offered, else `high` | the strongest configured seat |
| Specialist | `specialist` | `reasoning` | `pi-peer-ro`, `high` | only when domain semantics matter |
| Verifier | `verifier` | none | `pi-peer-ro`, `low` | cheap, bounded coverage |
| Deep verifier | `deepVerifier` | `reasoning` | `pi-peer-ro`, `high` | when reading the source takes judgment |
| Auditor | `auditor` | `verifier` | `pi-peer-ro`, `medium` | bounded audit of the draft verdict |
| Deep auditor | `deepAuditor` | `deepVerifier`, then `reasoning` | `pi-peer-ro`, `high` | semantic or high-risk audit |

Check a model's thinking levels with `list_models` before passing `xhigh`. If `create_agent`
rejects a value, pick the nearest one the profile allows and name the substitution in the
verdict's limitations.

## Independence

Sealed prompts remove contamination, not correlation: seats on the same model share its blind
spots, so their agreement is weak evidence even when neither saw the other's report. Put the
Challenger on a read-only Peer profile whose model is from a different strong family than the
Independent's, for example a DeepSeek profile beside a GLM one, at `high` thinking or more; a
cheap model picked only for its family trades away the Challenger's depth. When `list_profiles`
shows no such profile, use the Independent's and list "same-family Challenger" under the
verdict's limitations; the Human can add a profile before the next council.

Your adjudication already crosses families (you run on Claude; Pi seats usually don't). That
protects the verdict from your priors, but not the seats from sharing theirs. In the high-risk
tier, only the Independent moves to `highRiskReasoning`; the Challenger stays on
`challengerReasoning` at `high` or more, so the family split survives.

Seat count never turns into decision weight, and a cheap worker never produces the binding
verdict.
