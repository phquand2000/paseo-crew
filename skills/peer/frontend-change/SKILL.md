---
name: frontend-change
description: "Implement a UI change in the repository's own design language, with usable structure and every state the flow owns, then verify it in the rendered page: inspect the DOM before choosing selectors and run the primary workflow at the target viewports. Use when a brief changes what users see or do in a web interface and the rendered result is part of acceptance."
---

# Frontend change

Use this skill to build a user-facing interface change in the repository's design language, and to confirm it in the rendered page rather than only in the code.

Copy-only edits, a single design-token change, and headless UI logic don't need this skill; build logic with the test-first skill.

## Before editing

Work these out from the brief and the code:

1. The audience, the primary job of the screen, and its primary action.
2. How dense the information should be: a dashboard, a form, and a reading page need different layouts.
3. The existing components, tokens, and layout primitives to reuse. Search for the component library and theme files, for example with `git grep -n 'COMPONENT'`, before writing new markup.
4. The states the flow owns: loading, empty, error, disabled, selected, and recovery after an error.
5. The target viewports, from the brief or from the repository's breakpoints. If neither names any, use one narrow width (about 375 px) and one wide width (about 1280 px), and record that assumption under Unknown / risk.

Done when you have all five written down. Make routine visual choices yourself; a choice that would change product behavior goes under Unknown / risk.

## Build structure before decoration

- Put the primary workflow and its action where the user finds them first.
- Use semantic elements (buttons, labels, heading order), keep every control reachable by keyboard, and keep focus visible.
- Handle each state from the list above.
- Prevent clipping, overlap, hidden actions, and layout shift: reserve space for content that loads later, and give images their dimensions.
- Use the domain's real content and the repository's existing assets. Keep generic card grids, decorative gradients, glass effects, blobs, and oversized marketing headings to places where the design language already uses them.

Put logic such as formatting, validation, and state transitions behind a seam, and build it test-first.

## Verify in the rendered page

1. Find how the repository renders pages: an existing Playwright, Cypress, or Storybook setup, a dev-server script in the package manifest, or a static build. Use what is there, and add a new tool only if the brief allows it. Check that the brief allows the port a dev server needs.
2. Load the page and wait until it settles, meaning the network is idle or a known element is present. Then read the rendered DOM, the accessibility tree, or a screenshot, and choose selectors from what actually rendered, preferring roles and labels over CSS classes. Selectors guessed from the source often miss what is on the page.
3. At each target viewport, run the primary workflow end to end: complete the main action, trigger each state the flow owns, and reach the action by keyboard with Tab and Enter.
4. Watch the browser console during the run, and record any errors.
5. Save a screenshot per viewport, together with the command that produced it.

Done when each target viewport has a screenshot or a DOM assertion for the primary workflow, and the console output is recorded. If the repository has a browser test suite and its directory is in your owned scope, add the workflow there as a test so it keeps running.

## When you can't render

If no browser is available, the brief rules out the port, or the build fails for reasons outside your scope, write "rendered verification not performed" and the reason under Verification, and set Outcome to `partial`. A claim of visual completion needs a rendered page. List what a person should look at, and where.

## What goes in the handoff

- Verification: the render command, the viewports, the screenshot paths, the workflow steps with pass or fail, and the console errors or "none".
- Unknown / risk: assumed viewports, product choices you left open, and states you couldn't trigger.
