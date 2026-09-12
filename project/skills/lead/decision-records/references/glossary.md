# Domain glossary

`CONTEXT.md` at the repository root is a glossary of the project's domain terms and nothing
else: no implementation notes, specs, or scratch work. Create it when the first term is settled.
Each entry looks like this:

```md
## GROUP

**TERM**: DEFINITION
Avoid: SYNONYMS
```

Replace `GROUP` with a cluster of related terms, `TERM` with the chosen name, `DEFINITION` with
one or two sentences on what the thing is, and `SYNONYMS` with the names not to use.

- Keep one term per concept and list the rejected names under `Avoid`, because when two names
  exist for one concept, agents follow either one.
- Define what the thing is, not how it is built; implementation details go stale and belong in
  the code.
- Include only project-specific concepts, not general programming terms.
- Update an entry in its own commit, right after you accept the work that settled the term.
- If the repository has several bounded contexts, give each a group in the root `CONTEXT.md`
  and say how they relate; a `CONTEXT.md` elsewhere is a repository file an Engineer Peer
  writes.

Challenge conflicting terms. When a request, a brief, a handoff, or the code uses a term that
conflicts with the glossary, or uses one word for two concepts (such as "account" for both a
customer and a login), name the conflict and settle one term before writing the next brief. Ask
the Human about terms from the product's language, and choose and record internal terms
yourself. Use glossary terms in every brief.
