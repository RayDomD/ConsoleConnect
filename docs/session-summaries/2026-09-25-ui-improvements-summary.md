# UI improvements P1–P9 and console workspace: summary

Plan: `docs/plans/2026-09-25-ui-improvements.md` (Done). Roadmap: `docs/plans/2026-09-25-build-roadmap.md`, Phases 0 and 1. Mockups followed: `docs/mockups/2026-09-25-ui-improvements.html` and `docs/mockups/2026-09-25-console-workspace.html`.

## Shipped

Phase 0:

- Pending work verified and committed in three commits: fork-aware repository check and Radmin VPN detection; team chat reply, edit, and unsend; GitHub-bound invitations, OAuth sign-in, and the hosted project list. The 09-23 and 09-24 ADRs and mockups committed. `release-*/` and `.vitest/` ignored. A clean worktree checkout of the branch builds.
- Smoke flake fixed at the source: three steps acted on the renderer before its own refresh landed (Unsend sent the pre-edit version and got a 409; the decision commit field and the provider task's tool picker were not rendered yet). Each step now waits for the DOM state it needs. 25 of 25 runs passed afterward.

Phase 1, one commit per item:

- P9: traced to the console tab (task header plus a fixed-height terminal made the desk 758px in a 739px window) and the chat room's 580px floor under the top bar. Above 900px the shell is window height; the task list, desk (sticky top bar), and rail scroll themselves, and `render()` keeps their scroll positions across rebuilds. The task tabs no longer draw a stray vertical scrollbar.
- P2: 48px top bar with a workspace / task breadcrumb, Chat with its count, Projects.
- P1: sentence-case section labels; status pill, assignee, and revision under the task title.
- P4: New task as a + icon on the Tasks heading; Team chat as a nav row.
- P5: action panel without the leftover margin, "Nobody has this yet", and an Assign to teammate menu (Escape and outside click close it).
- P3: host status line with Copy address; one primary step per decision; commit field only after Prepare or Enter commit; Propose as a header action.
- P6: messages grouped by author within five minutes; no own avatar or "You"; actions on hover or keyboard focus.
- P8: J/K, 1–4, N, C, R, F, Ctrl+`, and a Ctrl+K palette over tasks, people, and actions (`src/palette.ts`). Single keys stay out of text fields and the terminal.
- P7: project rows read each project's live state and show running tasks, reviews waiting for you, and unread chat, or "Nothing needs you"; no counts when the host is unreachable.
- 1.10: self-hosted JetBrains Mono loaded before the first render; docked well with a session strip (tool, branch, elapsed, state, Share view only, Stop, Session, Focus); session rail with changed files since the task branch began (`worktreeChanges` in `src/execution.ts`), open by default at 1280px and remembered; focus mode; needs-input bar.

## Deviations and decisions

- Needs-input detection: no signal existed. With the user, chose a stopgap: a running session that is quiet for eight seconds while its terminal is unfocused shows "<tool> may be waiting for you" (`src/console-state.ts`). The mockup's "is waiting for your answer" became "may be waiting for you" because the state is inferred. Roadmap 2.7's readiness signal should replace it.
- P7 data source: counts come from each project's live state when its host answers, which covers hosted projects without a summary API. Stale counts are never shown.
- People in the Ctrl+K palette jump to the task they hold (a running one first). The mockup listed people without defining the action.
- Console strip state reads Running, Ended, View only, or No console, shorter than before, so the Session and Focus toggles fit on one line at 1267px.
- Deferred with reason: "Last check" in the session rail (plan), and "Assigned by" plus the assignment note (need the Phase 2.2 assigner field).
- DESIGN.md still describes a 76px top bar and Consolas as the mono face. It is Impeccable-owned; refresh it with `/impeccable document`.

## Checks

- `npm run build`: pass. `vitest run`: 36 passed, 0 failed (new: worktree changes, needs-input rule).
- `node scripts/smoke.mjs --screenshot`: passes, now also covering the assign menu, decision steps, message actions, keyboard shortcuts and palette, project counts, the session rail, focus mode, Ctrl+`, and the terminal font.
- Needs-input bar, rail pill, Focus terminal, and Stop checked once against a real Claude Code session idling at its folder-trust prompt. Stop is not covered by the smoke because its test tools exit immediately.
- `npm run check:hosted-schema`: pass (Phase 0).
- `/impeccable critique` once: 25/40, 0 P0, 1 P1 (status casing). `/impeccable audit` once: 15/20. Detector ran in degraded regex mode (parser modules missing), so its 33 findings are a floor.

## Open observations

- During one failed harness run, the team chat drawer opened while a native folder picker was up, with focus in its textarea; no script action requested it. It did not recur. Not investigated further to avoid reopening native dialogs.
- The smoke window width varies between runs (1267px and 1306px); the rail check now asserts the rule instead of a width.
