# Phase specifications

Write `phase-NN.md` just before each development phase starts. Keep each specification short and describe behavior rather than filenames.

Use this structure:

```markdown
# Phase NN: Phase name

## Behavior

Describe what the app does in this phase, including relevant limits.

## Acceptance check

List the actions the user takes in the browser and the results they must see.
```

Keep project context and decision rationale in [the project document](../project-doc.md). Types, lint, and build checks are the developer's responsibility. Browser acceptance checks are the user's responsibility.
