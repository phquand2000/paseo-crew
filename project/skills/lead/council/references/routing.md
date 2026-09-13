# Council routing

Every council seat runs on the read-only Reviewer profile, provider `reviewer`. It is the only
profile whose guard blocks edits and repository-changing git, so it is the only one a sealed seat
may use. Never route a seat to the Peer profile, which can write, or to your own Lead profile,
whose prompt would turn the seat into a second Lead.

Pass provider `reviewer` and leave the model and `modeId` out: the orchestrator applies the
profile's. What routing chooses is the thinking level, and the Challenger's model.

## Thinking level per function

| Function | Preference key | Fallback | Default | Policy |
|---|---|---|---|---|
| Independent | `council.reasoning` | none | `high` | the strong reasoning seat |
| Premise Challenger | `council.challengerReasoning` | `council.reasoning` | `high` | prefer a model from another strong family |
| High-risk reasoning | `council.highRiskReasoning` | `council.reasoning` | `max` | the strongest seat offered |
| Specialist | `council.specialist` | `council.reasoning` | `high` | only when domain semantics matter |
| Verifier | `council.verifier` | none | `low` | cheap, bounded coverage |
| Deep verifier | `council.deepVerifier` | `council.reasoning` | `high` | source meaning takes judgment |
| Auditor | `council.auditor` | `council.verifier` | `medium` | bounded audit of the draft |
| Deep auditor | `council.deepAuditor` | `council.deepVerifier`, then `council.reasoning` | `high` | semantic or high-risk audit |

Read `~/.paseo/orchestration-preferences.json` once per council, if it exists, and use its
`council` section. An entry may set `model` and `thinking`; ignore any `provider` it names, since
a read-only seat has one profile. A `model` must be one the Reviewer profile offers, or the
orchestrator refuses the launch. Check a model's thinking levels with `list_models` before
passing `max`, and if `create_agent` rejects a value, take the nearest one the profile allows and
name the substitution in the verdict's limitations.

## Independence

Sealed prompts remove contamination, not correlation: two seats on the same model share its blind
spots, so their agreement is weak evidence even when neither saw the other's report. Giving the
Challenger a different strong model family is the cheapest way to make `debate` stronger than
`lens`. Do not route the Challenger to a cheap coverage model just to differ in family; when the
profile offers no second strong family, use the Independent's model and list "same-family
Challenger" under the verdict's limitations. In the `high-risk` tier only the Independent moves to
`highRiskReasoning`; the Challenger stays at `high` or stronger so the family split survives.

Your own adjudication already crosses families, since the council seats' harness and model are
usually not yours. That protects the verdict from your priors, not the seats from sharing theirs.

## Topology is not routing

Council seats are ordinary agents in your own workspace: leave `workspaceId` out, and never open
a worktree for a council. The Human controls your model and reasoning effort; routing neither
checks nor changes it, and never starts a replacement Lead.

```text
Cheap seats increase coverage.
Strong seats deliberate.
The Lead adjudicates.
```

Seat count never becomes decision weight, and a cheap seat never produces the binding verdict.
