---
name: frontend-design
description: Implement a UI change whose rendered hierarchy, interaction flow, responsive behavior, or domain-fit visual design is a material part of acceptance. Do not use for copy-only edits, isolated design-token changes, headless UI logic, or minor component maintenance.
---

# Frontend design

Build the requested product experience using the repository's design language. This skill owns visual and interaction quality, not product discovery or architecture.

Before editing, identify the audience, primary job, information density, existing
components, and material states. Make routine visual choices locally. Ask only when
different choices would change the product contract.

Prioritize usable structure before decoration:

- expose the primary workflow and action
- preserve semantic controls, keyboard and focus behavior
- handle loading, empty, error, disabled, selected, and recovery states that belong to the flow
- prevent clipping, overlap, hidden actions, and unintended layout shifts
- use domain content and established assets instead of generic card grids, gradients, glass, blobs, or oversized marketing headings

Check the states in the component's tests, and the markup, styles and layout rules
the change touches. List in your handoff the viewports, states and workflow to look
at, and do not claim visual completion. Do not add a separate verification
ceremony or unrelated cleanup.
