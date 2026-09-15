# Writing guide

Rules for prompts, skills and guides in this kit.

## Prompts

1. Open with one sentence stating the role, then behavior; restate the rule that matters most at the end.
2. Every line must prevent a real mistake; cut what the model knows or can read in the code.
3. Write calm, plain instructions with their reason; no capitals or "MUST".
4. Say what to do, not what to avoid, and name the tool, field or command instead of "verify".
5. A limit a setting, the plugin or a tool schema can hold lives there, not in a prompt.
6. Add a rule only after an observed failure, by rewriting a line rather than appending one.
7. Keep a prompt under 100 lines and static for a session.

## Skills

1. Frontmatter holds `name` (the directory name) and one quoted `description` with "Use when…", at most 400 characters.
2. Add only procedure the prompt lacks, end in a named artifact, and keep `SKILL.md` under 200 lines with details one level down in `references/`.
3. Deterministic work goes in `scripts/`, without comments.

## Every `.md` a seat reads

- No HTML comments and no coding agent's tool names; the team tools (`start_task`, `done`, …) are fine.
- No word from the role's `hidesWords` in `roles.json`: a Peer never reads Paseo, seat, Supervisor or
  Watcher, and a Lead never reads Supervisor or Watcher.
- Harness-specific facts live only in `harness/<id>/NOTES.md`.
