---
title: Build roadmap after the 2026-09-25 design session
date: 2026-09-25
status: In Progress
summary: Ordered build of housekeeping, P1–P9 and console workspace, orchestrator, Office, and guided path, from the ADRs written on 2026-09-25.
---

# Build roadmap

## Status & Progress Summary

Phase 0 and Phase 1 done on 2026-09-25 (summary: `docs/session-summaries/2026-09-25-ui-improvements-summary.md`). Phase 2 done on 2026-09-25 (summary: `docs/session-summaries/2026-09-25-orchestrator-summary.md`). Phase 3 done on 2026-09-25 (summary: `docs/session-summaries/2026-09-25-office-summary.md`); hosted presence and sharing still need the Supabase deploy. Next: Phase 4.0, grilling the guided path.

Everything decided on 2026-09-25 and not yet built. Handoff for fresh sessions: `.goal/2026-09-25-build.md`. Sizes are rough session estimates.

## Phase 0: housekeeping (blocking)

| # | Item | Source | Depends on | Size |
|---|---|---|---|---|
| 0.1 | Verify (typecheck, tests, smoke) and commit the pending invitations, OAuth, and hosting work | working tree | none | small |
| 0.2 | Commit the 09-23 and 09-24 ADRs and mockups | working tree | none | small |
| 0.3 | Ignore `release-*/` and `.vitest/`; fix the unsend smoke flake | working tree | none | small |

## Phase 1: UI improvements and console workspace

Plan: [2026-09-25-ui-improvements.md](2026-09-25-ui-improvements.md). Design reference: `DESIGN.md`.

| # | Item | What changes | Depends on | Size |
|---|---|---|---|---|
| 1.1 | P9 Stray page scrollbar | Trace the overflow and lock the shell to the window height | 0.x | small |
| 1.2 | P2 Top bar | 48px bar with breadcrumb, Chat with count, Projects | 1.1 | small |
| 1.3 | P1 Uppercase labels | Status dot beside the title, sentence-case headings | 1.2 | small |
| 1.4 | P4 Sidebar | New task as a + icon, Team chat as a nav row | 1.3 | small |
| 1.5 | P5 Action panel | Remove dead space, Unassigned pill, Assign menu button | 1.3 | small |
| 1.6 | P3 Right rail | Host status line, one primary step per decision, commit field after Prepare | 1.3 | medium |
| 1.7 | P6 Chat | Grouping, no own avatar, actions on hover or focus | 1.3 | medium |
| 1.8 | P8 Keyboard | Ctrl+K palette, J/K, 1–4, N, C | 1.4 | medium |
| 1.9 | P7 Project rows | Running, review, and unread counts from local data | 1.3 | small |
| 1.10 | Console workspace | JetBrains Mono, docked well, session strip, needs-input bar, session rail with changed files, focus mode | 1.2 | large |

## Phase 2: Orchestrator

ADR: [2026-09-25-orchestrator.md](../adr/2026-09-25-orchestrator.md). Needs a spec first.

| # | Item | Decision | Depends on | Size |
|---|---|---|---|---|
| 2.0 | Orchestrator spec and tickets | none | can run beside Phase 1 | 1 session |
| 2.1 | Local named pipe and `console-connect` CLI | Q2, Q3 | 2.0 | large |
| 2.2 | "via tool" marker and assigner field | Q1 | 2.1 | small |
| 2.3 | Click enforcement: accept, request changes, approve are propose-only from the CLI | Q4 | 2.1 | medium |
| 2.4 | Owner-set assigning rule on both hosts | Q11 | 2.0 | medium |
| 2.5 | Decline and "Assigned by me" rail | ADR | 2.2 | medium |
| 2.6 | Built-in orchestrator console | Q5 | 1.10, 2.1 | medium |
| 2.7 | Per-tool readiness signal and pre-filled brief | Q6 | 1.10 | medium |
| 2.8 | `package draft` and auto-filled package card | Q7 | 2.1 | medium |
| 2.9 | Event delivery into consoles, orchestrator side | Q8 | 2.6 | medium |
| 2.10 | Auto setting: switch, per-event, daily limit, log | Q9 | 2.9 | medium |
| 2.11 | Worker-side events | Q10 | 2.7, 2.9 | medium |
| 2.12 | `console-connect brief` and opener | Q12 | 2.1, 2.4 | medium |
| 2.13 | Project map, protected tags, drift flags | Q13 | 2.12 | medium |

## Phase 3: Office

ADR: [2026-09-25-office.md](../adr/2026-09-25-office.md).

| # | Item | Decision | Depends on | Size |
|---|---|---|---|---|
| 3.1 | Presence (here, away, offline) | Q17 | 2.9 | medium |
| 3.2 | View-only sharing on Supabase | spec gap | none | large |
| 3.3 | Office: rooms, glimpses, viewer, huddles | Q17 | 3.1 | large |
| 3.4 | First-launch prompt and accessible switch | Q18 | 3.3 | small |

## Phase 4: Guided path

ADR: [2026-09-25-guided-path.md](../adr/2026-09-25-guided-path.md). Direction only.

| # | Item | Decision | Depends on | Size |
|---|---|---|---|---|
| 4.0 | Grill the stages | Q14–Q16 | Phase 2 | 1 session |
| 4.1 | Idea cards, size picker, Next step with recommendations | Q15, Q16 | 4.0 | large |
| 4.2 | Stage playbooks | Q14 | 2.1, 4.0 | medium |
| 4.3 | Blocked-by ordering (`--after`) | Q14 | 4.0 | medium |
| 4.4 | Docs scaffold PR and sample idea | Q14, Q15 | 2.13 | medium |

## Still open in the spec

Real Claude Code and Antigravity prompt checks, GitHub PR creation and approval, hosted GitHub token setup, hosted terminal sharing (3.2), and the two-computer acceptance test.

## Changelog

- 2026-09-25: Created from the design session's ADRs; handoff written to `.goal/2026-09-25-build.md`.
