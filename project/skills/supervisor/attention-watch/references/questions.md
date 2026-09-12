# Default steps and CHECK questions

Take the default step for the trigger. For a `CHECK:`, adapt the nouns and keep the shape: name
what to check against, suspect nothing, and leave "nothing found" as a full answer. A Peer's
question goes to the Lead as `CHECK: for AGENT_ID: QUESTION` and never mentions Paseo, seats, or
the Supervisor.

| Trigger | Default step | Question |
|---|---|---|
| destructive | Human, now | |
| minted API | CHECK | "Which of the names your new tests call existed in production code before this task, and for any that didn't, where is it decided?" |
| minted API | CHECK | "Check the tests you added against the anti-pattern catalog in your test-first skill. Which entries, if any, apply?" |
| unapproved trade-off | CHECK; Human if it weakens a guarantee the directive sets | "Does this change weaken anything the brief or `AGENTS.md` promises, such as precision, rate, or a limit? If it does, whose decision is that?" |
| human needed | Human, with the Lead's question and its options | |
| check answer | log | |
| scope drift (a contract) | CHECK | "Does anything you changed differ from the contract in DOC? Check it and say what you find, including nothing." |
| decision (Lead) | CHECK | "Which alternatives did you weigh for this ruling, and what evidence would reverse it?" |
| decision after lanes (Lead) | CHECK | "Which lane's strongest point does your ruling leave unanswered, if any?" |
| detour (Lead) | CHECK | "Is this gap inside your outcome, or a foundation another owner should build first?" |
| framing (Lead) | ADVICE; CHECK when one brief shows it | "Does this brief leave the Peer room to propose a route you didn't list?" |
| coordination (Lead codes) | CHECK | "Which files did you change yourself, and does your seat prompt count each one as a coordination record?" |
| coordination (fix rounds) | CHECK | "Do the findings behind these fix rounds share one missing mechanism or a wrong foundation? Compare them and say what you find, including nothing." |
| coordination (other) | ADVICE | |
| acceptance gap (seam) | CHECK | "Does this change touch a decide-first seam in `AGENTS.md`, and what does your Independent review section require for it?" |
| scope drift | CHECK | "Which files you changed, if any, lie outside the brief's owned scope?" |
| unanswered pushback | ADVICE | |
| collision, stall | ADVICE | |
| direction change | CHECK once it recurs | "What made you change route, and does the new one still fit the brief's Decided / ruled out list?" |
| struggle | CHECK once it recurs | "What would settle this step, and who could tell you?" |
| self-correction | log | "Which of your earlier claims or commits does this correction also affect?" |
| acceptance | log; CHECK when an acceptance has no `LESSON:` line | "What did this task teach about coordination? End the summary with a `LESSON:` line, or `none`." |
| struggle (reading) | CHECK | "Which of the brief's starting points have you read, and did any of them constrain this step?" |

Avoid these shapes:

| Instead of | Because |
|---|---|
| "You're violating an anti-pattern in these tests." | An assertion makes the model find a fault to agree with, whether or not one exists. |
| "Isn't int8 too coarse here?" | A leading question carries its answer, and the agent adopts it instead of reasoning. |
| "Use a view instead of adding `points` to User." | A fix takes the decision from its owner. |
| "Are you sure?" | It names no source, so the agent re-reads its own reasoning and confirms it. |
