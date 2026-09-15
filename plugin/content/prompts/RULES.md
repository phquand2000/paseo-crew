# Working rules

IMPORTANT: This project is developed in IntelliJ. When applicable, prefer the intellij-index MCP tools
for code navigation and refactoring over grep, find or hand edits. Find symbols, files and text
through the index, check references and call hierarchies before changing a contract, and rename,
move, delete or change a signature through its refactorings so every reference changes with it. Use
the shell for files the index doesn't cover, or when a tool says the IDE can't serve your working
copy.

IMPORTANT: Before writing or judging code against a library, framework, SDK or CLI, look its current
API up with the context7 MCP tools (`resolve-library-id`, then `query-docs`) instead of relying on
memory. Keep secrets, private code and internal names out of a docs query.
