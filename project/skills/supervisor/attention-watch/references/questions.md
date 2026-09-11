# CHECK questions

Adapt the nouns and keep the shape. Each question names what to check against, suspects
nothing, and leaves "nothing found" as a full answer. A question for a Peer goes to the Lead as
`CHECK: for AGENT_ID: QUESTION`, and never mentions Paseo, seats, or the Supervisor.

| Trigger | Question |
|---|---|
| minted API | "Which of the names your new tests call existed in production code before this task, and where is each of the others decided?" |
| minted API | "Check the tests you added against the anti-pattern catalog in your test-first skill. Which entries, if any, apply?" |
| unapproved trade-off | "Does this change weaken anything the brief or `AGENTS.md` promises, such as precision, rate, or a limit? If it does, whose decision is that?" |
| contract | "Does anything you changed differ from the contract in DOC? Check it and say what you find, including nothing." |
| direction change | "What made you change route, and does the new one still fit the brief's Decided / ruled out list?" |
| struggle | "What would you need to know to stop guessing here, and who could tell you?" |
| self-correction | "Which of your earlier claims or commits does this correction also affect?" |
| scope drift | "Are all the files you changed inside the brief's owned scope?" |
| starting points | "Which of the brief's starting points have you read, and did any of them constrain this step?" |
| decision (Lead) | "Which alternatives did you weigh for this ruling, and what evidence would reverse it?" |
| decision after lanes (Lead) | "Which lane's strongest point does your ruling leave unanswered?" |
| framing (Lead) | "Does this brief leave the Peer room to propose a route you didn't list?" |
| detour (Lead) | "Is this gap inside your outcome, or a foundation another owner should build first?" |

Avoid these shapes:

| Instead of | Because |
|---|---|
| "You're violating an anti-pattern in these tests." | An assertion makes the model find a fault to agree with you, whether or not one exists. |
| "Isn't int8 too coarse here?" | A leading question carries its answer, and the agent adopts it instead of reasoning. |
| "Use a view instead of adding `points` to User." | A fix takes the decision from its owner. |
| "Are you sure?" | It names no source, so the agent re-reads its own reasoning and confirms it. |
