# Council routing

Every council seat comes from the read-only Reviewer profile. Never route a seat to the Peer
profile, which can write, or to the Lead profile, whose prompt would make the seat a second Lead.
What routing chooses is each seat's thinking level, and the Challenger's model.

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
`council` section. An entry may set `model` and `thinking`; ignore any `provider` it names. A
`model` must be one the Reviewer profile offers. Check a model's thinking levels with `list_models`
before passing `max`; when a value is rejected, take the nearest one allowed and name the
substitution in the verdict's limitations.

## Independence

Sealed prompts remove contamination, not correlation: two seats on the same model share its blind
spots, so their agreement is weak evidence even when neither saw the other's report. A Challenger
from a different strong model family is the cheapest way to make `debate` stronger than `lens`. Do
not pick a cheap coverage model just to differ in family; when the profile offers no second strong
family, use the Independent's model and list "same-family Challenger" under the verdict's
limitations. In `high-risk` only the Independent moves to `highRiskReasoning`; the Challenger stays
at `high` or stronger so the family split survives.

Your own adjudication usually crosses families too, since the seats' harness and model are rarely
yours. That protects the verdict from your priors, not the seats from sharing theirs.

```text
Cheap seats increase coverage.
Strong seats deliberate.
The Lead adjudicates.
```

Seat count never becomes decision weight, and a cheap seat never produces the binding verdict.
