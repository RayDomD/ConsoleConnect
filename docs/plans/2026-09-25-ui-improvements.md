---
title: UI improvements P1–P9 and console workspace
date: 2026-09-25
status: Done
summary: Build the nine approved fixes and the docked, rail, and focus console, following the saved mockups.
---

# UI improvements P1–P9

## Context

After the tactile pass, a review found nine remaining problems. The user approved every proposal as shown in `docs/mockups/2026-09-25-ui-improvements.html`; the backlog with IDs is `docs/mockups/2026-09-25-ui-improvements.md`.

## Decisions

- P1–P9 are built as mocked. The console tab ADR (`docs/adr/2026-09-23-console-tab.md`) still holds.
- P7's counts come from the local snapshot for the open project. How hosted projects report counts without opening them is unresolved; build P7 for what is available and show nothing rather than a guess.
- P9 is traced to its source before any fix.
- Console workspace follows `docs/adr/2026-09-25-console-workspace.md`: docked default, session rail (R), focus mode (F). "Last check" in the rail is deferred.

## Steps

1. P9 trace and fix, then P2 top bar and P1 labels (page frame first).
2. P4 sidebar, P5 action panel, P3 right rail.
3. P6 chat grouping and hover actions.
4. P8 keyboard shortcuts and Ctrl+K palette.
5. P7 project rows.
6. Console workspace: JetBrains Mono, docked well and session strip, needs-input bar, session rail with worktree changed files, focus mode.

## Verification

Typecheck, tests, smoke with screenshots, Impeccable detector, keyboard walk-through of P8.
