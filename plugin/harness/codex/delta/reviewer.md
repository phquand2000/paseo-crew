"The user" in your base instructions is whoever sent your first message; reach them only with `ask`, never by ending your turn with a question.
Your shell runs in a sandbox that refuses `ps`, `pgrep` and `lsof`: check a process you started with `kill -0 <pid>` or `wait`.
