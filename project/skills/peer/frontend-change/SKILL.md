---
name: frontend-change
description: "Build a UI change in the repository's own design language with every state the flow owns, then prove it rendered: selectors read from the rendered page, the primary workflow run at each target viewport. Use when a brief changes what users see or do in a web UI."
---

# Frontend change

Use this skill to build a user-facing interface change in the repository's design language, and to confirm it in the rendered page, not only in the code. Copy-only edits, a single design-token change, and headless UI logic don't need it; build logic with the test-first skill. Under a read-only disposition, render and report what you find.

## Before editing

Write these down, from the brief and the code:

1. The primary job of the screen, its primary action, and its information density: a dashboard, a form, and a reading page need different layouts.
2. The existing components, tokens, and layout primitives to reuse. Find the component library and theme files, for example with `git grep -n 'COMPONENT'`, before writing new markup. Use no arbitrary value (a one-off pixel size, an inline hex color, a bracketed utility class) where a token exists; list a missing token under Unknown / risk instead of inventing one.
3. The states the flow owns: loading, empty, error, disabled, selected, and recovery after an error.
4. The target viewports, from the brief or the repository's breakpoints. If neither names any, use one narrow width (about 375 px) and one wide width (about 1280 px), and record that assumption under Unknown / risk.

Done when all four are written down. Make routine visual choices yourself; a choice that would change product behavior goes under Unknown / risk.

## Build structure before decoration

- Handle each state from the list above, and reserve space for content that loads later so the layout doesn't shift.
- Use the domain's real content and the repository's existing assets. Use generic card grids, decorative gradients, glass effects, blobs, and oversized marketing headings only where the design language already does.
- Put logic such as formatting, validation, and state transitions behind a seam, and build it with the test-first skill.

## Verify in the rendered page

1. Use how the repository already renders pages: a Playwright, Cypress, or Storybook setup, a dev-server script in the package manifest, or a static build. Add a new tool only if the brief allows it, and check that the brief allows the port a dev server needs.
2. Read the rendered DOM, the accessibility tree, or a screenshot once the page has settled, and choose selectors from what actually rendered, preferring roles and labels over CSS classes; selectors guessed from the source often miss.
3. At each target viewport, run the primary workflow end to end: complete the main action, trigger each state the flow owns, and reach the action by keyboard with Tab and Enter.

Done when each target viewport has a screenshot or a DOM assertion for the primary workflow, with the command that produced it, and the browser console output is recorded. Add the workflow to a browser test suite only if the brief asks for a lasting check; beyond that, build no verification the brief didn't ask for.

## When you can't render

If no browser is available, the brief rules out the port, or the build fails for reasons outside your scope, write "rendered verification not performed" with the reason under Verification, set Outcome to `partial`, and list what a person should look at, and where. A claim of visual completion needs a rendered page.

## What goes in the handoff

- Verification: the render command, the viewports, the screenshot paths, the workflow steps with pass or fail, and the console errors or "none".
- Unknown / risk: assumed viewports, product choices you left open, and states you couldn't trigger.
