# Arashi VS Code Agent Rules

This repository contains the Arashi VS Code extension.

## Scope

- Put extension source in `src/`.
- Put tests in `tests/`.
- Keep extension-specific user guidance in this repo's `README.md`.

## Working Rules

- Preserve VS Code extension command names and view IDs unless the change explicitly requires updating them.
- Keep extension behavior aligned with the Arashi CLI it invokes.
- Prefer extension-specific UX guidance here, while keeping general workflow docs in `repos/arashi-docs/`.

## Validation

- `bun run lint`
- `bun test`
- `bun run build`
